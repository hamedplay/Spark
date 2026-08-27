import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, EncodingOptionsPreset } from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });

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
  const storageBucket = Deno.env.get("RECORDING_STORAGE_BUCKET") ?? "";
  const storageRegion = Deno.env.get("RECORDING_STORAGE_REGION") ?? "";
  const storageAccessKey = Deno.env.get("RECORDING_STORAGE_ACCESS_KEY") ?? "";
  const storageSecret = Deno.env.get("RECORDING_STORAGE_SECRET_KEY") ?? "";
  const storageEndpoint = Deno.env.get("RECORDING_STORAGE_ENDPOINT") ?? "";

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !livekitUrl || !livekitApiKey || !livekitApiSecret) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: { roomId?: string; action?: "start" | "stop" };
  try { body = await req.json(); } catch { return reply(400, { error: "INVALID_BODY" }); }
  if (!body.roomId || !body.action) return reply(400, { error: "ROOM_ID_AND_ACTION_REQUIRED" });

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: accessState, error: accessError } = await userClient.rpc("get_my_auth_access_state");
  if (accessError || !accessState || accessState.access_level !== "FULL" || !accessState.user_id) {
    return reply(403, { error: "NOT_AUTHORIZED" });
  }

  const { data: authz, error: authzError } = await userClient.rpc("authorize_livekit_recording", { p_room_id: body.roomId, p_action: body.action });
  if (authzError || !authz?.ok) return reply(403, { error: String(authz?.reason || "NOT_AUTHORIZED").toUpperCase() });

  const egress = new EgressClient(livekitUrl, livekitApiKey, livekitApiSecret);

  if (body.action === "start") {
    if (!storageBucket || !storageAccessKey || !storageSecret) return reply(503, { error: "RECORDING_STORAGE_NOT_CONFIGURED" });

    const { data: existing } = await service.from("conference_recordings")
      .select("id,provider_egress_id,status").eq("room_id", body.roomId)
      .in("status", ["queued", "recording", "processing"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing) return reply(409, { error: "RECORDING_ALREADY_ACTIVE", recording: existing });

    const storagePath = `conference/${body.roomId}/${crypto.randomUUID()}.mp4`;
    const { data: recording, error: insertError } = await service.from("conference_recordings").insert({
      room_id: body.roomId,
      meeting_id: authz.meeting_id ?? null,
      provider: "livekit-egress",
      status: "queued",
      storage_path: storagePath,
      mime_type: "video/mp4",
      created_by: accessState.user_id,
      started_at: new Date().toISOString(),
    }).select("id").single();
    if (insertError || !recording) return reply(500, { error: "RECORDING_METADATA_FAILED" });

    try {
      const output = new EncodedFileOutput({
        fileType: EncodedFileType.MP4,
        filepath: storagePath,
        output: {
          case: "s3",
          value: new S3Upload({
            accessKey: storageAccessKey,
            secret: storageSecret,
            bucket: storageBucket,
            region: storageRegion,
            endpoint: storageEndpoint,
            forcePathStyle: Boolean(storageEndpoint),
          }),
        },
      });
      const info = await egress.startRoomCompositeEgress(String(authz.livekit_room_name), { file: output }, {
        layout: "grid",
        encodingOptions: EncodingOptionsPreset.H264_1080P_30,
        audioOnly: false,
        videoOnly: false,
      });

      await service.from("conference_recordings").update({ provider_egress_id: info.egressId, status: "recording", updated_at: new Date().toISOString() }).eq("id", recording.id);
      await service.from("conference_audit_events").insert({ room_id: body.roomId, actor_user_id: accessState.user_id, event_type: "recording_started", metadata: { recording_id: recording.id, egress_id: info.egressId } });
      return reply(200, { ok: true, recordingId: recording.id, status: "recording" });
    } catch (error) {
      console.error("conference-recording start failed", error);
      await service.from("conference_recordings").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 500) : "EGRESS_START_FAILED", updated_at: new Date().toISOString() }).eq("id", recording.id);
      return reply(502, { error: "RECORDING_FAILED" });
    }
  }

  const { data: recording, error: activeError } = await service.from("conference_recordings")
    .select("id,provider_egress_id").eq("room_id", body.roomId).in("status", ["queued", "recording"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (activeError || !recording?.provider_egress_id) return reply(404, { error: "ACTIVE_RECORDING_NOT_FOUND" });

  try {
    await service.from("conference_recordings").update({ status: "processing", updated_at: new Date().toISOString() }).eq("id", recording.id);
    await egress.stopEgress(recording.provider_egress_id);
    await service.from("conference_audit_events").insert({ room_id: body.roomId, actor_user_id: accessState.user_id, event_type: "recording_stopped", metadata: { recording_id: recording.id, egress_id: recording.provider_egress_id } });
    return reply(200, { ok: true, recordingId: recording.id, status: "processing" });
  } catch (error) {
    console.error("conference-recording stop failed", error);
    await service.from("conference_recordings").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 500) : "EGRESS_STOP_FAILED", updated_at: new Date().toISOString() }).eq("id", recording.id);
    return reply(502, { error: "RECORDING_FAILED" });
  }
});
