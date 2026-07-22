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

function randomUUID(): string {
  return crypto.randomUUID();
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

const TARGET_MIN_MS = 3000;
const TARGET_MAX_MS = 3200;

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

function okResponse(cors: Record<string, string>, challengeId: string): Response {
  return new Response(
    JSON.stringify({ ok: true, challenge_id: challengeId }),
    { status: 200, headers: { "Content-Type": "application/json", ...cors } },
  );
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Resolve allowed origins
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
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }

  // Content-Type check
  const contentType = req.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }

  // Body size limit (max 4KB)
  const contentLength = parseInt(req.headers.get("Content-Length") || "0", 10);
  if (contentLength > 4096) {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }

  try {
    if (!allowedOrigin) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    const body = await req.json();
    const rawPhone: string | undefined = body.phone;

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Check recovery config readiness
    const { data: cfgRow, error: cfgErr } = await supabase.rpc("get_public_auth_config");
    if (cfgErr) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }
    const cfg = Array.isArray(cfgRow) ? cfgRow[0] : cfgRow;
    const recoveryReady = cfg?.phone_password_recovery_ready === true;
    const testModeActive = cfg?.phone_password_recovery_test_mode === true
      && cfg?.phone_password_recovery_test_ready === true;

    if (!recoveryReady && !testModeActive) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Test mode: only accept the configured test phone
    if (testModeActive && !recoveryReady) {
      const { data: testPhoneRow } = await supabase
        .from("system_config").select("value")
        .eq("section", "security").eq("key", "phone_password_recovery_test_phone")
        .maybeSingle();
      const testPhone = testPhoneRow?.value || "";
      if (normalizeIranPhone(testPhone) !== normalized) {
        return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
      }
    }

    // Resolve secret
    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    if (!secret || secret.length < 32) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // HMAC-hashed phone and IP
    let phoneHash: string;
    let ipHash: string;
    try {
      const clientIP = getClientIP(req);
      phoneHash = await hmacHash(normalized, secret);
      ipHash = await hmacHash(clientIP, secret);
    } catch {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Rate limit: 3 per phone per 15 min, 10 per IP per 15 min
    const rateWindow = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { count: phoneCount } = await supabase
      .from("phone_otp_rate_limit")
      .select("id", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .eq("purpose", "phone_password_recovery")
      .gte("created_at", rateWindow);

    if ((phoneCount || 0) >= 3) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    const { count: ipCount } = await supabase
      .from("phone_otp_rate_limit")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .eq("purpose", "phone_password_recovery")
      .gte("created_at", rateWindow);

    if ((ipCount || 0) >= 10) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Insert rate limit record
    await supabase.from("phone_otp_rate_limit").insert({
      phone_hash: phoneHash,
      ip_hash: ipHash,
      purpose: "phone_password_recovery",
    });

    // Find exactly one active profile with this phone
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active")
      .not("phone", "is", null);

    let matchingProfileCount = 0;
    let matchingUserId: string | null = null;
    for (const p of (profiles || [])) {
      if (p.phone && normalizeIranPhone(p.phone) === normalized && p.is_active === true) {
        matchingProfileCount++;
        matchingUserId = p.user_id;
      }
    }

    if (matchingProfileCount !== 1 || !matchingUserId) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Check auth.users has exactly one user with this phone
    const { data: authUsers, error: authErr } = await supabase.auth.admin.listUsers();
    if (authErr) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    let authMatchCount = 0;
    let authUserId: string | null = null;
    for (const u of (authUsers?.users || [])) {
      if (normalizeIranPhone(u.phone || "") === normalized) {
        authMatchCount++;
        authUserId = u.id;
      }
    }

    if (authMatchCount !== 1 || !authUserId) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    if (authUserId !== matchingUserId) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Resolve TTL
    const { data: ttlRow } = await supabase
      .from("system_config").select("value")
      .eq("section", "security").eq("key", "phone_password_recovery_otp_ttl_seconds")
      .maybeSingle();
    let ttlSeconds = 600;
    const ttlVal = parseInt(ttlRow?.value || "600", 10);
    if (!isNaN(ttlVal) && ttlVal >= 60 && ttlVal <= 86400) ttlSeconds = ttlVal;

    // Generate 6-digit OTP with Web Crypto
    const otpBuf = new Uint32Array(1);
    crypto.getRandomValues(otpBuf);
    const otp = String(otpBuf[0] % 1000000).padStart(6, "0");

    // Hash OTP bound to challenge_id, user_id, normalized_phone, otp
    // We don't have challenge_id yet, so we generate it first
    const challengeId = crypto.randomUUID();

    const otpHash = await hmacHash(
      `${challengeId}:${matchingUserId}:${normalized}:${otp}`,
      secret,
    );

    const phoneHashChallenge = await hmacHash(normalized, secret);

    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

    // Invalidate previous pending challenges for this user
    await supabase
      .from("phone_password_reset_challenges")
      .update({ status: "expired" })
      .eq("user_id", matchingUserId)
      .eq("status", "pending");

    // Insert challenge
    const { error: insertErr } = await supabase
      .from("phone_password_reset_challenges")
      .insert({
        id: challengeId,
        user_id: matchingUserId,
        phone_hash: phoneHashChallenge,
        otp_hash: otpHash,
        status: "pending",
        expires_at: expiresAt,
        max_attempts: 5,
      });

    if (insertErr) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Fetch template
    const { data: template } = await supabase
      .from("notification_templates")
      .select("body")
      .eq("category", "auth")
      .eq("event_type", "password_reset_otp")
      .eq("audience", "all")
      .eq("is_active", true)
      .maybeSingle();

    const messageBody = (template?.body || "کد بازیابی رمز اسپارک: {{otp}}\nاین کد را در اختیار دیگران قرار ندهید.")
      .replace(/\{\{otp\}\}/g, otp);

    // Send SMS via existing send-sms edge function
    const e164 = `+${normalized}`;
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify({
          mode: "send",
          mobiles: [e164],
          message: messageBody,
        }),
      });
    } catch {
      // SMS failure is not revealed to caller
    }

    // Return success with real challenge_id
    return await finishResponse(startedAt, okResponse(cors, challengeId), cors);

  } catch {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }
});
