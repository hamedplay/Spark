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

function isParticipantMissing(error: unknown): boolean {
  const record = asRecord(error);
  const status = Number(record?.status ?? 0);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return status === 404 || message.includes("not found");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });

  const workerSecret = req.headers.get("X-Speaker-Timer-Secret") ?? "";
  if (!workerSecret) return reply(401, { error: "WORKER_AUTH_REQUIRED" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";
  const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: secretValid, error: secretError } = await service.rpc(
    "verify_conference_speaker_timer_worker_secret",
    { p_secret: workerSecret },
  );
  if (secretError || secretValid !== true) {
    return reply(403, { error: "WORKER_AUTH_FAILED" });
  }

  let body: { sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }
  if (!body.sessionId) return reply(400, { error: "SESSION_ID_REQUIRED" });

  const { data, error } = await service.rpc("claim_conference_speaker_enforcement", {
    p_session_id: body.sessionId,
  });
  if (error || !data?.ok) {
    return reply(404, { error: String(data?.reason || error?.message || "SESSION_NOT_FOUND").toUpperCase() });
  }
  if (data.already_done === true) return reply(200, { ok: true, alreadyDone: true });

  const sessionId = String(data.session_id || body.sessionId);
  const roomName = String(data.livekit_room_name || "");
  const userId = String(data.user_id || "");
  const status = String(data.status || "");
  const policy = parsePolicy(data.livekit_policy);
  if (!roomName || !userId || !policy.ok) {
    await service.rpc("complete_conference_speaker_enforcement", {
      p_session_id: sessionId,
      p_success: false,
      p_error: "ENFORCEMENT_PAYLOAD_INVALID",
      p_runtime_updated: false,
    });
    return reply(500, { error: "ENFORCEMENT_PAYLOAD_INVALID" });
  }

  const roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret);
  try {
    const participant = await roomService.getParticipant(roomName, userId);
    if (status === "PAUSED" || status === "EXPIRED" || status === "COMPLETED") {
      const audioTracks = participant.tracks.filter((track) =>
        String(track.mimeType || "").startsWith("audio/")
      );
      for (const track of audioTracks) {
        await roomService.mutePublishedTrack(roomName, userId, track.sid, true);
      }
    }

    await roomService.updateParticipant(roomName, userId, {
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

    const message = runtimeError instanceof Error ? runtimeError.message : "LIVEKIT_SYNC_FAILED";
    console.error("conference-speaker-timer-enforcer failed", runtimeError);
    await service.rpc("complete_conference_speaker_enforcement", {
      p_session_id: sessionId,
      p_success: false,
      p_error: message,
      p_runtime_updated: false,
    });
    return reply(502, { error: "LIVEKIT_SYNC_FAILED" });
  }
});
