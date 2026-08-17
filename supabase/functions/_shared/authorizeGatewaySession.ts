import type { SupabaseClient } from "npm:@supabase/supabase-js@2.112.3";

export interface GatewayAuthorizationInput {
  adminClient: SupabaseClient;
  accessToken: string;
  expectedUserId: string;
  loginMethod: "public_registration";
  identifierHash: string;
  ipHash: string;
}

export interface GatewayAuthorizationResult {
  authorized: boolean;
}

function base64UrlDecode(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export function getSessionIdFromAccessToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return typeof payload.session_id === "string" && isValidUuid(payload.session_id)
      ? payload.session_id
      : null;
  } catch {
    return null;
  }
}

function hasPasswordAmr(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((item: any) => item?.method === "password");
}

export async function authorizeGatewaySession(
  input: GatewayAuthorizationInput,
): Promise<GatewayAuthorizationResult> {
  const { adminClient, accessToken, expectedUserId, loginMethod, identifierHash, ipHash } = input;

  let jwtPayload: { sub?: string; session_id?: string; amr?: unknown };
  try {
    const parts = accessToken.split(".");
    if (parts.length < 2) return { authorized: false };
    const payloadJson = base64UrlDecode(parts[1]);
    jwtPayload = JSON.parse(payloadJson);
  } catch {
    return { authorized: false };
  }

  if (jwtPayload.sub !== expectedUserId) return { authorized: false };

  const sessionId = jwtPayload.session_id;
  if (typeof sessionId !== "string" || !isValidUuid(sessionId)) return { authorized: false };

  if (!hasPasswordAmr(jwtPayload.amr)) return { authorized: false };

  const { data: userData, error: userErr } = await adminClient.auth.getUser(accessToken);
  if (userErr || !userData?.user || userData.user.id !== expectedUserId) {
    return { authorized: false };
  }

  const { data: authData, error: authErr } = await adminClient.rpc(
    "authorize_password_gateway_session_v1",
    {
      p_session_id: sessionId,
      p_user_id: expectedUserId,
      p_login_method: loginMethod,
      p_identifier_hash: identifierHash,
      p_ip_hash: ipHash,
    },
  );

  if (authErr || !authData) return { authorized: false };

  const authRow = Array.isArray(authData) ? authData[0] : authData;
  if (!authRow || authRow.authorized !== true) return { authorized: false };

  return { authorized: true };
}

export async function revokeLocalSession(accessToken: string): Promise<void> {
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/auth/v1/logout?scope=local`;
    await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        "Content-Type": "application/json",
      },
    });
  } catch {
    // Suppress — session will be unusable once gate is enabled
  }
}
