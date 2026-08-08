import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

interface JwtPayload { sub?: string; session_id?: string; amr?: Array<{ method?: string }>; }
interface AuthUser { id: string; email?: string | null; email_confirmed_at?: string | null; phone?: string | null; phone_confirmed_at?: string | null; }

function adminClient() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function jwtPayload(token: string): JwtPayload | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as JwtPayload;
  } catch { return null; }
}

function randomOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

async function hmac(value: string, context: string): Promise<string> {
  const pepper = Deno.env.get("MFA_PEPPER");
  if (!pepper) throw new Error("MFA_NOT_READY");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`${context}:${pepper}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionIdFrom(token: string): string | null {
  return jwtPayload(token)?.session_id ?? null;
}

function phoneDigits(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return "";
}

function isPhoneOtpPrimary(token: string): boolean {
  return (jwtPayload(token)?.amr ?? []).some((entry) => entry.method === "phone_otp");
}

async function authenticate(req: Request): Promise<{ token: string; user: AuthUser; sessionId: string } | null> {
  const header = req.headers.get("Authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const sessionId = sessionIdFrom(token);
  if (!sessionId) return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return { token, user: data.user as AuthUser, sessionId };
}

async function sendSms(userId: string, otp: string): Promise<boolean> {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}` },
    body: JSON.stringify({ mode: "dispatch", targetUserId: userId, category: "auth", eventType: "custom_mfa_sms", audience: "all", message: `کد احراز هویت شما: ${otp}` }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { ok?: boolean; status?: string };
  return result.ok === true && result.status !== "failed";
}

async function sendBale(userId: string, otp: string): Promise<boolean> {
  const admin = adminClient();
  const { data: config } = await admin.from("social_channel_configs").select("bot_token, is_active").eq("channel", "bale").maybeSingle();
  const { data: mapping } = await admin.from("user_bale_mapping").select("bale_chat_id_enc, bale_mfa_codes_enabled").eq("user_id", userId).maybeSingle();
  if (!config?.is_active || !config.bot_token || !mapping?.bale_mfa_codes_enabled || !mapping.bale_chat_id_enc) return false;
  const { data: chatId, error } = await admin.rpc("mfa_decrypt", { p_ciphertext: mapping.bale_chat_id_enc });
  if (error || typeof chatId !== "string" || !chatId) return false;
  const response = await fetch(`https://tapi.bale.ai/bot${config.bot_token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: `کد احراز هویت شما: ${otp}` }),
  });
  return response.ok;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const body = await req.json() as { mode?: string; factor_type?: string; challenge_id?: string; code?: string };
    const mode = body.mode ?? "create";
    const admin = adminClient();
    const { data: settings } = await admin.from("auth_security_settings").select("custom_mfa_enabled, custom_mfa_allowed_factors").eq("id", 1).maybeSingle();
    if (!settings?.custom_mfa_enabled) return json({ ok: false, error: "MFA_DISABLED" }, 409);

    if (mode === "create") {
      const factorType = body.factor_type;
      if (factorType !== "sms" && factorType !== "bale" && factorType !== "email") return json({ ok: false, error: "FACTOR_UNAVAILABLE" }, 409);
      if (!Array.isArray(settings.custom_mfa_allowed_factors) || !settings.custom_mfa_allowed_factors.includes(factorType)) return json({ ok: false, error: "FACTOR_NOT_ALLOWED" }, 403);
      if (factorType === "sms" && isPhoneOtpPrimary(caller.token)) return json({ ok: false, error: "FACTOR_INDEPENDENCE_REQUIRED" }, 409);
      if (factorType === "email" && !caller.user.email_confirmed_at) return json({ ok: false, error: "EMAIL_NOT_VERIFIED" }, 409);
      if (factorType === "email") return json({ ok: false, error: "EMAIL_TRANSPORT_UNAVAILABLE" }, 503);

      const otp = randomOtp();
      const otpHash = await hmac(otp, "mfa_otp");
      const { data: challenge, error } = await admin.rpc("create_custom_mfa_challenge_service", {
        p_user_id: caller.user.id, p_factor_type: factorType, p_session_id: caller.sessionId, p_otp_hash: otpHash,
      });
      if (error || !challenge?.ok) return json({ ok: false, error: "CHALLENGE_CREATE_FAILED" }, 503);
      const delivered = factorType === "sms" ? await sendSms(caller.user.id, otp) : await sendBale(caller.user.id, otp);
      if (!delivered) return json({ ok: false, error: "TRANSPORT_UNAVAILABLE" }, 503);
      return json({ ok: true, challenge_id: challenge.challenge_id, expires_at: challenge.expires_at, factor_type: factorType });
    }

    if (mode === "verify") {
      if (!body.challenge_id || !body.code || !/^\d{6}$/.test(body.code)) return json({ ok: false, error: "INVALID_CODE" }, 400);
      const codeHash = await hmac(body.code, "mfa_otp");
      const { data, error } = await admin.rpc("consume_custom_mfa_challenge_service", {
        p_user_id: caller.user.id, p_challenge_id: body.challenge_id, p_otp_hash: codeHash, p_session_id: caller.sessionId,
      });
      if (error || !data?.ok) return json({ ok: false, error: data?.error ?? "MFA_VERIFY_FAILED" }, 400);
      return json({ ok: true, grant_expires_at: data.expires_at });
    }

    if (mode === "recovery") {
      if (!body.code || body.code.length < 16 || body.code.length > 64) return json({ ok: false, error: "INVALID_RECOVERY_CODE" }, 400);
      const codeHash = await hmac(body.code, "mfa_recovery");
      const { data, error } = await admin.rpc("consume_custom_mfa_recovery_service", {
        p_user_id: caller.user.id, p_code_hash: codeHash, p_session_id: caller.sessionId,
      });
      if (error || !data?.ok) return json({ ok: false, error: data?.error ?? "RECOVERY_CODE_INVALID" }, 400);
      return json({ ok: true, grant_expires_at: data.expires_at });
    }

    return json({ ok: false, error: "INVALID_MODE" }, 400);
  } catch (error) {
    const code = error instanceof Error && error.message === "MFA_NOT_READY" ? "MFA_NOT_READY" : "MFA_OPERATION_FAILED";
    return json({ ok: false, error: code }, code === "MFA_NOT_READY" ? 503 : 500);
  }
});
