import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import {
  corsResponse,
  preflightResponse,
  rejectOrigin,
  isOriginAllowed,
  getRequestOrigin,
  normalizeIranPhone,
  getRegistrationSecret,
  hashIdentity,
  hashEmail,
  hashUsername,
  hashPhone,
  hashIp,
  hashOtp,
  generateOtp,
  adminClient,
  abortAwareDelay,
} from "../_shared/registration-security.ts";

interface SmsDeliveryMeta {
  packId: string | null;
  messageIds: Array<string | number>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return await preflightResponse(req);

  const origin = getRequestOrigin(req);
  if (!(await isOriginAllowed(origin))) return rejectOrigin();

  const json = (data: unknown, status = 200) => corsResponse(req, data, status);

  try {
    if (req.method !== "POST") return await json({ error: "Method not allowed" }, 405);

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return await json({ error: "Content-Type must be JSON" }, 400);

    const body = await req.text();
    if (body.length > 8192) return await json({ error: "Body too large" }, 400);

    const { first_name, last_name, username, email, phone } = JSON.parse(body);

    const trimmedFirst = (first_name || "").trim();
    const trimmedLast = (last_name || "").trim();
    const trimmedUsername = (username || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();
    const phoneDigits = normalizeIranPhone(phone);

    if (!trimmedFirst || !trimmedLast) return await json({ error: "نام و نام خانوادگی الزامی است" }, 400);
    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) return await json({ error: "نام کاربری باید ۳ تا ۵۰ کاراکتر باشد" }, 400);
    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(trimmedUsername)) return await json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(trimmedEmail)) return await json({ error: "ایمیل نامعتبر است" }, 400);
    if (!phoneDigits) return await json({ error: "شماره موبایل نامعتبر است" }, 400);

    const supabase = adminClient();
    let secret: string;
    try {
      secret = await getRegistrationSecret(supabase);
    } catch {
      console.error("[REGISTRATION_REQUEST] secret unavailable");
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست", code: "REGISTRATION_NOT_READY" }, 503);
    }

    const { data: settings } = await supabase.from("auth_security_settings").select("registration_enabled").eq("id", 1).maybeSingle();
    if (!settings?.registration_enabled) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    const { data: secretProxy } = await supabase.from("system_config").select("value").eq("section", "security").eq("key", "registration_phone_otp_secret_configured").maybeSingle();
    if (secretProxy?.value !== "true") return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    const { data: ttlRow } = await supabase.from("system_config").select("value").eq("section", "security").eq("key", "registration_phone_otp_ttl_seconds").maybeSingle();
    const ttlSeconds = parseInt(ttlRow?.value || "300", 10);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86400) {
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }
    const resendSeconds = 60;

    const { data: providerRow } = await supabase.from("system_config").select("value").eq("section", "sms").eq("key", "phone_login_sms_provider_id").maybeSingle();
    if (!providerRow?.value) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    const { data: provider, error: providerError } = await supabase
      .from("sms_providers")
      .select("id,title,provider_type,api_url,api_key,line_number")
      .eq("id", providerRow.value)
      .eq("is_active", true)
      .maybeSingle();
    if (providerError || !provider) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    const { data: template } = await supabase.from("sms_templates").select("body").eq("category", "auth").eq("event_type", "registration_phone_otp").eq("audience", "all").eq("is_active", true).maybeSingle();
    if (!template?.body || !template.body.includes("{{otp}}")) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    const ipHash = await hashIp(secret, req.headers.get("x-forwarded-for") || "unknown");
    const identityHash = await hashIdentity(secret, trimmedFirst, trimmedLast, trimmedUsername, trimmedEmail, phoneDigits);
    const phoneHash = await hashPhone(secret, phoneDigits);

    const { data: rateRaw, error: rateError } = await supabase.rpc("consume_public_registration_rate_limit_v2", {
      p_identity_hash: identityHash,
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_purpose: "registration_request",
      p_identity_limit: 3,
      p_phone_limit: 3,
      p_ip_limit: 10,
      p_window_seconds: 900,
    });
    if (rateError) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    const rate = Array.isArray(rateRaw) ? rateRaw[0] : rateRaw;
    if (rate?.allowed !== true) return await json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    const { data: available, error: availError } = await supabase.rpc("check_public_registration_identifiers_available", {
      p_normalized_username: trimmedUsername,
      p_normalized_email: trimmedEmail,
      p_normalized_phone: phoneDigits,
    });

    if (availError) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    const hasConflict = available !== true;
    if (hasConflict) {
      // Preserve a success-shaped response so public registration cannot be
      // used to enumerate existing username/email/phone identifiers.
      // No challenge is persisted and no OTP is sent for a conflict.
      await abortAwareDelay(200 + Math.random() * 300, req.signal);
      return await json({
        ok: true,
        challenge_id: crypto.randomUUID(),
        retry_after_seconds: resendSeconds,
      });
    }

    const challengeId = crypto.randomUUID();
    const otp = generateOtp();
    const otpHash = await hashOtp(secret, challengeId, identityHash, phoneHash, otp);
    const emailHash = await hashEmail(secret, trimmedEmail);
    const usernameHash = await hashUsername(secret, trimmedUsername);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const requestId = crypto.randomUUID();

    const { error: createError } = await supabase.rpc("create_public_registration_challenge_v2", {
      p_challenge_id: challengeId,
      p_identity_hash: identityHash,
      p_email_hash: emailHash,
      p_username_hash: usernameHash,
      p_phone_hash: phoneHash,
      p_otp_hash: otpHash,
      p_expires_at: expiresAt,
      p_request_id: requestId,
    });

    if (createError) return await json({ error: "خطا در ایجاد چالش" }, 500);

    const smsBody = template.body.replace("{{otp}}", otp);
    let deliveryFailed = false;
    let deliveryMeta: SmsDeliveryMeta = { packId: null, messageIds: [] };

    try {
      const providerType = String(provider.provider_type || "").toLowerCase();
      const providerUrl = String(provider.api_url || "").replace(/\/$/, "");
      const providerTitle = String(provider.title || "").toLowerCase();
      const isSmsIr = providerType === "rest" && (providerUrl.toLowerCase().includes("sms.ir") || providerTitle.includes("sms.ir"));

      if (isSmsIr) {
        const apiKey = String(provider.api_key || "");
        const lineNumber = Number(String(provider.line_number || "").replace(/\D/g, ""));
        const localMobile = /^989\d{9}$/.test(phoneDigits) ? `0${phoneDigits.slice(2)}` : "";

        if (!apiKey || !lineNumber || !localMobile) {
          deliveryFailed = true;
        } else {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          try {
            const sendRes = await fetch(`${providerUrl || "https://api.sms.ir"}/v1/send/likeToLike`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
                "X-API-KEY": apiKey,
              },
              body: JSON.stringify({
                lineNumber,
                messageTexts: [smsBody],
                mobiles: [localMobile],
                sendDateTime: null,
              }),
              signal: controller.signal,
            });
            const sendData = await sendRes.json().catch(() => null) as any;
            if (!sendRes.ok || sendData?.status !== 1) {
              deliveryFailed = true;
              console.log("[AUTH_OTP_REDACTED] sms.ir delivery rejected");
            } else {
              deliveryMeta = {
                packId: sendData?.data?.packId ? String(sendData.data.packId) : null,
                messageIds: Array.isArray(sendData?.data?.messageIds) ? sendData.data.messageIds : [],
              };
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const sendRes = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-sms`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              mode: "auth_otp",
              providerId: providerRow.value,
              mobiles: [`+${phoneDigits}`],
              message: smsBody,
            }),
            signal: controller.signal,
          });

          let sendResult: { ok?: boolean; success?: boolean; packId?: unknown; messageIds?: unknown; returnIds?: unknown } | null = null;
          if (sendRes.ok) {
            try { sendResult = await sendRes.json(); } catch { /* ignore parse error */ }
          }

          if (!sendRes.ok || (sendResult?.ok !== true && sendResult?.success !== true)) {
            deliveryFailed = true;
            console.log("[AUTH_OTP_REDACTED] delivery failed");
          } else {
            deliveryMeta = {
              packId: sendResult?.packId ? String(sendResult.packId) : null,
              messageIds: Array.isArray(sendResult?.messageIds)
                ? sendResult.messageIds as Array<string | number>
                : Array.isArray(sendResult?.returnIds)
                  ? sendResult.returnIds as Array<string | number>
                  : [],
            };
          }
        } finally {
          clearTimeout(timeout);
        }
      }
    } catch {
      deliveryFailed = true;
      console.log("[AUTH_OTP_REDACTED] delivery error");
    }

    if (deliveryFailed) {
      await supabase.rpc("mark_registration_delivery_failed_v2", { p_challenge_id: challengeId });
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }

    try {
      await supabase.from("security_audit_events").insert({
        event_type: "registration_otp_requested",
        event_category: "auth",
        severity: "info",
        result: "success",
        request_id: requestId,
        metadata: {
          registration_source: "public_phone_registration",
          provider_id: provider.id,
          provider_type: provider.provider_type,
          provider_pack_id: deliveryMeta.packId,
          provider_message_ids: deliveryMeta.messageIds,
        },
      });
    } catch { /* best-effort */ }

    return await json({
      ok: true,
      challenge_id: challengeId,
      retry_after_seconds: resendSeconds,
    });
  } catch (error) {
    console.error("[REGISTRATION_REQUEST] unexpected error", error instanceof Error ? error.name : "unknown");
    return await json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
