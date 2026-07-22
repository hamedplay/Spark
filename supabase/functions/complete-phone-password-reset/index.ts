import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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
    const resetToken: string | undefined = body.reset_token;
    const newPassword: string | undefined = body.new_password;

    if (!challengeId || !resetToken || !newPassword) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_REQUEST" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Password validation
    if (newPassword.length < 8) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "PASSWORD_TOO_SHORT" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }
    if (newPassword.length > 128) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "PASSWORD_TOO_LONG" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(newPassword)) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "PASSWORD_WEAK" }),
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
      .eq("purpose", "phone_password_recovery_complete")
      .gte("created_at", rateWindow);

    if ((ipCount || 0) >= 10) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "RATE_LIMITED" }),
          { status: 429, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    await supabase.from("phone_otp_rate_limit").insert({
      ip_hash: ipHash,
      phone_hash: "complete:" + challengeId,
      purpose: "phone_password_recovery_complete",
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

    // Challenge rate limit: max 5 attempts
    if (challenge.attempt_count >= challenge.max_attempts) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "MAX_ATTEMPTS_EXCEEDED" }),
          { status: 423, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Status must be verified
    if (challenge.status !== "verified") {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "CHALLENGE_NOT_VERIFIED" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Check reset expiry
    if (challenge.reset_expires_at && new Date(challenge.reset_expires_at) < new Date()) {
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "expired" })
        .eq("id", challengeId);
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "RESET_TOKEN_EXPIRED" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Verify reset token hash (constant-time)
    const expectedTokenHash = challenge.reset_token_hash;
    if (!expectedTokenHash) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "INVALID_CHALLENGE" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    const providedTokenHash = await hmacHash(resetToken, secret);

    if (!timingSafeEqual(expectedTokenHash, providedTokenHash)) {
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
        new Response(JSON.stringify({ ok: false, error: "INVALID_RESET_TOKEN" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Re-check profile is still active
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, is_active")
      .eq("user_id", challenge.user_id)
      .maybeSingle();

    if (!profile || profile.is_active !== true) {
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "PROFILE_INACTIVE" }),
          { status: 400, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Atomically consume the challenge (prevent race condition)
    const { error: consumeErr } = await supabase
      .from("phone_password_reset_challenges")
      .update({
        status: "consumed",
        consumed_at: new Date().toISOString(),
        reset_token_hash: null,
      })
      .eq("id", challengeId)
      .eq("status", "verified");

    if (consumeErr) {
      // Race condition — another request already consumed
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "CHALLENGE_ALREADY_CONSUMED" }),
          { status: 409, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Change password server-side using admin API
    const { error: updatePasswordErr } = await supabase.auth.admin.updateUserById(
      challenge.user_id,
      { password: newPassword },
    );

    if (updatePasswordErr) {
      // Attempt to revert challenge status so user can retry
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "verified", reset_token_hash: expectedTokenHash, consumed_at: null })
        .eq("id", challengeId);

      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: false, error: "PASSWORD_UPDATE_FAILED" }),
          { status: 500, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Audit log (no password, no phone, no token)
    try {
      await supabase.from("audit_logs").insert({
        module: "auth",
        action: "phone_password_recovery",
        entity_name: "user",
        entity_id: challenge.user_id,
        details: "بازیابی رمز با شماره موبایل",
        severity: "info",
      });
    } catch { /* audit failure should not block */ }

    // Success — no session, no token returned
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);

  } catch {
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } }), cors);
  }
});
