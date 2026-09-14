import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { sendBaleAuthCode } from "../_shared/send-bale-auth-code.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", "Pragma": "no-cache" },
});

interface JwtPayload { sub?: string; session_id?: string; amr?: Array<{ method?: string }>; }
interface AuthUser { id: string; phone?: string | null; phone_confirmed_at?: string | null; }
interface ReadinessState {
  ok?: boolean;
  error?: string;
  mfa_enabled?: boolean;
  allowed_factors?: string[];
  supported_factors?: string[];
  sms_ready?: boolean;
  readiness?: string;
}

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
  } catch {
    return null;
  }
}

function randomOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

async function hmac(value: string, context: string): Promise<string> {
  const pepper = Deno.env.get("MFA_PEPPER");
  if (!pepper) throw new Error("MFA_NOT_READY");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`${context}:${pepper}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function domainBoundOtpHash(
  challengeId: string,
  userId: string,
  sessionId: string,
  targetHash: string,
  otpCode: string,
): Promise<string> {
  return hmac([challengeId, userId, sessionId, "sms", targetHash, otpCode].join("|"), "mfa_otp");
}

function sessionIdFrom(token: string): string | null {
  return jwtPayload(token)?.session_id ?? null;
}

function isPhoneOtpPrimary(token: string): boolean {
  return (jwtPayload(token)?.amr ?? []).some((entry) => entry.method === "phone");
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
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

async function sendSmsOtp(phone: string, otp: string): Promise<boolean> {
  const response = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
    },
    body: JSON.stringify({ mode: "auth_otp", mobiles: [phone], message: `کد احراز هویت شما: ${otp}` }),
  });
  if (!response.ok) return false;
  const result = await response.json() as { ok?: boolean };
  return result.ok === true;
}

async function mirrorToBale(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  otp: string,
  purpose: "mfa_login" | "mfa_enrollment",
  eventRef: string,
) {
  // Bale is only an auxiliary delivery channel for the same SMS OTP. It is not
  // an independent MFA factor in the canonical authentication model.
  await sendBaleAuthCode({ supabase: admin, userId, otp, purpose, eventRef });
}

function smsAllowed(readiness: ReadinessState): boolean {
  return Array.isArray(readiness.allowed_factors) && readiness.allowed_factors.length === 1 && readiness.allowed_factors[0] === "sms";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ ok: false, error: "UNAUTHORIZED" }, 401);

  try {
    const body = await req.json() as {
      mode?: string;
      factor_type?: string;
      challenge_id?: string;
      code?: string;
    };
    const mode = body.mode ?? "create";
    const admin = adminClient();

    const { data: readinessData, error: readinessError } = await admin.rpc("get_custom_mfa_readiness");
    if (readinessError || !readinessData?.ok) {
      return json({ ok: false, error: readinessData?.error ?? "MFA_READINESS_UNAVAILABLE" }, 503);
    }
    const readiness = readinessData as ReadinessState;
    const edgePepperReady = Boolean(Deno.env.get("MFA_PEPPER"));

    if (mode === "readiness") {
      const effectiveReadiness = !readiness.mfa_enabled
        ? "disabled"
        : readiness.readiness !== "ready" || !edgePepperReady
          ? "not_ready"
          : "ready";
      return json({
        ...readiness,
        supported_factors: ["sms"],
        edge_pepper_ready: edgePepperReady,
        readiness: effectiveReadiness,
      });
    }

    // Old Bale/email/recovery modes are deliberately closed. They were legacy
    // scaffolding and are not part of the canonical login MFA runtime.
    if (mode === "enroll_bale" || mode === "regenerate_recovery" || mode === "recovery") {
      return json({ ok: false, error: "FACTOR_UNSUPPORTED", supported_factors: ["sms"] }, 409);
    }

    // Direct factor disabling can leave profiles.mfa_method='sms' while the
    // factor is disabled. Method removal/switching must use the canonical MFA
    // switch flow instead of this legacy endpoint.
    if (mode === "disable") {
      return json({ ok: false, error: "MFA_METHOD_SWITCH_REQUIRED" }, 409);
    }

    if (!readiness.mfa_enabled) return json({ ok: false, error: "MFA_DISABLED" }, 409);
    if (readiness.readiness !== "ready" || !edgePepperReady) {
      return json({ ok: false, error: "MFA_NOT_READY" }, 503);
    }
    if (!smsAllowed(readiness)) {
      return json({ ok: false, error: "SMS_FACTOR_NOT_ALLOWED" }, 409);
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE: enroll_sms — enroll SMS from confirmed auth.users.phone only
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === "enroll_sms") {
      if (isPhoneOtpPrimary(caller.token)) return json({ ok: false, error: "FACTOR_INDEPENDENCE_REQUIRED" }, 409);
      if (!caller.user.phone || !caller.user.phone_confirmed_at) return json({ ok: false, error: "PHONE_NOT_CONFIRMED" }, 400);

      const phoneHash = await hmac(caller.user.phone, "mfa_factor_phone");
      const { data, error } = await admin.rpc("enroll_sms_factor_from_auth_phone", {
        p_user_id: caller.user.id,
        p_phone_hash: phoneHash,
      });
      if (error || !data?.ok) return json({ ok: false, error: data?.error ?? "ENROLLMENT_FAILED" }, 500);

      const otp = randomOtp();
      const temporaryOtpHash = await domainBoundOtpHash("pending", caller.user.id, caller.sessionId, phoneHash, otp);
      const { data: challenge, error: challengeError } = await admin.rpc("create_sms_mfa_challenge_v3", {
        p_user_id: caller.user.id,
        p_session_id: caller.sessionId,
        p_otp_hash: temporaryOtpHash,
        p_target_hash: phoneHash,
        p_purpose: "enrollment",
      });
      if (challengeError || !challenge?.ok) return json({ ok: false, error: "CHALLENGE_CREATE_FAILED" }, 503);

      const actualOtpHash = await domainBoundOtpHash(challenge.challenge_id, caller.user.id, caller.sessionId, phoneHash, otp);
      const { error: hashError } = await admin.from("custom_mfa_challenges")
        .update({ otp_hash: actualOtpHash })
        .eq("id", challenge.challenge_id)
        .eq("user_id", caller.user.id)
        .eq("session_id", caller.sessionId);

      if (hashError || !await sendSmsOtp(caller.user.phone, otp)) {
        await admin.from("custom_mfa_challenges").update({ status: "expired" }).eq("id", challenge.challenge_id);
        return json({ ok: false, error: "TRANSPORT_UNAVAILABLE" }, 503);
      }

      EdgeRuntime.waitUntil(mirrorToBale(admin, caller.user.id, otp, "mfa_enrollment", challenge.challenge_id));
      return json({ ok: true, factor_id: data.factor_id, challenge_id: challenge.challenge_id, expires_at: challenge.expires_at });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE: create — issue an SMS login challenge
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === "create") {
      if (body.factor_type !== "sms") return json({ ok: false, error: "FACTOR_UNSUPPORTED", supported_factors: ["sms"] }, 409);
      if (isPhoneOtpPrimary(caller.token)) return json({ ok: false, error: "FACTOR_INDEPENDENCE_REQUIRED" }, 409);
      if (!caller.user.phone || !caller.user.phone_confirmed_at) return json({ ok: false, error: "PHONE_NOT_CONFIRMED" }, 400);

      const ipHash = await hmac(clientIp(req), "mfa_ip");
      const { data: rlResult } = await admin.rpc("consume_mfa_challenge_rate_limit", {
        p_user_id: caller.user.id,
        p_session_id: caller.sessionId,
        p_ip_hash: ipHash,
      });
      if (!rlResult?.allowed) {
        return json({ ok: false, error: "RATE_LIMITED", retry_after_seconds: rlResult?.retry_after_seconds ?? 900 }, 429);
      }

      const targetHash = await hmac(caller.user.phone, "mfa_factor_phone");
      const otp = randomOtp();
      const temporaryOtpHash = await domainBoundOtpHash("pending", caller.user.id, caller.sessionId, targetHash, otp);
      const { data: challenge, error } = await admin.rpc("create_sms_mfa_challenge_v3", {
        p_user_id: caller.user.id,
        p_session_id: caller.sessionId,
        p_otp_hash: temporaryOtpHash,
        p_target_hash: targetHash,
        p_purpose: "login",
      });
      if (error || !challenge?.ok) return json({ ok: false, error: "CHALLENGE_CREATE_FAILED" }, 503);

      const challengeId = challenge.challenge_id as string;
      const actualOtpHash = await domainBoundOtpHash(challengeId, caller.user.id, caller.sessionId, targetHash, otp);
      const { error: hashError } = await admin.from("custom_mfa_challenges")
        .update({ otp_hash: actualOtpHash, ip_hash: ipHash })
        .eq("id", challengeId)
        .eq("user_id", caller.user.id)
        .eq("session_id", caller.sessionId);
      if (hashError || !await sendSmsOtp(caller.user.phone, otp)) {
        await admin.from("custom_mfa_challenges").update({ status: "expired" }).eq("id", challengeId);
        return json({ ok: false, error: "TRANSPORT_UNAVAILABLE" }, 503);
      }

      EdgeRuntime.waitUntil(mirrorToBale(admin, caller.user.id, otp, "mfa_login", challengeId));
      return json({ ok: true, challenge_id: challengeId, expires_at: challenge.expires_at, factor_type: "sms" });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE: resend — SMS only
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === "resend") {
      if (!body.challenge_id) return json({ ok: false, error: "CHALLENGE_ID_REQUIRED" }, 400);

      const ipHash = await hmac(clientIp(req), "mfa_ip");
      const { data: rlResult } = await admin.rpc("consume_mfa_challenge_rate_limit", {
        p_user_id: caller.user.id,
        p_session_id: caller.sessionId,
        p_ip_hash: ipHash,
      });
      if (!rlResult?.allowed) {
        return json({ ok: false, error: "RATE_LIMITED", retry_after_seconds: rlResult?.retry_after_seconds ?? 900 }, 429);
      }

      const { data: challengeRow } = await admin.from("custom_mfa_challenges")
        .select("factor_type, target_hash, session_id")
        .eq("id", body.challenge_id)
        .eq("user_id", caller.user.id)
        .maybeSingle();
      if (!challengeRow) return json({ ok: false, error: "CHALLENGE_NOT_FOUND" }, 404);
      if (challengeRow.session_id !== caller.sessionId) return json({ ok: false, error: "SESSION_MISMATCH" }, 403);
      if (challengeRow.factor_type !== "sms") return json({ ok: false, error: "FACTOR_UNSUPPORTED" }, 409);
      if (isPhoneOtpPrimary(caller.token)) return json({ ok: false, error: "FACTOR_INDEPENDENCE_REQUIRED" }, 409);
      if (!caller.user.phone || !caller.user.phone_confirmed_at) return json({ ok: false, error: "PHONE_NOT_CONFIRMED" }, 400);

      const otp = randomOtp();
      const otpHash = await domainBoundOtpHash(body.challenge_id, caller.user.id, caller.sessionId, challengeRow.target_hash ?? "", otp);
      const resendAvailableAt = new Date(Date.now() + 60 * 1000).toISOString();
      const { data: resendResult, error: resendError } = await admin.rpc("update_mfa_challenge_resend", {
        p_challenge_id: body.challenge_id,
        p_otp_hash: otpHash,
        p_resend_available_at: resendAvailableAt,
      });
      if (resendError || !resendResult?.ok) {
        return json({ ok: false, error: resendResult?.error ?? "RESEND_FAILED" }, 400);
      }

      if (!await sendSmsOtp(caller.user.phone, otp)) {
        await admin.from("custom_mfa_challenges").update({ status: "expired" }).eq("id", body.challenge_id);
        return json({ ok: false, error: "TRANSPORT_UNAVAILABLE" }, 503);
      }

      EdgeRuntime.waitUntil(mirrorToBale(admin, caller.user.id, otp, "mfa_login", body.challenge_id));
      return json({ ok: true });
    }

    // ══════════════════════════════════════════════════════════════════════════
    // MODE: verify — domain-bound SMS OTP verification
    // ══════════════════════════════════════════════════════════════════════════
    if (mode === "verify") {
      if (!body.challenge_id || !body.code || !/^\d{6}$/.test(body.code)) {
        return json({ ok: false, error: "INVALID_CODE" }, 400);
      }

      const { data: challengeRow } = await admin.from("custom_mfa_challenges")
        .select("target_hash, factor_type, session_id")
        .eq("id", body.challenge_id)
        .eq("user_id", caller.user.id)
        .maybeSingle();
      if (!challengeRow) return json({ ok: false, error: "CHALLENGE_NOT_FOUND" }, 404);
      if (challengeRow.session_id !== caller.sessionId) return json({ ok: false, error: "SESSION_MISMATCH" }, 403);
      if (challengeRow.factor_type !== "sms") return json({ ok: false, error: "FACTOR_UNSUPPORTED" }, 409);

      const otpHash = await domainBoundOtpHash(
        body.challenge_id,
        caller.user.id,
        caller.sessionId,
        challengeRow.target_hash ?? "",
        body.code,
      );
      const { data, error } = await admin.rpc("consume_sms_mfa_challenge_v3", {
        p_user_id: caller.user.id,
        p_challenge_id: body.challenge_id,
        p_otp_hash: otpHash,
        p_session_id: caller.sessionId,
      });
      if (error || !data?.ok) return json({ ok: false, error: data?.error ?? "MFA_VERIFY_FAILED" }, 400);
      return json({ ok: true, grant_expires_at: data.expires_at });
    }

    return json({ ok: false, error: "INVALID_MODE" }, 400);
  } catch (error) {
    const code = error instanceof Error && error.message === "MFA_NOT_READY" ? "MFA_NOT_READY" : "MFA_OPERATION_FAILED";
    return json({ ok: false, error: code }, code === "MFA_NOT_READY" ? 503 : 500);
  }
});
