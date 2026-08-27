import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { RoomServiceClient } from "npm:livekit-server-sdk@2.18.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ALLOWED_REACTIONS = new Set(["👍", "❤️", "😂", "🎉", "👏", "😮"]);

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
    !supabaseUrl
    || !anonKey
    || !serviceRoleKey
    || !livekitUrl
    || !livekitApiKey
    || !livekitApiSecret
  ) {
    return reply(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  let body: { roomId?: string; reaction?: string };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || typeof body.roomId !== "string") {
    return reply(400, { error: "ROOM_ID_REQUIRED" });
  }
  if (
    !body.reaction
    || typeof body.reaction !== "string"
    || !ALLOWED_REACTIONS.has(body.reaction)
  ) {
    return reply(400, { error: "INVALID_REACTION" });
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

  const { data: context, error: contextError } = await userClient.rpc(
    "authorize_conference_reaction",
    { p_room_id: body.roomId },
  );

  if (contextError || !context?.ok) {
    const reason = String(
      context?.reason || contextError?.message || "REACTION_FORBIDDEN",
    ).toUpperCase();
    return reply(reason === "REACTIONS_DISABLED" ? 409 : 403, {
      error: reason,
    });
  }

  const { data: rate, error: rateError } = await service.rpc(
    "consume_conference_reaction_rate_limit",
    {
      p_room_id: body.roomId,
      p_actor_user_id: accessState.user_id,
    },
  );

  if (rateError) {
    console.error("conference-reaction: rate limiter failed", {
      code: rateError.code,
    });
    return reply(500, { error: "REACTION_RATE_LIMIT_FAILED" });
  }

  if (!rate?.ok) {
    return reply(429, {
      error: "RATE_LIMITED",
      retryAfterMs: Number(rate?.retry_after_ms || 1000),
    });
  }

  const event = {
    id: crypto.randomUUID(),
    reaction: body.reaction,
    participantIdentity: String(context.participant_identity || accessState.user_id),
    displayName: String(context.display_name || "شرکت‌کننده").slice(0, 120),
    avatarUrl: context.avatar_url
      ? String(context.avatar_url).slice(0, 512)
      : null,
    timestamp: new Date().toISOString(),
  };

  const payload = new TextEncoder().encode(JSON.stringify(event));
  if (payload.byteLength > 1200) {
    return reply(500, { error: "REACTION_PAYLOAD_TOO_LARGE" });
  }

  try {
    const roomService = new RoomServiceClient(
      livekitApiUrl(livekitUrl),
      livekitApiKey,
      livekitApiSecret,
    );

    // LiveKit protocol DataPacket.Kind.LOSSY = 1. Reactions are ephemeral
    // and should not block newer reactions behind retransmissions.
    await roomService.sendData(
      String(context.livekit_room_name),
      payload,
      1,
      { topic: "spark-reaction" },
    );
  } catch (error) {
    console.error("conference-reaction: LiveKit sendData failed", error);
    return reply(503, { error: "REACTION_DELIVERY_FAILED" });
  }

  return reply(200, {
    ok: true,
    event,
    remaining: Number(rate.remaining || 0),
  });
});
