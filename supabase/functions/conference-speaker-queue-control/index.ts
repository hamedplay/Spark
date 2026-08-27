import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { RoomServiceClient, TrackSource } from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

type QueueAction = "move_up" | "move_down" | "remove" | "set_time" | "allow";

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
  if (!/^Bearer\s+.+/i.test(authHeader)) {
    return reply(401, { error: "NOT_AUTHENTICATED" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: {
    roomId?: string;
    targetUserId?: string;
    action?: QueueAction;
    seconds?: number;
  };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.targetUserId || !body.action) {
    return reply(400, { error: "ROOM_TARGET_ACTION_REQUIRED" });
  }
  if (!["move_up", "move_down", "remove", "set_time", "allow"].includes(body.action)) {
    return reply(400, { error: "INVALID_ACTION" });
  }

  const seconds = Number.isFinite(body.seconds)
    ? Math.trunc(Number(body.seconds))
    : null;
  if (body.action === "set_time" && (seconds === null || seconds < 10 || seconds > 3600)) {
    return reply(400, { error: "INVALID_DURATION" });
  }

  const runtimeSyncRequired = body.action === "remove" || body.action === "allow";
  const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  if (runtimeSyncRequired && (!livekitUrl || !livekitApiKey || !livekitApiSecret)) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: accessState, error: accessError } = await userClient.rpc(
    "get_my_auth_access_state",
  );
  if (
    accessError
    || !accessState
    || accessState.access_level !== "FULL"
    || !accessState.user_id
  ) {
    return reply(403, { error: "NOT_AUTHORIZED" });
  }

  const { data: authorization, error: authorizationError } = await userClient.rpc(
    "authorize_conference_speaker_queue_action",
    {
      p_room_id: body.roomId,
      p_target_user_id: body.targetUserId,
      p_action: body.action,
      p_seconds: seconds,
    },
  );
  if (authorizationError || !authorization?.ok) {
    return reply(403, {
      error: String(
        authorization?.reason
        || authorizationError?.message
        || "QUEUE_ACTION_FORBIDDEN",
      ).toUpperCase(),
    });
  }

  const { data, error } = await service.rpc(
    "apply_livekit_conference_speaker_queue_action",
    {
      p_room_id: body.roomId,
      p_target_user_id: body.targetUserId,
      p_action: body.action,
      p_seconds: seconds,
      p_actor_user_id: accessState.user_id,
    },
  );
  if (error || !data?.ok) {
    return reply(409, {
      error: String(data?.reason || error?.message || "QUEUE_ACTION_FAILED").toUpperCase(),
    });
  }

  if (!runtimeSyncRequired) {
    return reply(200, {
      ok: true,
      session: data.session,
      serverTime: data.server_time,
    });
  }

  const session = asRecord(data.session);
  const sessionId = typeof session?.id === "string" ? session.id : "";
  const policy = parsePolicy(data.livekit_policy);
  if (!sessionId || !policy.ok) {
    return reply(500, { error: "QUEUE_POLICY_MISSING" });
  }

  const { data: roomData, error: roomError } = await service
    .from("conference_rooms")
    .select("livekit_room_name")
    .eq("id", body.roomId)
    .maybeSingle();
  const roomName = String(roomData?.livekit_room_name || "");
  if (roomError || !roomName) {
    return reply(500, { error: "LIVEKIT_ROOM_MISSING" });
  }

  const roomService = new RoomServiceClient(
    livekitUrl,
    livekitApiKey,
    livekitApiSecret,
  );

  try {
    await roomService.getParticipant(roomName, body.targetUserId);
    await roomService.updateParticipant(roomName, body.targetUserId, {
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

    return reply(200, {
      ok: true,
      session: data.session,
      serverTime: data.server_time,
      runtimeUpdated: true,
    });
  } catch (runtimeError) {
    if (isParticipantMissing(runtimeError)) {
      await service.rpc("complete_conference_speaker_enforcement", {
        p_session_id: sessionId,
        p_success: true,
        p_error: null,
        p_runtime_updated: false,
      });
      return reply(200, {
        ok: true,
        session: data.session,
        serverTime: data.server_time,
        runtimeUpdated: false,
        participantOffline: true,
      });
    }

    const message = runtimeError instanceof Error
      ? runtimeError.message
      : "LIVEKIT_SYNC_FAILED";
    console.error("conference-speaker-queue-control: LiveKit sync failed", runtimeError);
    await service.rpc("complete_conference_speaker_enforcement", {
      p_session_id: sessionId,
      p_success: false,
      p_error: message,
      p_runtime_updated: false,
    });

    return reply(502, {
      error: "LIVEKIT_QUEUE_SYNC_PENDING",
      session: data.session,
      serverTime: data.server_time,
    });
  }
});
