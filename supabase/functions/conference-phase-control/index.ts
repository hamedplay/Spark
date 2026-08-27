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

type PhaseAction = "open_waiting" | "start_countdown" | "start_break" | "resume";

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
  const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";

  if (
    !supabaseUrl
    || !anonKey
    || !serviceRoleKey
    || !livekitUrl
    || !livekitApiKey
    || !livekitApiSecret
  ) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: {
    roomId?: string;
    action?: PhaseAction;
    durationSeconds?: number;
    allowMic?: boolean;
    allowCamera?: boolean;
    allowChat?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.action) {
    return reply(400, { error: "ROOM_AND_ACTION_REQUIRED" });
  }
  if (!["open_waiting", "start_countdown", "start_break", "resume"].includes(body.action)) {
    return reply(400, { error: "INVALID_ACTION" });
  }

  const durationSeconds = Number.isFinite(body.durationSeconds)
    ? Math.trunc(Number(body.durationSeconds))
    : null;

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

  const rpcArgs = {
    p_room_id: body.roomId,
    p_action: body.action,
    p_duration_seconds: durationSeconds,
    p_allow_mic: body.allowMic ?? null,
    p_allow_camera: body.allowCamera ?? null,
    p_allow_chat: body.allowChat ?? null,
  };

  const { data: authorization, error: authorizationError } = await userClient.rpc(
    "authorize_conference_phase_action",
    rpcArgs,
  );
  if (authorizationError || !authorization?.ok) {
    return reply(403, {
      error: String(
        authorization?.reason
        || authorizationError?.message
        || "PHASE_ACTION_FORBIDDEN",
      ).toUpperCase(),
    });
  }

  const { data, error } = await service.rpc(
    "apply_livekit_conference_phase_action",
    {
      ...rpcArgs,
      p_actor_user_id: accessState.user_id,
    },
  );
  if (error || !data?.ok) {
    return reply(409, {
      error: String(data?.reason || error?.message || "PHASE_ACTION_FAILED").toUpperCase(),
    });
  }

  const eventId = String(data.event_id || "");
  if (!eventId) return reply(500, { error: "PHASE_EVENT_MISSING" });

  const { data: claim, error: claimError } = await service.rpc(
    "claim_conference_phase_enforcement",
    { p_event_id: eventId },
  );
  if (claimError || !claim?.ok) {
    return reply(500, {
      error: String(claim?.reason || claimError?.message || "PHASE_SYNC_CLAIM_FAILED").toUpperCase(),
    });
  }
  if (claim.already_done === true) {
    return reply(200, { ok: true, phase: data, runtimeUpdated: false });
  }

  const roomName = String(claim.livekit_room_name || "");
  const participantPolicies = parseParticipantPolicies(claim.participant_policies);
  if (!roomName) return reply(500, { error: "LIVEKIT_ROOM_MISSING" });

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
      phase: data,
      runtimeUpdated: true,
      participantsUpdated: updated,
      participantsOffline: offline,
    });
  } catch (runtimeError) {
    const message = runtimeError instanceof Error
      ? runtimeError.message
      : "LIVEKIT_PHASE_SYNC_FAILED";
    console.error("conference-phase-control: LiveKit sync failed", runtimeError);

    await service.rpc("complete_conference_phase_enforcement", {
      p_event_id: eventId,
      p_success: false,
      p_error: message,
      p_participants_updated: 0,
      p_participants_offline: participantPolicies.length,
    });

    return reply(502, {
      error: "LIVEKIT_PHASE_SYNC_PENDING",
      phase: data,
    });
  }
});
