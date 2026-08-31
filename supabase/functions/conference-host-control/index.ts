import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { EgressClient, RoomServiceClient, TrackSource } from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

type HostAction =
  | "remove"
  | "mute"
  | "promote"
  | "demote"
  | "set-role"
  | "disable-mic"
  | "enable-mic"
  | "disable-camera"
  | "enable-camera"
  | "disable-screen"
  | "enable-screen"
  | "lock"
  | "unlock"
  | "end"
  | "lower-hand";
type AssignableRole = "HOST" | "CO_HOST" | "MODERATOR" | "PRESENTER" | "PARTICIPANT" | "VIEWER";

const assignableRoles = new Set<AssignableRole>(["HOST", "CO_HOST", "MODERATOR", "PRESENTER", "PARTICIPANT", "VIEWER"]);
const sourceMap: Record<string, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function parseLiveKitPolicy(value: unknown) {
  const payload = asRecord(value);
  const sourceNames = Array.isArray(payload?.publish_sources)
    ? payload.publish_sources.filter((item): item is string => typeof item === "string" && item in sourceMap)
    : [];

  return {
    ok: payload?.ok === true,
    canPublish: payload?.can_publish === true,
    canSubscribe: payload?.can_subscribe === true,
    canPublishData: payload?.can_publish_data === true,
    publishSources: sourceNames.map((source) => sourceMap[source]),
  };
}

function sameSources(current: TrackSource[] | undefined, desired: TrackSource[]): boolean {
  const left = [...(current ?? [])].sort((a, b) => Number(a) - Number(b));
  const right = [...desired].sort((a, b) => Number(a) - Number(b));
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isParticipantMissing(error: unknown): boolean {
  const payload = asRecord(error);
  const status = Number(payload?.status ?? 0);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return status === 404 || message.includes("not found");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+.+/i.test(authHeader)) return reply(401, { error: "NOT_AUTHENTICATED" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: { roomId?: string; action?: HostAction; targetUserId?: string; targetRole?: AssignableRole };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.action) return reply(400, { error: "ROOM_ID_AND_ACTION_REQUIRED" });
  const targetRequired = [
    "remove",
    "mute",
    "promote",
    "demote",
    "set-role",
    "lower-hand",
    "disable-mic",
    "enable-mic",
    "disable-camera",
    "enable-camera",
    "disable-screen",
    "enable-screen",
  ].includes(body.action);
  if (targetRequired && !body.targetUserId) return reply(400, { error: "TARGET_USER_ID_REQUIRED" });
  if (body.action === "set-role" && (!body.targetRole || !assignableRoles.has(body.targetRole))) {
    return reply(400, { error: "VALID_TARGET_ROLE_REQUIRED" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: accessState, error: accessError } = await userClient.rpc("get_my_auth_access_state");
  if (accessError || !accessState || accessState.access_level !== "FULL" || !accessState.user_id) {
    return reply(403, { error: "NOT_AUTHORIZED" });
  }

  const { data: authz, error: authzError } = await userClient.rpc("authorize_livekit_host_action", {
    p_room_id: body.roomId,
    p_target_user_id: body.targetUserId ?? null,
    p_action: body.action,
  });
  if (authzError || !authz?.ok) {
    return reply(403, { error: String(authz?.reason || "FORBIDDEN").toUpperCase() });
  }

  const roomName = String(authz.livekit_room_name);
  const roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret);

  try {
    if (body.action === "lock" || body.action === "unlock") {
      const { data, error } = await userClient.rpc("set_livekit_room_lock", {
        p_room_id: body.roomId,
        p_locked: body.action === "lock",
      });
      if (error || !data?.ok) return reply(403, { error: String(data?.reason || "LOCK_FAILED").toUpperCase() });
      return reply(200, { ok: true, locked: body.action === "lock" });
    }

    if (body.action === "remove") {
      await roomService.removeParticipant(roomName, body.targetUserId!, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      });
      const { data, error } = await userClient.rpc("moderate_conference_participant", {
        p_room_id: body.roomId,
        p_target_user_id: body.targetUserId,
        p_action: "kick",
      });
      if (error || !data?.ok) return reply(500, { error: "DB_MODERATION_FAILED" });
      await service.from("conference_audit_events").insert({
        room_id: body.roomId,
        actor_user_id: accessState.user_id,
        target_user_id: body.targetUserId,
        event_type: "participant_removed",
      });
      return reply(200, { ok: true });
    }

    if (body.action === "mute") {
      const participant = await roomService.getParticipant(roomName, body.targetUserId!);
      const microphoneTracks = participant.tracks.filter(
        (track) => track.source === TrackSource.MICROPHONE,
      );
      for (const track of microphoneTracks) {
        await roomService.mutePublishedTrack(
          roomName,
          body.targetUserId!,
          track.sid,
          true,
        );
      }
      const { data, error } = await userClient.rpc("moderate_conference_participant", {
        p_room_id: body.roomId,
        p_target_user_id: body.targetUserId,
        p_action: "mute",
      });
      if (error || !data?.ok) return reply(500, { error: "DB_MODERATION_FAILED" });
      await service.from("conference_audit_events").insert({
        room_id: body.roomId,
        actor_user_id: accessState.user_id,
        target_user_id: body.targetUserId,
        event_type: "participant_muted",
        metadata: { mode: "current_microphone_track" },
      });
      return reply(200, { ok: true, mutedTracks: microphoneTracks.length });
    }

    if (
      body.action === "disable-mic"
      || body.action === "enable-mic"
      || body.action === "disable-camera"
      || body.action === "enable-camera"
      || body.action === "disable-screen"
      || body.action === "enable-screen"
    ) {
      const source = body.action.includes("mic")
        ? "microphone"
        : body.action.includes("camera")
          ? "camera"
          : "screen_share";
      const disabled = body.action.startsWith("disable-");

      const { data, error } = await userClient.rpc(
        "set_livekit_participant_media_permission",
        {
          p_room_id: body.roomId,
          p_target_user_id: body.targetUserId,
          p_source: source,
          p_disabled: disabled,
        },
      );
      if (error || !data?.ok) {
        return reply(403, {
          error: String(data?.reason || "MEDIA_PERMISSION_UPDATE_FAILED").toUpperCase(),
        });
      }

      const policy = parseLiveKitPolicy(data.livekit_policy);
      if (!policy.ok) {
        return reply(500, { error: "LIVEKIT_POLICY_MISSING" });
      }

      const desiredPermission = {
        canPublish: policy.canPublish,
        canSubscribe: policy.canSubscribe,
        canPublishData: policy.canPublishData,
        canPublishSources: policy.publishSources,
      };

      try {
        await roomService.updateParticipant(roomName, body.targetUserId!, {
          permission: desiredPermission,
        });
      } catch (runtimeError) {
        if (isParticipantMissing(runtimeError)) {
          return reply(200, {
            ok: true,
            source,
            disabled,
            runtimeUpdated: false,
            participantOffline: true,
          });
        }

        console.error(
          "conference-host-control: media permission update returned error",
          runtimeError,
        );

        try {
          const participant = await roomService.getParticipant(
            roomName,
            body.targetUserId!,
          );
          const current = participant.permission;
          const runtimeUpdated = Boolean(
            current
            && current.canPublish === desiredPermission.canPublish
            && current.canSubscribe === desiredPermission.canSubscribe
            && current.canPublishData === desiredPermission.canPublishData
            && sameSources(
              current.canPublishSources,
              desiredPermission.canPublishSources,
            )
          );

          if (!runtimeUpdated) {
            return reply(502, { error: "LIVEKIT_PERMISSION_SYNC_FAILED" });
          }
        } catch {
          return reply(502, { error: "LIVEKIT_PERMISSION_SYNC_FAILED" });
        }
      }

      await service.from("conference_audit_events").insert({
        room_id: body.roomId,
        actor_user_id: accessState.user_id,
        target_user_id: body.targetUserId,
        event_type: "livekit_permission_synchronized",
        metadata: {
          source,
          disabled,
          mode: "publish_permission",
        },
      });

      return reply(200, {
        ok: true,
        source,
        disabled,
        runtimeUpdated: true,
      });
    }

    if (body.action === "lower-hand") {
      const { data, error } = await userClient.rpc("moderate_conference_participant", {
        p_room_id: body.roomId,
        p_target_user_id: body.targetUserId,
        p_action: "lower_hand",
      });
      if (error || !data?.ok) return reply(500, { error: "LOWER_HAND_FAILED" });

      const session = asRecord(data.session);
      const sessionId = typeof session?.id === "string" ? session.id : "";
      const policy = parseLiveKitPolicy(data.livekit_policy);
      if (!sessionId || !policy.ok) return reply(200, { ok: true });

      try {
        await roomService.getParticipant(roomName, body.targetUserId!);
        await roomService.updateParticipant(roomName, body.targetUserId!, {
          permission: {
            canPublish: policy.canPublish,
            canSubscribe: policy.canSubscribe,
            canPublishData: policy.canPublishData,
            canPublishSources: policy.publishSources,
          },
        });
        await service.rpc("complete_conference_speaker_enforcement", {
          p_session_id: sessionId,
          p_success: true,
          p_error: null,
          p_runtime_updated: true,
        });
        return reply(200, { ok: true, runtimeUpdated: true });
      } catch (runtimeError) {
        if (isParticipantMissing(runtimeError)) {
          await service.rpc("complete_conference_speaker_enforcement", {
            p_session_id: sessionId,
            p_success: true,
            p_error: null,
            p_runtime_updated: false,
          });
          return reply(200, { ok: true, runtimeUpdated: false, participantOffline: true });
        }

        const message = runtimeError instanceof Error
          ? runtimeError.message
          : "LIVEKIT_SYNC_FAILED";
        await service.rpc("complete_conference_speaker_enforcement", {
          p_session_id: sessionId,
          p_success: false,
          p_error: message,
          p_runtime_updated: false,
        });
        return reply(502, { error: "LIVEKIT_QUEUE_SYNC_PENDING" });
      }
    }

    if (body.action === "promote" || body.action === "demote" || body.action === "set-role") {
      const nextRole: AssignableRole = body.action === "set-role"
        ? body.targetRole!
        : body.action === "promote"
          ? "CO_HOST"
          : "PARTICIPANT";

      const { data, error } = await service.rpc("apply_livekit_conference_participant_role", {
        p_room_id: body.roomId,
        p_target_user_id: body.targetUserId,
        p_role: nextRole,
        p_actor_user_id: accessState.user_id,
      });
      if (error || !data?.ok) {
        return reply(403, { error: String(data?.reason || "ROLE_CHANGE_FAILED").toUpperCase() });
      }

      const policy = parseLiveKitPolicy(data.livekit_policy);
      if (!policy.ok) return reply(500, { error: "LIVEKIT_POLICY_MISSING" });

      const desiredPermission = {
        canPublish: policy.canPublish,
        canSubscribe: policy.canSubscribe,
        canPublishData: policy.canPublishData,
        canPublishSources: policy.publishSources,
      };

      let runtimeUpdated = true;
      try {
        await roomService.updateParticipant(roomName, body.targetUserId!, {
          metadata: JSON.stringify({ role: String(data.role) }),
          permission: desiredPermission,
        });
      } catch (updateError) {
        console.error("conference-host-control: permission update returned error", updateError);
        try {
          const participant = await roomService.getParticipant(roomName, body.targetUserId!);
          const current = participant.permission;
          runtimeUpdated = Boolean(
            current
            && current.canPublish === desiredPermission.canPublish
            && current.canSubscribe === desiredPermission.canSubscribe
            && current.canPublishData === desiredPermission.canPublishData
            && sameSources(current.canPublishSources, desiredPermission.canPublishSources)
          );
          if (!runtimeUpdated) return reply(502, { error: "LIVEKIT_PERMISSION_SYNC_FAILED" });
        } catch {
          runtimeUpdated = false;
        }
      }

      await service.from("conference_audit_events").insert({
        room_id: body.roomId,
        actor_user_id: accessState.user_id,
        target_user_id: body.targetUserId,
        event_type: "livekit_permission_synchronized",
        metadata: { role: String(data.role), runtime_updated: runtimeUpdated },
      });

      return reply(200, {
        ok: true,
        role: String(data.role),
        runtimeUpdated,
      });
    }

    if (body.action === "end") {
      const egress = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
      const { data: activeRecordings } = await service
        .from("conference_recordings")
        .select("id,provider_egress_id")
        .eq("room_id", body.roomId)
        .in("status", ["starting", "active", "stopping"]);
      for (const recording of activeRecordings || []) {
        if (recording.provider_egress_id) {
          try {
            await egress.stopEgress(recording.provider_egress_id);
          } catch (error) {
            console.error("conference-host-control: egress stop failed", error);
          }
        }
        await service.from("conference_recordings").update({
          status: "complete",
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", recording.id);
      }
      const { data, error } = await userClient.rpc("end_conference_room", {
        p_room_id: body.roomId,
        p_reason: "ended_by_host",
      });
      if (error || !data?.ok) return reply(500, { error: "END_ROOM_FAILED" });
      try {
        await roomService.deleteRoom(roomName);
      } catch (error) {
        console.error("conference-host-control: LiveKit room delete failed", error);
      }
      await service.from("conference_audit_events").insert({
        room_id: body.roomId,
        actor_user_id: accessState.user_id,
        event_type: "meeting_ended",
      });
      return reply(200, { ok: true });
    }

    return reply(400, { error: "UNKNOWN_ACTION" });
  } catch (error) {
    console.error("conference-host-control failed", { action: body.action, error });
    return reply(502, { error: "HOST_ACTION_FAILED" });
  }
});
