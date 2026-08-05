import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsResponse,
  preflightResponse,
  rejectOrigin,
  isOriginAllowed,
  getRequestOrigin,
  normalizeIranPhone,
  hmacSha256Hex,
  hashIdentity,
  hashEmail,
  hashUsername,
  hashPhone,
  hashIp,
  generateOtp,
  adminClient,
  abortAwareDelay,
} from "../_shared/registration-security.ts";

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

    const secret = Deno.env.get("REGISTRATION_PHONE_OTP_SECRET") || "";
    if (secret.length < 32) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    const supabase = adminClient();

    // Check registration readiness
    const { data: settings } = await supabase.from("auth_security_settings").select("registration_enabled").eq("id", 1).maybeSingle();
    if (!settings?.registration_enabled) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Check secret proxy
    const { data: secretProxy } = await supabase.from("system_config").select("value").eq("section", "security").eq("key", "registration_phone_otp_secret_configured").maybeSingle();
    if (secretProxy?.value !== "true") return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Get TTL
    const { data: ttlRow } = await supabase.from("system_config").select("value").eq("section", "security").eq("key", "registration_phone_otp_ttl_seconds").maybeSingle();
    const ttlSeconds = parseInt(ttlRow?.value || "300", 10);
    const resendSeconds = 60;

    // Get provider
    const { data: providerRow } = await supabase.from("system_config").select("value").eq("section", "sms").eq("key", "phone_login_sms_provider_id").maybeSingle();
    if (!providerRow?.value) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Check template
    const { data: template } = await supabase.from("sms_templates").select("body").eq("category", "auth").eq("event_type", "registration_phone_otp").eq("audience", "all").eq("is_active", true).maybeSingle();
    if (!template?.body || !template.body.includes("{{otp}}")) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Hashes with domain separation
    const ipHash = await hashIp(secret, req.headers.get("x-forwarded-for") || "unknown");
    const identityHash = await hashIdentity(secret, trimmedFirst, trimmedLast, trimmedUsername, trimmedEmail, phoneDigits);
    const phoneHash = await hashPhone(secret, phoneDigits);

    // Rate limit via V2 RPC
    const { error: rlError } = await supabase.rpc("consume_public_registration_rate_limit_v2", {
      p_identity_hash: identityHash,
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_purpose: "registration_request",
      p_identity_limit: 3,
      p_phone_limit: 3,
      p_ip_limit: 10,
      p_window_seconds: 900,
    });
    if (rlError) return await json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    // Check identifier availability via RPC
    const { data: available, error: availError } = await supabase.rpc("check_public_registration_identifiers_available", {
      p_normalized_username: trimmedUsername,
      p_normalized_email: trimmedEmail,
      p_normalized_phone: phoneDigits,
    });

    if (availError) {
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }

    const hasConflict = available !== true;
    if (hasConflict) {
      // Decoy response — same shape as success, no OTP sent
      await abortAwareDelay(200 + Math.random() * 300);
      return await json({
        ok: true,
        challenge_id: crypto.randomUUID(),
        retry_after_seconds: resendSeconds,
      });
    }

    // Generate challengeId before hashing OTP
    const challengeId = crypto.randomUUID();
    const otp = generateOtp();
    // OTP hash: HMAC-SHA256 via Web Crypto (crypto.subtle), challenge-bound
    const otpEnc = new TextEncoder();
    const otpCryptoKey = await crypto.subtle.importKey("raw", otpEnc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const otpSig = await crypto.subtle.sign("HMAC", otpCryptoKey, otpEnc.encode(`otp|${challengeId}|${identityHash}|${phoneHash}|${otp}`));
    const otpHash = Array.from(new Uint8Array(otpSig)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const emailHash = await hashEmail(secret, trimmedEmail);
    const usernameHash = await hashUsername(secret, trimmedUsername);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const requestId = crypto.randomUUID();

    // Create challenge via V2 RPC
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

    // Send OTP via send-sms
    const smsBody = template.body.replace("{{otp}}", otp);
    let deliveryFailed = false;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

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
      clearTimeout(timeout);

      if (!sendRes.ok) {
        deliveryFailed = true;
        console.log("[AUTH_OTP_REDACTED] delivery failed");
      }
    } catch {
      deliveryFailed = true;
      console.log("[AUTH_OTP_REDACTED] delivery error");
    }

    if (deliveryFailed) {
      await supabase.rpc("mark_registration_delivery_failed_v2", { p_challenge_id: challengeId });
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }

    // Audit
    try {
      await supabase.from("security_audit_events").insert({
        event_type: "registration_otp_requested",
        event_category: "auth",
        severity: "info",
        result: "success",
        request_id: requestId,
        metadata: { registration_source: "public_phone_registration" },
      });
    } catch { /* best-effort */ }

    return await json({
      ok: true,
      challenge_id: challengeId,
      retry_after_seconds: resendSeconds,
    });
  } catch {
    return await json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
