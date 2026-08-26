import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { WebhookReceiver } from "npm:livekit-server-sdk@2.18.0";

const jsonHeaders = { "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: jsonHeaders });
  }

  const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (!apiKey || !apiSecret || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "WEBHOOK_NOT_CONFIGURED" }), { status: 503, headers: jsonHeaders });
  }

  const rawBody = await req.text();
  const authHeader = req.headers.get("Authorization") ?? "";
  let event: any;
  try {
    event = await new WebhookReceiver(apiKey, apiSecret).receive(rawBody, authHeader);
  } catch (error) {
    console.warn("livekit-webhook: signature validation failed", error);
    return new Response(JSON.stringify({ error: "INVALID_WEBHOOK_SIGNATURE" }), { status: 401, headers: jsonHeaders });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("apply_livekit_webhook_event_v1", {
    p_event_type: String(event?.event ?? "unknown"),
    p_event_id: event?.id ? String(event.id) : null,
    p_room_name: event?.room?.name ? String(event.room.name) : null,
    p_participant_identity: event?.participant?.identity ? String(event.participant.identity) : null,
    p_egress_id: event?.egressInfo?.egressId ? String(event.egressInfo.egressId) : null,
    p_payload: event,
  });
  if (error) {
    console.error("livekit-webhook: state sync failed", { code: error.code });
    return new Response(JSON.stringify({ error: "STATE_SYNC_FAILED" }), { status: 500, headers: jsonHeaders });
  }
  return new Response(JSON.stringify({ ok: true, duplicate: Boolean(data?.duplicate) }), { status: 200, headers: jsonHeaders });
});
