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
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join("");
}

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const TARGET_MIN_MS = 3000;
const TARGET_MAX_MS = 3200;

async function finishResponse(startedAt: number, response: Response, cors: Record<string, string>): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) await new Promise(r => setTimeout(r, target - elapsed));
  return new Response(response.body, { status: response.status, headers: { ...response.headers, ...cors } });
}

function publicResponse(cors: Record<string, string>): Response {
  return new Response(JSON.stringify({ ok: true }),
    { status: 200, headers: { "Content-Type": "application/json", ...cors } });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Read pepper and allowed origins directly from system_config table
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
  if (req.method !== "POST") return await finishResponse(startedAt, publicResponse(cors), cors);

  try {
    if (!allowedOrigin) {
      console.log(`[phone-login ${requestId}] ORIGIN_NOT_ALLOWED`);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    if (!pepper || pepper.length < 32) {
      console.log(`[phone-login ${requestId}] PEPPER_MISSING`);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    const body = await req.json();
    const rawPhone: string | undefined = body.phone;
    const isAdminContext: boolean = body._admin_context === true;

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) return await finishResponse(startedAt, publicResponse(cors), cors);

    // Check auth config
    const { data: authCfgRow } = await supabase.rpc("get_public_auth_config");
    const cfg = Array.isArray(authCfgRow) ? authCfgRow[0] : authCfgRow;
    const publicReady = cfg?.phone_login_ready === true;
    const testReady = cfg?.phone_login_test_ready === true;

    let allowDispatch = false;

    if (publicReady) {
      allowDispatch = true;
    } else if (testReady) {
      const { data: testModeRow } = await supabase
        .from("system_config").select("value")
        .eq("section", "security").eq("key", "phone_login_test_mode")
        .maybeSingle();
      const testModeEnabled = testModeRow?.value === "true";

      if (testModeEnabled) {
        const { data: testPhoneRow } = await supabase
          .from("system_config").select("value")
          .eq("section", "security").eq("key", "phone_login_test_phone")
          .maybeSingle();
        const testPhone = testPhoneRow?.value || "";
        const normalizedTestPhone = normalizeIranPhone(testPhone);

        if (normalizedTestPhone && normalized === normalizedTestPhone) {
          allowDispatch = true;
        }
      }
    }

    if (!allowDispatch) {
      console.log(`[phone-login ${requestId}] NOT_READY`);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    // Resolve profile by phone suffix
    const phoneSuffix = normalized.slice(-10);
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active")
      .eq("is_active", true)
      .ilike("phone", `%${phoneSuffix}%`)
      .limit(1);

    const resolvedProfile = profiles?.[0] || null;

    if (!resolvedProfile) {
      if (isAdminContext) {
        return new Response(JSON.stringify({ ok: false, error: "NO_PROFILE_FOR_PHONE" }),
          { status: 404, headers: { "Content-Type": "application/json", ...cors } });
      }
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(resolvedProfile.user_id);
    if (authErr || !authUser?.user) {
      if (isAdminContext) {
        return new Response(JSON.stringify({ ok: false, error: "AUTH_USER_NOT_FOUND" }),
          { status: 404, headers: { "Content-Type": "application/json", ...cors } });
      }
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    const authPhoneNorm = normalizeIranPhone(authUser.user.phone);
    if (authPhoneNorm !== normalized) {
      if (isAdminContext) {
        return new Response(JSON.stringify({ ok: false, error: "AUTH_PHONE_MISMATCH" }),
          { status: 409, headers: { "Content-Type": "application/json", ...cors } });
      }
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    // Rate limit
    const phoneHash = await hmacHash(normalized, pepper);
    const xff = req.headers.get("x-forwarded-for") || "";
    const clientIP = xff.split(",")[0]?.trim() || "unknown";
    const ipHash = await hmacHash(clientIP, pepper);

    let rateLimitResult: { allowed: boolean; retry_after_seconds: number };
    try {
      const { data: rlRaw, error: rlErr } = await supabase.rpc(
        "consume_phone_otp_rate_limit",
        { p_phone_hash: phoneHash, p_ip_hash: ipHash },
      );
      if (rlErr) return await finishResponse(startedAt, publicResponse(cors), cors);
      rateLimitResult = typeof rlRaw === "string" ? JSON.parse(rlRaw) : rlRaw;
    } catch {
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    if (!rateLimitResult.allowed) {
      console.log(`[phone-login ${requestId}] RATE_LIMITED`);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    // Generate 6-digit OTP
    const otpBuf = new Uint32Array(1);
    crypto.getRandomValues(otpBuf);
    const otp = String(otpBuf[0] % 1000000).padStart(6, "0");

    const challengeId = crypto.randomUUID();
    const otpHash = await hmacHash(`${challengeId}:${resolvedProfile.user_id}:${normalized}:${otp}`, pepper);
    const expiresAt = new Date(Date.now() + 300 * 1000).toISOString();

    const { error: insertErr } = await supabase
      .from("phone_login_otp_challenges")
      .insert({
        id: challengeId,
        user_id: resolvedProfile.user_id,
        phone_hash: phoneHash,
        otp_hash: otpHash,
        expires_at: expiresAt,
      });

    if (insertErr) {
      console.log(`[phone-login ${requestId}] CHALLENGE_INSERT_FAILED:`, insertErr.message);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    console.log(`[phone-login ${requestId}] CHALLENGE_CREATED user=${resolvedProfile.user_id.slice(0, 8)}`);

    // Fetch SMS template
    const { data: template } = await supabase
      .from("sms_templates")
      .select("body, is_active")
      .eq("category", "auth")
      .eq("event_type", "login_otp")
      .eq("audience", "all")
      .maybeSingle();

    let message: string;
    if (template?.is_active && template?.body && /\{\{\s*otp\s*\}\}/.test(template.body)) {
      message = template.body.replace(/\{\{\s*otp\s*\}\}/g, otp);
    } else {
      message = `کد ورود شما به سامانه اسپارک: ${otp}\nاین کد را در اختیار دیگران قرار ندهید.`;
    }

    // Read provider ID
    const { data: providerRow } = await supabase
      .from("system_config").select("value")
      .eq("section", "sms").eq("key", "phone_login_sms_provider_id")
      .maybeSingle();
    const providerId = providerRow?.value;
    if (!providerId) {
      console.log(`[phone-login ${requestId}] NO_PROVIDER`);
      await supabase.from("phone_login_otp_challenges")
        .update({ status: "delivery_failed", updated_at: new Date().toISOString() })
        .eq("id", challengeId);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    // Send SMS
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
          providerId,
          mobiles: [e164],
          message,
        }),
        signal: smsController.signal,
      });
      clearTimeout(timeout);
      if (smsResp.ok) {
        const smsResult = await smsResp.json().catch(() => ({}));
        smsSuccess = smsResult?.ok === true || smsResult?.success === true;
      }
    } catch { /* SMS failure */ }

    if (!smsSuccess) {
      console.log(`[phone-login ${requestId}] SMS_FAILED`);
      await supabase.from("phone_login_otp_challenges")
        .update({ status: "delivery_failed", updated_at: new Date().toISOString() })
        .eq("id", challengeId);
      return await finishResponse(startedAt, publicResponse(cors), cors);
    }

    console.log(`[phone-login ${requestId}] SMS_SENT`);

    // Best-effort Bale delivery
    EdgeRuntime.waitUntil(
      sendBaleAuthCode({
        supabase,
        userId: resolvedProfile.user_id,
        otp,
        purpose: "phone_login",
        eventRef: challengeId,
      }),
    );

    return await finishResponse(startedAt, publicResponse(cors), cors);

  } catch (err) {
    console.log(`[phone-login ${requestId}] ERROR:`, err?.message || "unknown");
    return await finishResponse(startedAt, publicResponse(cors), cors);
  }
});
