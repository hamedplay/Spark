import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendBaleAuthCode } from "../_shared/send-bale-auth-code.ts";

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

  const contentType = req.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }

  // Read body as text, enforce real size limit
  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }
  if (bodyText.length > 4096) {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }

  try {
    if (!allowedOrigin) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    let body: { phone?: string };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

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

    // Fail-closed: TTL must be valid
    if (!cfg?.recovery_ttl_valid) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Fail-closed: template must be active
    if (!cfg?.recovery_template_ready) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Fail-closed: secret must be confirmed
    if (!cfg?.recovery_secret_confirmed) {
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

    // Atomic rate limit (advisory-locked transaction)
    const { data: rlData, error: rlErr } = await supabase.rpc(
      "consume_phone_password_recovery_request_limit",
      {
        p_phone_hash: phoneHash,
        p_ip_hash: ipHash,
        p_purpose: "phone_password_recovery",
        p_phone_limit: 3,
        p_ip_limit: 10,
        p_window_seconds: 900,
      },
    );
    if (rlErr || !rlData) {
      // Fail-closed on DB error
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }
    const rlRow = Array.isArray(rlData) ? rlData[0] : rlData;
    if (!rlRow?.allowed) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Resolve target user via RPC (no listUsers, no profile iteration)
    const { data: targetData, error: targetErr } = await supabase.rpc(
      "resolve_phone_password_reset_target",
      { p_normalized_phone: normalized },
    );
    if (targetErr || !targetData) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }
    const targetRow = Array.isArray(targetData) ? targetData[0] : targetData;
    const targetUserId: string | undefined = targetRow?.user_id;
    if (!targetUserId) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Resolve TTL from config (already validated by RPC, but read for use)
    const { data: ttlRow } = await supabase
      .from("system_config").select("value")
      .eq("section", "security").eq("key", "phone_password_recovery_otp_ttl_seconds")
      .maybeSingle();
    const ttlVal = parseInt(ttlRow?.value || "0", 10);
    // Fail-closed: don't guess 600
    if (isNaN(ttlVal) || ttlVal < 60 || ttlVal > 86400) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Generate 6-digit OTP with Web Crypto
    const otpBuf = new Uint32Array(1);
    crypto.getRandomValues(otpBuf);
    const otp = String(otpBuf[0] % 1000000).padStart(6, "0");

    // Pre-generate challenge_id for OTP hash binding
    const challengeId = crypto.randomUUID();
    const otpHash = await hmacHash(
      `${challengeId}:${targetUserId}:${normalized}:${otp}`,
      secret,
    );
    const phoneHashChallenge = await hmacHash(normalized, secret);
    const expiresAt = new Date(Date.now() + ttlVal * 1000).toISOString();

    // Atomic challenge creation (advisory-locked, expires old, inserts new)
    const { data: createData, error: createErr } = await supabase.rpc(
      "create_phone_password_reset_challenge",
      {
        p_user_id: targetUserId,
        p_phone_hash: phoneHashChallenge,
        p_otp_hash: otpHash,
        p_expires_at: expiresAt,
      },
    );
    if (createErr || !createData) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }
    const createRow = Array.isArray(createData) ? createData[0] : createData;
    if (!createRow?.success || !createRow?.challenge_id) {
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }
    const realChallengeId = createRow.challenge_id;

    // Fetch active template
    const { data: template } = await supabase
      .from("notification_templates")
      .select("body")
      .eq("category", "auth")
      .eq("event_type", "password_reset_otp")
      .eq("audience", "all")
      .eq("is_active", true)
      .maybeSingle();

    // Fail-closed: no template = no SMS
    if (!template?.body) {
      // Mark challenge as delivery_failed
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "delivery_failed", updated_at: new Date().toISOString() })
        .eq("id", realChallengeId);
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    const messageBody = template.body.replace(/\{\{otp\}\}/g, otp);

    // Read provider ID from config
    const { data: providerRow } = await supabase
      .from("system_config").select("value")
      .eq("section", "sms").eq("key", "phone_login_sms_provider_id")
      .maybeSingle();
    const providerId = providerRow?.value;
    if (!providerId) {
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "delivery_failed", updated_at: new Date().toISOString() })
        .eq("id", realChallengeId);
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // Send SMS via send-sms edge function with auth_otp mode and providerId
    const e164 = `+${normalized}`;
    let smsSuccess = false;
    try {
      const smsController = new AbortController();
      const timeout = setTimeout(() => smsController.abort(), 10000);
      const smsResp = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify({
          mode: "auth_otp",
          providerId: providerId,
          mobiles: [e164],
          message: messageBody,
        }),
        signal: smsController.signal,
      });
      clearTimeout(timeout);
      if (smsResp.ok) {
        const smsResult = await smsResp.json().catch(() => ({}));
        smsSuccess = smsResult?.ok === true || smsResult?.success === true;
      }
    } catch {
      // SMS failure
    }

    if (!smsSuccess) {
      // Mark challenge as delivery_failed, return decoy
      await supabase
        .from("phone_password_reset_challenges")
        .update({ status: "delivery_failed", updated_at: new Date().toISOString() })
        .eq("id", realChallengeId);
      return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
    }

    // ── Best-effort Bale OTP delivery (non-blocking) ─────────────────────
    try {
      const { data: baleCfgRow } = await supabase
        .from("system_config")
        .select("value")
        .eq("section", "security")
        .eq("key", "phone_password_recovery_bale_otp_enabled")
        .maybeSingle();
      if (baleCfgRow?.value === "true") {
        EdgeRuntime.waitUntil(
          sendBaleAuthCode({
            supabase,
            userId: targetUserId,
            otp,
            purpose: "phone_password_recovery",
            eventRef: realChallengeId,
          }),
        );
      }
    } catch {
      // best-effort — never affect recovery response
    }

    // Return success with real challenge_id
    return await finishResponse(startedAt, okResponse(cors, realChallengeId), cors);

  } catch {
    return await finishResponse(startedAt, okResponse(cors, randomUUID()), cors);
  }
});
