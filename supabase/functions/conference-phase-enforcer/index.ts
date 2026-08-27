import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { RoomServiceClient, TrackSource } from "npm:livekit-server-sdk@2.18.0";

const headers = { "Content-Type": "application/json" };
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

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

function parsePolicy(value: unknown) {
  const payload = asRecord(value);
  const names = Array.isArray(payload?.publish_sources)
    ? payload.publish_sources.filter(
      (item): item is string => typeof item === "string" && item in sourceMap,
    )
    : [];

  return {
    ok: payload?.ok === true,
    canPublish: payload?.can_publish === true,
    canSubscribe: payload?.can_subscribe === true,
    canPublishData: payload?.can_publish_data === true,
    publishSources: names.map((name) => sourceMap[name]),
  };
}

function parseParticipantPolicies(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    const userId = typeof row?.user_id === "string" ? row.user_id : "";
    const policy = parsePolicy(row?.livekit_policy);
    return userId && policy.ok ? [{ userId, policy }] : [];
  });
}

function isRoomMissing(error: unknown): boolean {
  const payload = asRecord(error);
  const status = Number(payload?.status ?? 0);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return status === 404 || message.includes("not found") || message.includes("room does not exist");
}


Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const workerSecret = req.headers.get("X-Conference-Phase-Secret") ?? "";
  if (!workerSecret) return reply(401, { error: "WORKER_AUTH_REQUIRED" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";
  const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";

  if (
    !supabaseUrl
    || !serviceRoleKey
    || !livekitUrl
    || !livekitApiKey
    || !livekitApiSecret
  ) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: { eventId?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }
  if (!body.eventId) return reply(400, { error: "EVENT_ID_REQUIRED" });

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretValid, error: secretError } = await service.rpc(
    "verify_conference_phase_worker_secret",
    { p_secret: workerSecret },
  );
  if (secretError || secretValid !== true) {
    return reply(403, { error: "WORKER_AUTH_FAILED" });
  }

  const { data: claim, error: claimError } = await service.rpc(
    "claim_conference_phase_enforcement",
    { p_event_id: body.eventId },
  );
  if (claimError || !claim?.ok) {
    return reply(404, {
      error: String(claim?.reason || claimError?.message || "PHASE_EVENT_NOT_FOUND").toUpperCase(),
    });
  }
  if (claim.already_done === true) {
    return reply(200, {
      ok: true,
      alreadyDone: true,
      superseded: claim.superseded === true,
    });
  }

  const eventId = String(claim.event_id || body.eventId);
  const roomName = String(claim.livekit_room_name || "");
  const currentPhase = String(claim.current_phase || "");
  const participantPolicies = parseParticipantPolicies(claim.participant_policies);

  if (!roomName) {
    await service.rpc("complete_conference_phase_enforcement", {
      p_event_id: eventId,
      p_success: currentPhase === "ENDED",
      p_error: currentPhase === "ENDED" ? null : "LIVEKIT_ROOM_MISSING",
      p_participants_updated: 0,
      p_participants_offline: participantPolicies.length,
    });
    return currentPhase === "ENDED"
      ? reply(200, { ok: true, roomOffline: true })
      : reply(500, { error: "LIVEKIT_ROOM_MISSING" });
  }

  const policyByIdentity = new Map(
    participantPolicies.map((entry) => [entry.userId, entry.policy]),
  );
  const roomService = new RoomServiceClient(
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
  );

  try {
    const connected = await roomService.listParticipants(roomName);
    let updated = 0;
    for (const participant of connected) {
      const policy = policyByIdentity.get(participant.identity);
      if (!policy) continue;
      await roomService.updateParticipant(roomName, participant.identity, {
        permission: {
          canPublish: policy.canPublish,
          canSubscribe: policy.canSubscribe,
          canPublishData: policy.canPublishData,
          canPublishSources: policy.publishSources,
        },
      });
      updated += 1;
    }

    const offline = Math.max(0, participantPolicies.length - updated);
    await service.rpc("complete_conference_phase_enforcement", {
      p_event_id: eventId,
      p_success: true,
      p_error: null,
      p_participants_updated: updated,
      p_participants_offline: offline,
    });

    return reply(200, {
      ok: true,
      participantsUpdated: updated,
      participantsOffline: offline,
    });
  } catch (runtimeError) {
    if (currentPhase === "ENDED" && isRoomMissing(runtimeError)) {
      await service.rpc("complete_conference_phase_enforcement", {
        p_event_id: eventId,
        p_success: true,
        p_error: null,
        p_participants_updated: 0,
        p_participants_offline: participantPolicies.length,
      });
      return reply(200, { ok: true, roomOffline: true });
    }

    const message = runtimeError instanceof Error
      ? runtimeError.message
      : "LIVEKIT_PHASE_SYNC_FAILED";
    console.error("conference-phase-enforcer failed", runtimeError);

    await service.rpc("complete_conference_phase_enforcement", {
      p_event_id: eventId,
      p_success: false,
      p_error: message,
      p_participants_updated: 0,
      p_participants_offline: participantPolicies.length,
    });
    return reply(502, { error: "LIVEKIT_PHASE_SYNC_FAILED" });
  }
});
