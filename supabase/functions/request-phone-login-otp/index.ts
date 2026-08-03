import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return '';
}

async function hmacHash(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join("");
}

function getClientIP(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  if (!first) return "unknown";
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(first)) return first;
  if (/^[0-9a-fA-F:]+$/.test(first) && first.includes(":")) return first;
  return "unknown";
}

function buildCorsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowed = allowedOrigins.includes(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    "Vary": "Origin",
  };
}

const TARGET_MIN_MS = 5200;
const TARGET_MAX_MS = 5400;

async function finishPublicResponse(
  startedAt: number,
  response: Response,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) {
    await new Promise(resolve => setTimeout(resolve, target - elapsed));
  }
  return new Response(response.body, {
    status: response.status,
    headers: { ...response.headers, ...corsHeaders },
  });
}

function publicResponse(corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // signInWithOtp must use the anon key so GoTrue creates a real OTP challenge
  // and triggers the SMS hook. The service role key bypasses the OTP flow.
  const anonSupabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Load allowed origins from system_config ───────────────────────────────
  let allowedOrigins: string[] = [];
  try {
    const { data: originsRow } = await supabase
      .from("system_config").select("value")
      .eq("section", "security").eq("key", "phone_login_allowed_origins")
      .maybeSingle();
    if (originsRow?.value) {
      allowedOrigins = originsRow.value
        .split(",")
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
    }
  } catch {
    // fail-closed: no origins loaded
  }

  const corsHeaders = buildCorsHeaders(req, allowedOrigins);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
  }

  try {
    const body = await req.json();
    const rawPhone: string | undefined = body.phone;

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    // ── Read computed config from get_public_auth_config ─────────────────────
    const { data: cfgRow, error: cfgErr } = await supabase.rpc("get_public_auth_config");
    if (cfgErr) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }
    const cfg = Array.isArray(cfgRow) ? cfgRow[0] : cfgRow;
    const publicReady = cfg?.phone_login_ready === true;
    const testReady = cfg?.phone_login_test_ready === true;

    let allowDispatch = false;

    if (publicReady) {
      allowDispatch = true;
    } else if (testReady) {
      // testReady already incorporates phone_login_test_mode=true
      // Read the test phone to compare
      const { data: testPhoneRow } = await supabase
        .from("system_config").select("value")
        .eq("section", "security").eq("key", "phone_login_test_phone")
        .maybeSingle();
      const normalizedTestPhone = normalizeIranPhone(testPhoneRow?.value || "");

      if (normalizedTestPhone && normalized === normalizedTestPhone) {
        allowDispatch = true;
      }
    }

    if (!allowDispatch) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    // ── Resolve profile + auth user BEFORE sending OTP ──────────────────────
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active")
      .eq("is_active", true)
      .filter("phone", "eq", normalized)
      .maybeSingle();

    let resolvedProfile = profile;
    if (!resolvedProfile) {
      const { data: profileByRaw } = await supabase
        .from("profiles")
        .select("user_id, phone, is_active")
        .eq("is_active", true)
        .filter("phone", "ilike", `%${normalized.slice(-10)}%`)
        .maybeSingle();
      resolvedProfile = profileByRaw;
    }

    if (!resolvedProfile) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(resolvedProfile.user_id);
    if (authErr || !authUser?.user) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    const authPhoneNorm = normalizeIranPhone(authUser.user.phone);
    if (authPhoneNorm !== normalized) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    // ── Rate limit ──────────────────────────────────────────────────────────
    const pepper = Deno.env.get("PHONE_RATE_LIMIT_PEPPER") || "";
    if (!pepper || pepper.length < 32) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    let phoneHash: string;
    let ipHash: string;
    try {
      const clientIP = getClientIP(req);
      phoneHash = await hmacHash(normalized, pepper);
      ipHash = await hmacHash(clientIP, pepper);
    } catch {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    let rateLimitResult: { allowed: boolean; retry_after_seconds: number };
    try {
      const { data: rlRaw, error: rlErr } = await supabase.rpc(
        "consume_phone_otp_rate_limit",
        { p_phone_hash: phoneHash, p_ip_hash: ipHash },
      );
      if (rlErr) {
        return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
      }
      rateLimitResult = typeof rlRaw === "string" ? JSON.parse(rlRaw) : rlRaw;
    } catch {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    if (!rateLimitResult.allowed) {
      return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
    }

    // ── Call signInWithOtp with shouldCreateUser: false ─────────────────────
    const e164 = `+${normalized}`;
    try {
      await anonSupabase.auth.signInWithOtp({
        phone: e164,
        options: { shouldCreateUser: false, channel: "sms" },
      });
    } catch {
      // Never reveal whether the phone exists
    }

    return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);

  } catch {
    return await finishPublicResponse(startedAt, publicResponse(corsHeaders), corsHeaders);
  }
});
