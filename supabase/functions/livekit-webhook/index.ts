import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { WebhookReceiver } from "npm:livekit-server-sdk@2.18.0";

const jsonHeaders = { "Content-Type": "application/json" };

function jsonSafe<T>(value: T): Record<string, unknown> {
  return JSON.parse(JSON.stringify(
    value,
    (_key, item) => typeof item === "bigint" ? item.toString() : item,
  )) as Record<string, unknown>;
}

function nestedObject(
  value: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object"
    ? child as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: jsonHeaders },
    );
  }

  const apiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    ?? Deno.env.get("SERVICE_ROLE_KEY")
    ?? "";

  if (!apiKey || !apiSecret || !supabaseUrl || !serviceRoleKey) {
    return new Response(
      JSON.stringify({ error: "WEBHOOK_NOT_CONFIGURED" }),
      { status: 503, headers: jsonHeaders },
    );
  }

  const rawBody = await req.text();
  const authHeader = req.headers.get("Authorization") ?? "";

  let received: unknown;
  try {
    received = await new WebhookReceiver(
      apiKey,
      apiSecret,
    ).receive(rawBody, authHeader);
  } catch (error) {
    console.warn(
      "livekit-webhook: signature validation failed",
      error,
    );
    return new Response(
      JSON.stringify({ error: "INVALID_WEBHOOK_SIGNATURE" }),
      { status: 401, headers: jsonHeaders },
    );
  }

  const event = jsonSafe(received);
  const eventId = stringValue(event.id);

  // LiveKit webhook IDs are the idempotency key. Rejecting an event without
  // one is safer than applying a non-idempotent lifecycle mutation.
  if (!eventId) {
    return new Response(
      JSON.stringify({ error: "WEBHOOK_EVENT_ID_REQUIRED" }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const room = nestedObject(event, "room");
  const participant = nestedObject(event, "participant");
  const egressInfo = nestedObject(event, "egressInfo");

  const roomName =
    stringValue(room?.name)
    ?? stringValue(egressInfo?.roomName)
    ?? null;

  const participantIdentity =
    stringValue(participant?.identity)
    ?? null;

  const egressId =
    stringValue(egressInfo?.egressId)
    ?? null;

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data, error } = await admin.rpc(
    "apply_livekit_webhook_event_v1",
    {
      p_event_type: stringValue(event.event) ?? "unknown",
      p_event_id: eventId,
      p_room_name: roomName,
      p_participant_identity: participantIdentity,
      p_egress_id: egressId,
      p_payload: event,
    },
  );

  if (error) {
    console.error(
      "livekit-webhook: state sync failed",
      { code: error.code },
    );
    return new Response(
      JSON.stringify({ error: "STATE_SYNC_FAILED" }),
      { status: 500, headers: jsonHeaders },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      duplicate: Boolean(data?.duplicate),
    }),
    { status: 200, headers: jsonHeaders },
  );
});
