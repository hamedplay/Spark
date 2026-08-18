import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2.111.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

export interface FullAuthResult {
  ok: boolean;
  userClient: SupabaseClient | null;
  userId: string | null;
  error?: { status: number; message: string };
}

/**
 * Validates that the bearer token belongs to a user with FULL access.
 * Uses the user's own JWT + anon key to call get_my_auth_access_state RPC.
 * Never uses service-role context for user evaluation.
 * Returns 403 for restricted/blocked sessions.
 */
export async function requireFullAuthAccess(
  req: Request,
): Promise<FullAuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      ok: false,
      userClient: null,
      userId: null,
      error: { status: 401, message: "Authorization required" },
    };
  }

  const accessToken = match[1];

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data, error } = await userClient.rpc("get_my_auth_access_state");

    if (error || !data) {
      return {
        ok: false,
        userClient: null,
        userId: null,
        error: { status: 403, message: "AUTH_ACCESS_RESTRICTED" },
      };
    }

    const accessLevel = (data as Record<string, unknown>).access_level;
    const userId = (data as Record<string, unknown>).user_id as string | null;

    if (accessLevel !== "FULL") {
      return {
        ok: false,
        userClient: null,
        userId: userId ?? null,
        error: { status: 403, message: "AUTH_ACCESS_RESTRICTED" },
      };
    }

    return { ok: true, userClient, userId };
  } catch {
    return {
      ok: false,
      userClient: null,
      userId: null,
      error: { status: 403, message: "AUTH_ACCESS_RESTRICTED" },
    };
  }
}

/**
 * Evaluates one application permission in the caller's own JWT context.
 * The database helper includes the existing admin shortcut and FULL-session gate.
 */
export async function hasCurrentPermission(
  auth: FullAuthResult,
  permissionKey: string,
): Promise<boolean> {
  if (!auth.ok || !auth.userClient) return false;
  const { data, error } = await auth.userClient.rpc("has_current_permission_v1", {
    p_key: permissionKey,
  });
  return !error && data === true;
}

/**
 * Returns a JSON 403 response with a generic error code.
 */
export function deniedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "AUTH_ACCESS_RESTRICTED" }),
    {
      status: 403,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
      },
    },
  );
}
