import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const ACTIONS = new Set(["create", "open", "close", "vote", "delete"]);
const POLL_TYPES = new Set([
  "SINGLE_CHOICE",
  "MULTIPLE_CHOICE",
  "YES_NO",
  "TRUE_FALSE",
]);
const RESULT_VISIBILITY = new Set([
  "LIVE",
  "AFTER_VOTE",
  "AFTER_CLOSE",
  "HIDDEN",
]);

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers });

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
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

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: "INVALID_BODY" });
  }

  const roomId = typeof body.roomId === "string" ? body.roomId : "";
  const action = typeof body.action === "string"
    ? body.action.toLowerCase()
    : "";
  const pollId = typeof body.pollId === "string" ? body.pollId : null;

  if (!roomId || !ACTIONS.has(action)) {
    return reply(400, { error: "ROOM_AND_ACTION_REQUIRED" });
  }
  if (action !== "create" && !pollId) {
    return reply(400, { error: "POLL_ID_REQUIRED" });
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
    "authorize_conference_poll_action",
    {
      p_room_id: roomId,
      p_action: action,
      p_poll_id: pollId,
    },
  );

  if (authorizationError || !authorization?.ok) {
    return reply(403, {
      error: String(
        authorization?.reason
        || authorizationError?.message
        || "POLL_ACTION_FORBIDDEN",
      ).toUpperCase(),
    });
  }

  let payload: Record<string, unknown> = {};

  if (action === "create") {
    const pollType = typeof body.pollType === "string"
      ? body.pollType.toUpperCase()
      : "SINGLE_CHOICE";
    const resultVisibility = typeof body.resultVisibility === "string"
      ? body.resultVisibility.toUpperCase()
      : "LIVE";

    if (!POLL_TYPES.has(pollType) || !RESULT_VISIBILITY.has(resultVisibility)) {
      return reply(400, { error: "INVALID_POLL_CONFIG" });
    }

    const options = Array.isArray(body.options)
      ? body.options.filter((item): item is string => typeof item === "string")
      : [];
    const timeLimitSeconds = optionalInteger(body.timeLimitSeconds);

    if (
      body.timeLimitSeconds !== undefined
      && body.timeLimitSeconds !== null
      && body.timeLimitSeconds !== ""
      && timeLimitSeconds === null
    ) {
      return reply(400, { error: "INVALID_TIME_LIMIT" });
    }

    payload = {
      question: typeof body.question === "string" ? body.question : "",
      pollType,
      options,
      anonymous: body.anonymous === true,
      resultVisibility,
      timeLimitSeconds,
      openImmediately: body.openImmediately !== false,
    };
  } else if (action === "vote") {
    payload = {
      optionIds: Array.isArray(body.optionIds)
        ? body.optionIds.filter((item): item is string => typeof item === "string")
        : [],
    };
  }

  const { data, error } = await service.rpc("apply_conference_poll_action", {
    p_room_id: roomId,
    p_actor_user_id: accessState.user_id,
    p_action: action,
    p_poll_id: pollId,
    p_payload: payload,
  });

  if (error || !data?.ok) {
    const reason = String(
      data?.reason || error?.message || "POLL_ACTION_FAILED",
    ).toUpperCase();

    const status = reason === "ALREADY_VOTED" ? 409
      : reason === "POLL_CLOSED" ? 409
      : reason === "POLL_NOT_DRAFT" ? 409
      : reason === "POLL_NOT_OPEN" ? 409
      : reason === "POLL_LIMIT_REACHED" ? 409
      : 400;

    return reply(status, { error: reason });
  }

  return reply(200, {
    ok: true,
    action,
    ...data,
  });
});
