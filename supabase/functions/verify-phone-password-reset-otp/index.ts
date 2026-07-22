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

const GENERIC_ERROR = JSON.stringify({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });

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
    if (!allowedOrigin) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    let body: { challenge_id?: string; otp?: string };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const challengeId: string | undefined = body.challenge_id;
    const otp: string | undefined = body.otp;

    if (!challengeId || !otp || otp.length < 4) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Resolve secret
    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    if (!secret || secret.length < 32) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Atomic IP rate limit
    const clientIP = getClientIP(req);
    const ipHash = await hmacHash(clientIP, secret);
    const { data: rlData, error: rlErr } = await supabase.rpc(
      "consume_phone_password_recovery_verify_limit",
      {
        p_ip_hash: ipHash,
        p_purpose: "phone_password_recovery_verify",
        p_ip_limit: 10,
        p_window_seconds: 900,
      },
    );
    if (rlErr || !rlData) {
      // Fail-closed
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const rlRow = Array.isArray(rlData) ? rlData[0] : rlData;
    if (!rlRow?.allowed) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Fetch challenge to get user_id and phone_hash for revalidation
    const { data: challenge, error: challengeErr } = await supabase
      .from("phone_password_reset_challenges")
      .select("id, user_id, phone_hash, status, expires_at, locked_until, otp_attempt_count, max_attempts, otp_hash")
      .eq("id", challengeId)
      .maybeSingle();

    if (challengeErr || !challenge) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Revalidate auth/profile before proceeding
    const { data: revData, error: revErr } = await supabase.rpc(
      "revalidate_phone_password_reset_target",
      {
        p_user_id: challenge.user_id,
        p_expected_phone_hash: challenge.phone_hash,
      },
    );
    if (revErr || !revData) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const revRow = Array.isArray(revData) ? revData[0] : revData;
    if (!revRow?.valid) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Compute HMAC of the provided OTP for comparison
    // We need the normalized phone to bind into the hash
    // The phone_hash in the challenge is HMAC(normalized_phone, secret)
    // We can't reverse it, so we pass the provided OTP hash to the RPC
    // The RPC compares against the stored otp_hash
    // Edge function computes: HMAC(challenge_id:user_id:normalized_phone:otp, secret)
    // But we don't have normalized_phone here...
    // Solution: the RPC does the comparison internally using the stored hash
    // We pass the raw OTP and let the RPC compute the hash
    // But the RPC can't do HMAC...
    // Actually, the verify RPC takes p_provided_otp_hash — so the edge function
    // needs to compute it. But we need normalized_phone for the hash binding.
    //
    // We need to get the normalized phone. We can get it from the resolve RPC
    // or from the profile. Let me fetch the profile phone.
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("user_id", challenge.user_id)
      .maybeSingle();

    if (!profile?.phone) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Normalize the profile phone
    const digits = String(profile.phone).replace(/\D/g, '');
    let normalized = '';
    if (/^00989\d{9}$/.test(digits)) normalized = digits.slice(2);
    else if (/^989\d{9}$/.test(digits)) normalized = digits;
    else if (/^09\d{9}$/.test(digits)) normalized = `98${digits.slice(1)}`;
    else if (/^9\d{9}$/.test(digits)) normalized = `98${digits}`;
    else return await finishResponse(startedAt, genericErrorResponse(cors), cors);

    // Verify phone hash matches challenge
    const computedPhoneHash = await hmacHash(normalized, secret);
    if (computedPhoneHash !== challenge.phone_hash) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Compute provided OTP hash
    const providedOtpHash = await hmacHash(
      `${challengeId}:${challenge.user_id}:${normalized}:${otp}`,
      secret,
    );

    // Generate reset token (32 bytes)
    const resetTokenBytes = new Uint8Array(32);
    crypto.getRandomValues(resetTokenBytes);
    const resetToken = Array.from(resetTokenBytes).map(b => b.toString(16).padStart(2, "0")).join("");
    const resetTokenHash = await hmacHash(resetToken, secret);
    const resetExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    // Atomic verify via RPC
    const { data: verifyData, error: verifyErr } = await supabase.rpc(
      "verify_phone_password_reset_challenge",
      {
        p_challenge_id: challengeId,
        p_provided_otp_hash: providedOtpHash,
        p_reset_token_hash: resetTokenHash,
        p_reset_expires_at: resetExpiresAt,
      },
    );
    if (verifyErr || !verifyData) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const verifyRow = Array.isArray(verifyData) ? verifyData[0] : verifyData;
    if (!verifyRow?.success) {
      // RPC failed — do NOT return reset token
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Success — return reset token to browser (only time it's ever sent)
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: true, reset_token: resetToken }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);

  } catch {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }
});
