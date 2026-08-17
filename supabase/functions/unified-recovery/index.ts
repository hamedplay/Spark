import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...corsHeaders,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
  },
});

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function randomOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "0.0.0.0";
}

function normalizeIranPhoneLocal(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return `0${digits.slice(4)}`;
  if (/^989\d{9}$/.test(digits)) return `0${digits.slice(2)}`;
  if (/^09\d{9}$/.test(digits)) return digits;
  if (/^9\d{9}$/.test(digits)) return `0${digits}`;
  return "";
}

function toCanonicalIranPhone(localPhone: string): string {
  return /^09\d{9}$/.test(localPhone) ? `98${localPhone.slice(1)}` : "";
}

async function recoveryHmac(value: string, context: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (secret.length < 32) throw new Error("RECOVERY_HMAC_UNAVAILABLE");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${context}:${value}`),
  );
  return Array.from(new Uint8Array(sig)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function padTiming(minMs: number, maxMs: number) {
  await new Promise(resolve => setTimeout(resolve, minMs + Math.random() * (maxMs - minMs)));
}

async function resolveTarget(
  admin: ReturnType<typeof adminClient>,
  type: string,
  rawValue: string,
) {
  let value = rawValue.trim();
  let query = admin
    .from("profiles")
    .select("user_id,phone,normalized_phone,is_active,account_status,phone_verified_at")
    .eq("is_active", true)
    .eq("account_status", "ACTIVE")
    .not("phone_verified_at", "is", null);

  if (type === "phone") {
    value = normalizeIranPhoneLocal(value);
    const canonical = toCanonicalIranPhone(value);
    if (!value || !canonical) return null;
    // normalized_phone is the canonical +98 identity and is independent of
    // whether the display/profile phone happens to be stored as 09... or +98....
    query = query.eq("normalized_phone", `+${canonical}`);
  } else if (type === "email") {
    if (!value.includes("@")) return null;
    query = query.ilike("email", value);
  } else if (type === "username") {
    if (!value) return null;
    query = query.ilike("username", value);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error || !data?.user_id || !data.phone_verified_at) return null;

  const phone = normalizeIranPhoneLocal(data.phone || data.normalized_phone);
  if (!phone) return null;

  return {
    userId: data.user_id as string,
    phone,
    normalizedIdentifier: value,
  };
}

interface DeliveryResult {
  ok: boolean;
  providerId?: string;
  packId?: string | null;
  messageIds?: Array<string | number>;
}

async function deliverRecoveryOtp(
  admin: ReturnType<typeof adminClient>,
  localPhone: string,
  otp: string,
): Promise<DeliveryResult> {
  if (!/^09\d{9}$/.test(localPhone)) return { ok: false };

  const { data: providerConfig } = await admin
    .from("system_config")
    .select("value")
    .eq("section", "sms")
    .eq("key", "phone_login_sms_provider_id")
    .maybeSingle();
  const providerId = String(providerConfig?.value || "");
  if (!providerId) return { ok: false };

  const { data: provider, error: providerError } = await admin
    .from("sms_providers")
    .select("id,title,provider_type,api_url,api_key,line_number,is_active")
    .eq("id", providerId)
    .eq("is_active", true)
    .maybeSingle();
  if (providerError || !provider) return { ok: false, providerId };

  const { data: template } = await admin
    .from("notification_templates")
    .select("body")
    .eq("category", "auth")
    .eq("event_type", "password_reset_otp")
    .eq("audience", "all")
    .eq("is_active", true)
    .maybeSingle();
  if (!template?.body || !template.body.includes("{{otp}}")) {
    return { ok: false, providerId };
  }

  const message = template.body.replace(/\{\{otp\}\}/g, otp);
  const providerType = String(provider.provider_type || "").toLowerCase();
  const providerUrl = String(provider.api_url || "").replace(/\/$/, "");
  const providerTitle = String(provider.title || "").toLowerCase();
  const isSmsIr = providerType === "rest" && (
    providerUrl.toLowerCase().includes("sms.ir") || providerTitle.includes("sms.ir")
  );

  if (isSmsIr) {
    const apiKey = String(provider.api_key || "");
    const lineNumber = Number(String(provider.line_number || "").replace(/\D/g, ""));
    if (!apiKey || !lineNumber) return { ok: false, providerId };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(`${providerUrl || "https://api.sms.ir"}/v1/send/likeToLike`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify({
          lineNumber,
          messageTexts: [message],
          mobiles: [localPhone],
          sendDateTime: null,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null) as any;
      if (!response.ok || payload?.status !== 1) return { ok: false, providerId };

      return {
        ok: true,
        providerId,
        packId: payload?.data?.packId ? String(payload.data.packId) : null,
        messageIds: Array.isArray(payload?.data?.messageIds) ? payload.data.messageIds : [],
      };
    } catch {
      return { ok: false, providerId };
    } finally {
      clearTimeout(timeout);
    }
  }

  const canonical = toCanonicalIranPhone(localPhone);
  if (!canonical) return { ok: false, providerId };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({
        mode: "auth_otp",
        providerId,
        mobiles: [`+${canonical}`],
        message,
      }),
      signal: controller.signal,
    });
    const payload = response.ok ? await response.json().catch(() => null) as any : null;
    return {
      ok: response.ok && (payload?.ok === true || payload?.success === true),
      providerId,
      packId: payload?.packId ? String(payload.packId) : null,
      messageIds: Array.isArray(payload?.messageIds)
        ? payload.messageIds
        : Array.isArray(payload?.returnIds)
          ? payload.returnIds
          : [],
    };
  } catch {
    return { ok: false, providerId };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json() as {
      mode?: string;
      identifier_type?: string;
      identifier_value?: string;
      challenge_id?: string;
      code?: string;
      reset_token?: string;
      new_password?: string;
    };
    const mode = body.mode ?? "request";
    const admin = adminClient();
    const ipHash = await recoveryHmac(clientIp(req), "recovery_ip");

    if (mode === "request") {
      if (!body.identifier_type || !body.identifier_value) {
        return json({ ok: false, error: "INVALID_PARAMS" }, 400);
      }

      const { data: settings } = await admin
        .from("auth_security_settings")
        .select("recovery_enabled,unified_recovery_enabled,recovery_otp_ttl_seconds,recovery_max_attempts")
        .eq("id", 1)
        .maybeSingle();
      if (settings?.recovery_enabled !== true || settings?.unified_recovery_enabled !== true) {
        return json({ ok: false, error: "RECOVERY_DISABLED" }, 409);
      }

      const otpTtlSeconds = Number(settings.recovery_otp_ttl_seconds ?? 600);
      const maxAttempts = Number(settings.recovery_max_attempts ?? 5);
      if (!Number.isInteger(otpTtlSeconds) || otpTtlSeconds < 60 || otpTtlSeconds > 3600 ||
          !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
        return json({ ok: false, error: "RECOVERY_CONFIG_INVALID" }, 503);
      }

      const target = await resolveTarget(
        admin,
        String(body.identifier_type),
        String(body.identifier_value),
      );
      const normalizedForHash = target?.normalizedIdentifier ||
        String(body.identifier_value).trim().toLowerCase();
      const identifierHash = await recoveryHmac(normalizedForHash, "recovery_identifier");

      const { data: rl, error: rlError } = await admin.rpc("consume_unified_recovery_rate_limit", {
        p_purpose: "recovery_request",
        p_identifier_hash: identifierHash,
        p_ip_hash: ipHash,
        p_identifier_limit: 3,
        p_ip_limit: 10,
        p_window_seconds: 900,
      });
      if (rlError) return json({ ok: false, error: "RATE_LIMIT_FAILED" }, 503);
      if (!rl?.allowed) {
        return json({
          ok: false,
          error: "RATE_LIMITED",
          retry_after_seconds: rl?.retry_after_seconds ?? 900,
        }, 429);
      }

      if (!target?.userId || !target.phone) {
        await padTiming(3000, 3200);
        return json({ ok: true, challenge_id: crypto.randomUUID() });
      }

      const otp = randomOtp();
      const otpHash = await recoveryHmac(`${target.userId}:${otp}`, "recovery_otp");
      const challengeId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + otpTtlSeconds * 1000).toISOString();

      const { data: challenge, error: challengeError } = await admin.rpc(
        "create_unified_recovery_challenge",
        {
          p_challenge_id: challengeId,
          p_user_id: target.userId,
          p_identifier_hash: identifierHash,
          p_channel: "phone",
          p_channel_target_hash: await recoveryHmac(target.phone, "recovery_channel"),
          p_otp_hash: otpHash,
          p_expires_at: expiresAt,
          p_max_attempts: maxAttempts,
        },
      );
      if (challengeError || !challenge?.ok) {
        return json({ ok: false, error: "CHALLENGE_CREATE_FAILED" }, 503);
      }

      const delivery = await deliverRecoveryOtp(admin, target.phone, otp);
      if (!delivery.ok) {
        await admin
          .from("unified_recovery_challenges")
          .update({ status: "DELIVERY_FAILED" })
          .eq("id", challengeId);
        return json({ ok: false, error: "TRANSPORT_UNAVAILABLE" }, 503);
      }

      try {
        await admin.from("security_audit_events").insert({
          user_id: target.userId,
          event_type: "password_recovery_otp_requested",
          event_category: "recovery",
          severity: "info",
          result: "success",
          metadata: {
            provider_id: delivery.providerId ?? null,
            provider_pack_id: delivery.packId ?? null,
            provider_message_ids: delivery.messageIds ?? [],
            recovery_route: "unified",
          },
        });
      } catch {
        // Recovery must not fail solely because an audit insert is unavailable.
      }

      await padTiming(3000, 3200);
      return json({ ok: true, challenge_id: challengeId });
    }

    if (mode === "verify") {
      if (!body.challenge_id || !body.code || !/^\d{6}$/.test(body.code)) {
        return json({ ok: false, error: "INVALID_CODE" }, 400);
      }

      const { data: rl, error: rlError } = await admin.rpc("consume_unified_recovery_rate_limit", {
        p_purpose: "recovery_verify",
        p_identifier_hash: null,
        p_ip_hash: ipHash,
        p_identifier_limit: 999,
        p_ip_limit: 10,
        p_window_seconds: 900,
      });
      if (rlError) return json({ ok: false, error: "RATE_LIMIT_FAILED" }, 503);
      if (!rl?.allowed) {
        return json({
          ok: false,
          error: "RATE_LIMITED",
          retry_after_seconds: rl?.retry_after_seconds ?? 900,
        }, 429);
      }

      const { data: challengeRow } = await admin
        .from("unified_recovery_challenges")
        .select("user_id")
        .eq("id", body.challenge_id)
        .maybeSingle();
      if (!challengeRow?.user_id) {
        return json({ ok: false, error: "INVALID_OR_EXPIRED_CODE" }, 400);
      }

      const otpHash = await recoveryHmac(`${challengeRow.user_id}:${body.code}`, "recovery_otp");
      const resetToken = randomToken();
      const resetTokenHash = await recoveryHmac(resetToken, "recovery_reset_token");
      const { data: settings } = await admin
        .from("auth_security_settings")
        .select("recovery_enabled,unified_recovery_enabled,recovery_reset_token_ttl_seconds")
        .eq("id", 1)
        .maybeSingle();
      if (settings?.recovery_enabled !== true || settings?.unified_recovery_enabled !== true) {
        return json({ ok: false, error: "RECOVERY_DISABLED" }, 409);
      }

      const resetTtl = Math.min(
        Math.max(Number(settings?.recovery_reset_token_ttl_seconds) || 300, 60),
        1800,
      );
      const { data, error } = await admin.rpc("verify_unified_recovery_challenge", {
        p_challenge_id: body.challenge_id,
        p_otp_hash: otpHash,
        p_reset_token_hash: resetTokenHash,
        p_reset_expires_at: new Date(Date.now() + resetTtl * 1000).toISOString(),
      });
      if (error || !data?.ok) {
        return json({ ok: false, error: "INVALID_OR_EXPIRED_CODE" }, 400);
      }

      await padTiming(1500, 1700);
      return json({ ok: true, reset_token: resetToken });
    }

    if (mode === "complete") {
      if (!body.challenge_id || !body.reset_token || !body.new_password) {
        return json({ ok: false, error: "INVALID_PARAMS" }, 400);
      }
      if (
        body.new_password.length < 8 ||
        body.new_password.length > 128 ||
        !/[a-zA-Z]/.test(body.new_password) ||
        !/\d/.test(body.new_password)
      ) {
        return json({ ok: false, error: "INVALID_PASSWORD" }, 400);
      }

      const { data: settings } = await admin
        .from("auth_security_settings")
        .select("recovery_enabled,unified_recovery_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (settings?.recovery_enabled !== true || settings?.unified_recovery_enabled !== true) {
        return json({ ok: false, error: "RECOVERY_DISABLED" }, 409);
      }

      const { data: rl, error: rlError } = await admin.rpc("consume_unified_recovery_rate_limit", {
        p_purpose: "recovery_complete",
        p_identifier_hash: null,
        p_ip_hash: ipHash,
        p_identifier_limit: 999,
        p_ip_limit: 10,
        p_window_seconds: 900,
      });
      if (rlError) return json({ ok: false, error: "RATE_LIMIT_FAILED" }, 503);
      if (!rl?.allowed) {
        return json({
          ok: false,
          error: "RATE_LIMITED",
          retry_after_seconds: rl?.retry_after_seconds ?? 900,
        }, 429);
      }

      const resetTokenHash = await recoveryHmac(body.reset_token, "recovery_reset_token");
      const claimId = crypto.randomUUID();
      const { data: claim, error: claimError } = await admin.rpc(
        "claim_unified_recovery_completion",
        {
          p_challenge_id: body.challenge_id,
          p_reset_token_hash: resetTokenHash,
          p_claim_id: claimId,
        },
      );
      if (claimError || !claim?.ok) {
        return json({ ok: false, error: "INVALID_OR_EXPIRED_CODE" }, 400);
      }

      const { error: passwordError } = await admin.auth.admin.updateUserById(
        claim.user_id,
        { password: body.new_password },
      );
      if (passwordError) {
        await admin.rpc("finalize_unified_recovery_completion", {
          p_challenge_id: body.challenge_id,
          p_claim_id: claimId,
          p_success: false,
        });
        return json({ ok: false, error: "RESET_FAILED" }, 500);
      }

      const { data: finalized, error: finalizeError } = await admin.rpc(
        "finalize_unified_recovery_completion_v2",
        {
          p_challenge_id: body.challenge_id,
          p_claim_id: claimId,
          p_success: true,
        },
      );
      if (finalizeError || !finalized?.ok) {
        return json({ ok: false, error: "RESET_SECURITY_FINALIZATION_FAILED" }, 500);
      }

      await padTiming(1500, 1700);
      return json({ ok: true });
    }

    return json({ ok: false, error: "INVALID_MODE" }, 400);
  } catch {
    return json({ ok: false, error: "RECOVERY_OPERATION_FAILED" }, 500);
  }
});
