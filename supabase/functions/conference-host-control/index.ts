import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { EgressClient, RoomServiceClient } from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
type HostAction = "remove" | "mute" | "promote" | "demote" | "lock" | "unlock" | "end" | "lower-hand";

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
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });

  let body: { roomId?: string; action?: HostAction; targetUserId?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "INVALID_BODY" }); }
  if (!body.roomId || !body.action) return reply(400, { error: "ROOM_ID_AND_ACTION_REQUIRED" });
  const targetRequired = ["remove", "mute", "promote", "demote", "lower-hand"].includes(body.action);
  if (targetRequired && !body.targetUserId) return reply(400, { error: "TARGET_USER_ID_REQUIRED" });

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: accessState, error: accessError } = await userClient.rpc("get_my_auth_access_state");
  if (accessError || !accessState || accessState.access_level !== "FULL") return reply(403, { error: "NOT_AUTHORIZED" });

  const { data: authz, error: authzError } = await userClient.rpc("authorize_livekit_host_action", { p_room_id: body.roomId, p_target_user_id: body.targetUserId ?? null, p_action: body.action });
  if (authzError || !authz?.ok) return reply(403, { error: String(authz?.reason || "FORBIDDEN").toUpperCase() });

  const roomName = String(authz.livekit_room_name);
  const roomService = new RoomServiceClient(livekitUrl, livekitApiKey, livekitApiSecret);

  try {
    if (body.action === "lock" || body.action === "unlock") {
      const { data, error } = await userClient.rpc("set_livekit_room_lock", { p_room_id: body.roomId, p_locked: body.action === "lock" });
      if (error || !data?.ok) return reply(403, { error: String(data?.reason || "LOCK_FAILED").toUpperCase() });
      return reply(200, { ok: true, locked: body.action === "lock" });
    }

    if (body.action === "remove") {
      await roomService.removeParticipant(roomName, body.targetUserId!, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) });
      const { data, error } = await userClient.rpc("moderate_conference_participant", { p_room_id: body.roomId, p_target_user_id: body.targetUserId, p_action: "kick" });
      if (error || !data?.ok) return reply(500, { error: "DB_MODERATION_FAILED" });
      await service.from("conference_audit_events").insert({ room_id: body.roomId, actor_user_id: accessState.user_id, target_user_id: body.targetUserId, event_type: "participant_removed" });
      return reply(200, { ok: true });
    }

    if (body.action === "mute") {
      const participant = await roomService.getParticipant(roomName, body.targetUserId!);
      const audioTracks = participant.tracks.filter((track) => String(track.mimeType || "").startsWith("audio/"));
      for (const track of audioTracks) await roomService.mutePublishedTrack(roomName, body.targetUserId!, track.sid, true);
      const { data, error } = await userClient.rpc("moderate_conference_participant", { p_room_id: body.roomId, p_target_user_id: body.targetUserId, p_action: "mute" });
      if (error || !data?.ok) return reply(500, { error: "DB_MODERATION_FAILED" });
      await service.from("conference_audit_events").insert({ room_id: body.roomId, actor_user_id: accessState.user_id, target_user_id: body.targetUserId, event_type: "participant_muted" });
      return reply(200, { ok: true, mutedTracks: audioTracks.length });
    }

    if (body.action === "lower-hand") {
      const { data, error } = await userClient.rpc("moderate_conference_participant", { p_room_id: body.roomId, p_target_user_id: body.targetUserId, p_action: "lower_hand" });
      if (error || !data?.ok) return reply(500, { error: "LOWER_HAND_FAILED" });
      return reply(200, { ok: true });
    }

    if (body.action === "promote" || body.action === "demote") {
      const nextRole = body.action === "promote" ? "CO_HOST" : "PARTICIPANT";
      const { data, error } = await userClient.rpc("set_conference_participant_role", { p_room_id: body.roomId, p_target_user_id: body.targetUserId, p_role: nextRole });
      if (error || !data?.ok) return reply(403, { error: String(data?.reason || "ROLE_CHANGE_FAILED").toUpperCase() });
      await roomService.updateParticipant(roomName, body.targetUserId!, { metadata: JSON.stringify({ role: nextRole }), permission: { canPublish: true, canSubscribe: true, canPublishData: true } });
      await service.from("conference_audit_events").insert({ room_id: body.roomId, actor_user_id: accessState.user_id, target_user_id: body.targetUserId, event_type: "participant_permission_changed", metadata: { role: nextRole } });
      return reply(200, { ok: true, role: nextRole });
    }

    if (body.action === "end") {
      const egress = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);
      const { data: activeRecordings } = await service.from("conference_recordings").select("id,provider_egress_id").eq("room_id", body.roomId).in("status", ["starting", "active", "stopping"]);
      for (const recording of activeRecordings || []) {
        if (recording.provider_egress_id) {
          try { await egress.stopEgress(recording.provider_egress_id); } catch (error) { console.error("conference-host-control: egress stop failed", error); }
        }
        await service.from("conference_recordings").update({ status: "complete", ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", recording.id);
      }
      const { data, error } = await userClient.rpc("end_conference_room", { p_room_id: body.roomId, p_reason: "ended_by_host" });
      if (error || !data?.ok) return reply(500, { error: "END_ROOM_FAILED" });
      try { await roomService.deleteRoom(roomName); } catch (error) { console.error("conference-host-control: LiveKit room delete failed", error); }
      await service.from("conference_audit_events").insert({ room_id: body.roomId, actor_user_id: accessState.user_id, event_type: "meeting_ended" });
      return reply(200, { ok: true });
    }

    return reply(400, { error: "UNKNOWN_ACTION" });
  } catch (error) {
    console.error("conference-host-control failed", { action: body.action, error });
    return reply(502, { error: "HOST_ACTION_FAILED" });
  }
});
