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

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const TARGET_MIN_MS = 1500;
const TARGET_MAX_MS = 1700;

async function finishResponse(startedAt: number, response: Response, cors: Record<string, string>): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed));
  return new Response(response.body, { status: response.status, headers: { ...response.headers, ...cors } });
}

const GENERIC_ERROR = JSON.stringify({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });
function genericErrorResponse(cors: Record<string, string>): Response {
  return new Response(GENERIC_ERROR, { status: 400, headers: { "Content-Type": "application/json", ...cors } });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Read pepper and allowed origins directly from system_config
  const { data: pepperRow } = await supabase
    .from("system_config").select("value")
    .eq("section", "security").eq("key", "phone_auth_pepper")
    .maybeSingle();
  const pepper: string = pepperRow?.value || "";

  const { data: originsRow } = await supabase
    .from("system_config").select("value")
    .eq("section", "security").eq("key", "phone_login_allowed_origins")
    .maybeSingle();
  const allowedOrigins: string[] = (originsRow?.value || "").split(",").map(s => s.trim()).filter(Boolean);

  let allowedOrigin: string | null = null;
  try {
    const origin = req.headers.get("Origin") || "";
    if (origin && allowedOrigins.includes(origin)) allowedOrigin = origin;
  } catch { /* fail-closed */ }

  const cors = corsHeaders(allowedOrigin);

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });
  if (req.method !== "POST") return await finishResponse(startedAt, genericErrorResponse(cors), cors);

  try {
    if (!allowedOrigin) return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    if (!pepper || pepper.length < 32) {
      console.log(`[phone-verify ${requestId}] PEPPER_MISSING`);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const body = await req.json();
    const rawPhone: string | undefined = body.phone;
    const otp: string | undefined = body.otp;
    if (!rawPhone || !otp || otp.length < 4) return await finishResponse(startedAt, genericErrorResponse(cors), cors);

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) return await finishResponse(startedAt, genericErrorResponse(cors), cors);

    const phoneHash = await hmacHash(normalized, pepper);

    // Find active challenge
    const { data: challenges, error: challengeErr } = await supabase
      .from("phone_login_otp_challenges")
      .select("id, user_id, otp_hash, status, attempt_count, max_attempts, expires_at")
      .eq("phone_hash", phoneHash)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);

    if (challengeErr || !challenges || challenges.length === 0) {
      console.log(`[phone-verify ${requestId}] NO_CHALLENGE`);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const challenge = challenges[0];

    if (new Date(challenge.expires_at).getTime() < Date.now()) {
      await supabase.from("phone_login_otp_challenges").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", challenge.id);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    if (challenge.attempt_count >= challenge.max_attempts) {
      await supabase.from("phone_login_otp_challenges").update({ status: "locked", updated_at: new Date().toISOString() }).eq("id", challenge.id);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Verify OTP
    const providedOtpHash = await hmacHash(`${challenge.id}:${challenge.user_id}:${normalized}:${otp}`, pepper);
    if (!timingSafeCompare(providedOtpHash, challenge.otp_hash)) {
      await supabase.from("phone_login_otp_challenges").update({ attempt_count: challenge.attempt_count + 1, updated_at: new Date().toISOString() }).eq("id", challenge.id);
      console.log(`[phone-verify ${requestId}] WRONG_OTP`);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Mark verified
    await supabase.from("phone_login_otp_challenges").update({ status: "verified", updated_at: new Date().toISOString() }).eq("id", challenge.id);
    console.log(`[phone-verify ${requestId}] OTP_VERIFIED user=${challenge.user_id.slice(0, 8)}`);

    // Create session via magic link
    const { data: userData } = await supabase.auth.admin.getUserById(challenge.user_id);
    const userEmail = userData?.user?.email;
    if (!userEmail) {
      console.log(`[phone-verify ${requestId}] NO_EMAIL`);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: userEmail,
    });

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.log(`[phone-verify ${requestId}] LINK_FAILED:`, linkErr?.message);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Exchange magic link token for session
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: verifyData, error: verifyErr } = await anonClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });

    if (verifyErr || !verifyData?.session) {
      console.log(`[phone-verify ${requestId}] SESSION_FAILED:`, verifyErr?.message);
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    console.log(`[phone-verify ${requestId}] SESSION_CREATED user=${challenge.user_id.slice(0, 8)}`);

    return await finishResponse(startedAt,
      new Response(JSON.stringify({
        ok: true,
        access_token: verifyData.session.access_token,
        refresh_token: verifyData.session.refresh_token,
        user_id: challenge.user_id,
      }), { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);

  } catch (err) {
    console.log(`[phone-verify ${requestId}] ERROR:`, err?.message || "unknown");
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }
});
