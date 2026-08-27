import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

type PrivateChatAction = "send" | "edit" | "delete" | "read";

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
    action?: PrivateChatAction;
    messageId?: string;
    peerUserId?: string;
    body?: string;
    replyToId?: string;
  };

  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || !body.action) {
    return reply(400, { error: "ROOM_AND_ACTION_REQUIRED" });
  }
  if (!["send", "edit", "delete", "read"].includes(body.action)) {
    return reply(400, { error: "INVALID_ACTION" });
  }
  if (
    (body.action === "send" || body.action === "read")
    && !body.peerUserId
  ) {
    return reply(400, { error: "PEER_REQUIRED" });
  }
  if (
    (body.action === "edit" || body.action === "delete")
    && !body.messageId
  ) {
    return reply(400, { error: "MESSAGE_ID_REQUIRED" });
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
    "authorize_conference_private_chat_action",
    {
      p_room_id: body.roomId,
      p_action: body.action,
      p_message_id: body.messageId ?? null,
      p_peer_user_id: body.peerUserId ?? null,
    },
  );

  if (authorizationError || !authorization?.ok) {
    return reply(403, {
      error: String(
        authorization?.reason
        || authorizationError?.message
        || "PRIVATE_CHAT_ACTION_FORBIDDEN",
      ).toUpperCase(),
    });
  }

  const { data, error } = await service.rpc(
    "apply_conference_private_chat_action",
    {
      p_room_id: body.roomId,
      p_actor_user_id: accessState.user_id,
      p_action: body.action,
      p_message_id: body.messageId ?? null,
      p_peer_user_id: body.peerUserId ?? null,
      p_body: body.body ?? null,
      p_reply_to_id: body.replyToId ?? null,
    },
  );

  if (error || !data?.ok) {
    return reply(409, {
      error: String(
        data?.reason || error?.message || "PRIVATE_CHAT_ACTION_FAILED",
      ).toUpperCase(),
    });
  }

  return reply(200, {
    ok: true,
    action: body.action,
    ...data,
  });
});
