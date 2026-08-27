import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { AccessToken, RoomServiceClient, TrackSource } from "npm:livekit-server-sdk@2.18.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const sourceMap: Record<string, TrackSource> = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
  screen_share: TrackSource.SCREEN_SHARE,
  screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO,
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function livekitApiUrl(url: string): string {
  return url.replace(/^wss:/i, "https:").replace(/^ws:/i, "http:").replace(/\/$/, "");
}

function livekitWsUrl(url: string): string {
  return url.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:").replace(/\/$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? value as Record<string, unknown>
    : null;
}

function parseLiveKitPolicy(value: unknown) {
  const payload = asRecord(value);
  const sourceNames = Array.isArray(payload?.publish_sources)
    ? payload.publish_sources.filter((item): item is string => typeof item === "string" && item in sourceMap)
    : [];

  return {
    ok: payload?.ok === true,
    role: typeof payload?.role === "string" ? payload.role : "",
    canPublish: payload?.can_publish === true,
    canSubscribe: payload?.can_subscribe === true,
    canPublishData: payload?.can_publish_data === true,
    sourceNames,
    publishSources: sourceNames.map((source) => sourceMap[source]),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+.+/i.test(authHeader)) return json(401, { error: "NOT_AUTHENTICATED" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const configuredLivekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
  const configuredLivekitWsUrl = Deno.env.get("LIVEKIT_WS_URL") ?? "";
  const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
  const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";

  if (!supabaseUrl || !anonKey || !configuredLivekitUrl || !livekitApiKey || !livekitApiSecret) {
    console.error("conference-livekit-token: server configuration incomplete");
    return json(503, { error: "CONFERENCE_NOT_CONFIGURED" });
  }

  const apiUrl = livekitApiUrl(configuredLivekitUrl);
  const browserWsUrl = livekitWsUrl(configuredLivekitWsUrl || configuredLivekitUrl);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authUserData, error: authUserError } = await userClient.auth.getUser();
  const authUser = authUserData?.user;
  if (authUserError || !authUser?.id) return json(401, { error: "NOT_AUTHENTICATED" });
  if ((authUser as unknown as { is_anonymous?: boolean }).is_anonymous === true) {
    return json(403, { error: "NOT_AUTHORIZED" });
  }

  const { data: accessState, error: accessError } = await userClient.rpc("get_my_auth_access_state");
  if (accessError || !accessState || accessState.access_level !== "FULL" || accessState.user_id !== authUser.id) {
    return json(403, { error: "NOT_AUTHORIZED" });
  }

  let body: { roomId?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "INVALID_BODY" });
  }

  if (!body.roomId || typeof body.roomId !== "string") {
    return json(400, { error: "ROOM_ID_REQUIRED" });
  }

  const { data: join, error: joinError } = await userClient.rpc("prepare_livekit_conference_join", {
    p_room_id: body.roomId,
  });

  if (joinError) {
    console.error("conference-livekit-token: join rpc failed", { code: joinError.code });
    return json(500, { error: "TOKEN_FAILED" });
  }

  if (!join?.ok) {
    const reason = String(join?.reason ?? "not_authorized");
    const status = reason === "waiting_for_admission" ? 202
      : reason === "room_full" ? 409
      : reason === "room_locked" ? 423
      : 403;
    return json(status, { error: reason.toUpperCase(), reason });
  }

  const { data: policyData, error: policyError } = await userClient.rpc(
    "get_my_livekit_conference_policy",
    { p_room_id: body.roomId },
  );
  const livekitPolicy = parseLiveKitPolicy(policyData);
  if (policyError || !livekitPolicy.ok) {
    console.error("conference-livekit-token: permission policy failed", { code: policyError?.code });
    return json(403, { error: "LIVEKIT_PERMISSION_DENIED" });
  }

  const roomName = String(join.livekit_room_name ?? "");
  if (!roomName) return json(500, { error: "ROOM_NAME_MISSING" });

  const maxParticipants = Math.min(Math.max(Number(join.max_participants) || 20, 1), 20);
  const roomService = new RoomServiceClient(apiUrl, livekitApiKey, livekitApiSecret);
  try {
    const existing = await roomService.listRooms([roomName]);
    if (existing.length === 0) {
      await roomService.createRoom({
        name: roomName,
        emptyTimeout: 300,
        departureTimeout: 60,
        maxParticipants,
        metadata: JSON.stringify({ sparkRoomId: body.roomId }),
      });
    }
  } catch (error) {
    console.error("conference-livekit-token: room provisioning failed", error);
    return json(503, { error: "LIVEKIT_ROOM_PROVISION_FAILED" });
  }

  const role = String(join.role ?? "member");
  const displayName = String(join.display_name ?? authUser.user_metadata?.full_name ?? "");
  const token = new AccessToken(livekitApiKey, livekitApiSecret, {
    identity: authUser.id,
    name: displayName,
    ttl: "10m",
    metadata: JSON.stringify({
      role,
      rbacRole: livekitPolicy.role,
      sparkRoomId: body.roomId,
    }),
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: livekitPolicy.canPublish,
    canSubscribe: livekitPolicy.canSubscribe,
    canPublishData: livekitPolicy.canPublishData,
    canPublishSources: livekitPolicy.publishSources,
    roomAdmin: false,
  });

  const jwt = await token.toJwt();
  return json(200, {
    token: jwt,
    serverUrl: browserWsUrl,
    roomName,
    role,
    rbacRole: livekitPolicy.role,
    livekitPolicy: {
      canPublish: livekitPolicy.canPublish,
      canSubscribe: livekitPolicy.canSubscribe,
      canPublishData: livekitPolicy.canPublishData,
      publishSources: livekitPolicy.sourceNames,
    },
    maxParticipants,
    expiresInSeconds: 600,
  });
});
