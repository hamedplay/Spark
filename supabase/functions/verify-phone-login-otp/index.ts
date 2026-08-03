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

async function hmacHash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
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

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const GENERIC_ERROR = JSON.stringify({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });

async function finishResponse(
  startedAt: number,
  response: Response,
  cors: Record<string, string>,
): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const target = 1500 + Math.floor(Math.random() * 200);
  if (elapsed < target) {
    await new Promise(resolve => setTimeout(resolve, target - elapsed));
  }
  return new Response(response.body, {
    status: response.status,
    headers: { ...response.headers, ...cors },
  });
}

function genericErrorResponse(cors: Record<string, string>): Response {
  return new Response(GENERIC_ERROR,
    { status: 400, headers: { "Content-Type": "application/json", ...cors } });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let allowedOrigins: string[] = [];
  try {
    const { data: originsRow } = await supabase
      .from("system_config").select("value")
      .eq("section", "security").eq("key", "phone_login_allowed_origins")
      .maybeSingle();
    if (originsRow?.value) {
      allowedOrigins = originsRow.value
        .split(",").map((s: string) => s.trim()).filter((s: string) => s.length > 0);
    }
  } catch { /* fail-closed */ }

  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : null;
  const cors = corsHeaders(allowedOrigin);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  if (!allowedOrigin) {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  const contentType = req.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }
  if (bodyText.length > 4096) {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  try {
    let body: { phone?: string; otp?: string };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const rawPhone: string | undefined = body.phone;
    const otp: string | undefined = body.otp;

    if (!rawPhone || !otp || !/^\d{6}$/.test(otp)) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Check canonical login readiness
    const { data: cfgRow, error: cfgErr } = await supabase.rpc("get_public_auth_config");
    if (cfgErr) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const cfg = Array.isArray(cfgRow) ? cfgRow[0] : cfgRow;
    if (!cfg?.phone_login_canonical_ready) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Rate limit for verify attempts
    const pepper = Deno.env.get("PHONE_RATE_LIMIT_PEPPER") || "fallback-pepper-min-32-chars-padding!!";
    const clientIP = getClientIP(req);
    const phoneHash = await hmacHash(normalized, pepper);
    const ipHash = await hmacHash(clientIP, pepper);

    const { data: rlData, error: rlErr } = await supabase.rpc(
      "consume_phone_login_verify_rate_limit",
      { p_phone_hash: phoneHash, p_ip_hash: ipHash },
    );
    if (rlErr || !rlData) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const rlRow = Array.isArray(rlData) ? rlData[0] : rlData;
    if (!rlRow?.allowed) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Verify OTP via Supabase Auth
    const e164 = `+${normalized}`;
    const { data: verifyData, error: verifyErr } = await supabase.auth.verifyOtp({
      phone: e164,
      token: otp,
      type: "sms",
    });

    if (verifyErr || !verifyData?.session || !verifyData?.user) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const authUser = verifyData.user;
    const session = verifyData.session;

    // Server-side checks: profile exists, active, phone match
    const { data: profileData } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active")
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (!profileData) {
      await supabase.auth.signOut();
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    if (profileData.is_active !== true) {
      await supabase.auth.signOut();
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const authPhone = normalizeIranPhone(authUser.phone);
    const profilePhone = normalizeIranPhone(profileData.phone);
    const inputPhone = normalized;

    if (!profilePhone || profilePhone !== inputPhone) {
      await supabase.auth.signOut();
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    if (!authPhone || authPhone !== inputPhone) {
      await supabase.auth.signOut();
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // All checks passed — return session tokens
    return await finishResponse(startedAt,
      new Response(JSON.stringify({
        ok: true,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      }), { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);

  } catch {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }
});
