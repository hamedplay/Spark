import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { RoomServiceClient } from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ACTIONS = new Set([
  "upsert_element",
  "delete_element",
  "add_page",
  "delete_page",
  "rename_page",
  "clear_page",
  "lock",
  "unlock",
]);

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

function livekitApiUrl(url: string): string {
  return url
    .replace(/^wss:/i, "https:")
    .replace(/^ws:/i, "http:")
    .replace(/\/$/, "");
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
    !supabaseUrl || !anonKey || !serviceRoleKey
    || !livekitUrl || !livekitApiKey || !livekitApiSecret
  ) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: {
    roomId?: string;
    action?: string;
    pageId?: string;
    payload?: Record<string, unknown>;
  };

  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.action || !ACTIONS.has(body.action)) {
    return reply(400, { error: "INVALID_ACTION" });
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
    "authorize_conference_whiteboard_action_v2",
    {
      p_room_id: body.roomId,
      p_action: body.action,
      p_page_id: body.pageId ?? null,
    },
  );

  if (authorizationError || !authorization?.ok) {
    return reply(403, {
      error: String(
        authorization?.reason
        || authorizationError?.message
        || "WHITEBOARD_ACTION_FORBIDDEN",
      ).toUpperCase(),
    });
  }

  const { data, error } = await service.rpc(
    "apply_conference_whiteboard_action_v2",
    {
      p_room_id: body.roomId,
      p_actor_user_id: accessState.user_id,
      p_action: body.action,
      p_page_id: body.pageId ?? null,
      p_payload: body.payload ?? {},
    },
  );

  if (error || !data?.ok) {
    return reply(409, {
      error: String(
        data?.reason || error?.message || "WHITEBOARD_ACTION_FAILED",
      ).toUpperCase(),
    });
  }

  if (data.operation && data.livekit_room_name) {
    const payload = new TextEncoder().encode(JSON.stringify(data.operation));
    if (payload.byteLength > 180000) {
      return reply(500, { error: "WHITEBOARD_OPERATION_TOO_LARGE" });
    }

    try {
      const roomService = new RoomServiceClient(
        livekitApiUrl(livekitUrl),
        livekitApiKey,
        livekitApiSecret,
      );

      // LiveKit protocol DataPacket.Kind.RELIABLE = 0.
      await roomService.sendData(
        String(data.livekit_room_name),
        payload,
        0,
        { topic: "spark-whiteboard-op" },
      );
    } catch (broadcastError) {
      console.error("conference-whiteboard-control: broadcast failed", broadcastError);
      return reply(503, {
        error: "WHITEBOARD_BROADCAST_FAILED",
        persisted: true,
        operation: data.operation,
      });
    }
  }

  return reply(200, {
    ok: true,
    operation: data.operation ?? null,
  });
});
