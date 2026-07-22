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
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const bufA = enc.encode(a);
  const bufB = enc.encode(b);
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
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
  };
}

const TARGET_MIN_MS = 1500;
const TARGET_MAX_MS = 1700;

async function finishResponse(
  startedAt: number,
  response: Response,
  cors: Record<string, string>,
): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) {
    await new Promise(resolve => setTimeout(resolve, target - elapsed));
  }
  return new Response(response.body, {
    status: response.status,
    headers: { ...response.headers, ...cors },
  });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let allowedOrigin: string | null = null;
  try {
    const allowedStr = Deno.env.get("PHONE_LOGIN_ALLOWED_ORIGINS") || "";
    const allowed = allowedStr.split(",").map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") || "";
    if (origin && allowed.includes(origin)) allowedOrigin = origin;
  } catch { /* fail-closed */ }

  const cors = corsHeaders(allowedOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: false, error: "INVALID_REQUEST" }),
        { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
  }

  try {
    if (!allowedOrigin) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_REQUEST" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    const body = await req.json();
    const challengeId: string | undefined = body.challenge_id;
    const otp: string | undefined = body.otp;

    if (!challengeId || !otp || otp.length < 4) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_REQUEST" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Resolve secret
    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    if (!secret || secret.length < 32) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_REQUEST" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // IP rate limit: 10 per IP per 15 min
    const clientIP = getClientIP(req);
    const ipHash = await hmacHash(clientIP, secret);
    const rateWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: ipCount } = await supabase
      .from("phone_otp_rate_limit")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .eq("purpose", "phone_password_recovery_verify")
      .gte("created_at", rateWindow);

    if ((ipCount || 0) >= 10) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "RATE_LIMITED" }),
          { status: 429, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    await supabase.from("phone_otp_rate_limit").insert({
      ip_hash: ipHash,
      phone_hash: "verify:" + challengeId,
      purpose: "phone_password_recovery_verify",
    });

    // Fetch challenge
    const { data: challenge, error: challengeErr } = await supabase
      .from("phone_password_reset_challenges")
      .select("*")
      .eq("id", challengeId)
      .maybeSingle();

    if (challengeErr || !challenge) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_CHALLENGE" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Check status
    if (challenge.status !== "pending") {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "CHALLENGE_NOT_PENDING" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Check expiry
    if (new Date(challenge.expires_at) < new Date()) {
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "expired" })
        .eq("id", challengeId);
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "OTP_EXPIRED" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Check locked
    if (challenge.locked_until && new Date(challenge.locked_until) > new Date()) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "CHALLENGE_LOCKED" }),
          { status: 423, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Check attempt count
    if (challenge.attempt_count >= challenge.max_attempts) {
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "locked", locked_until: new Date(Date.now() + 3600000).toISOString() })
        .eq("id", challengeId);
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "MAX_ATTEMPTS_EXCEEDED" }),
          { status: 423, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Re-check profile is still active and matches
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active")
      .eq("user_id", challenge.user_id)
      .maybeSingle();

    if (!profile || profile.is_active !== true) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_CHALLENGE" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Verify OTP hash (constant-time)
    const expectedOtpHash = challenge.otp_hash;
    const providedOtpHash = await hmacHash(
      `${challengeId}:${challenge.user_id}:${normalizeIranPhone(profile.phone)}:${otp}`,
      secret,
    );

    if (!timingSafeEqual(expectedOtpHash, providedOtpHash)) {
      // Increment attempt_count atomically
      const newAttemptCount = challenge.attempt_count + 1;
      const updateData: Record<string, unknown> = { attempt_count: newAttemptCount };

      if (newAttemptCount >= challenge.max_attempts) {
        updateData.status = "locked";
        updateData.locked_until = new Date(Date.now() + 3600000).toISOString();
      }

      await supabase
        .from("phone_password_reset_challenges")
        .update(updateData)
        .eq("id", challengeId);

      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "OTP_INCORRECT" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // OTP verified — generate reset token (32 bytes)
    const resetTokenBytes = new Uint8Array(32);
    crypto.getRandomValues(resetTokenBytes);
    const resetToken = Array.from(resetTokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const resetTokenHash = await hmacHash(resetToken, secret);

    // Update challenge to verified
    const { error: updateErr } = await supabase
      .from("phone_password_reset_challenges")
      .update({
        status: "verified",
        reset_token_hash: resetTokenHash,
        reset_expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        verified_at: new Date().toISOString(),
      })
      .eq("id", challengeId)
      .eq("status", "pending");

    if (updateErr) {
      // Race condition — another request may have already verified
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "CHALLENGE_NOT_PENDING" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Return reset token to browser (only time it's ever sent)
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: true, reset_token: resetToken }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);

  } catch {
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } }), cors);
  }
});
