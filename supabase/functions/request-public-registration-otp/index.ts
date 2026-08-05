import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsResponse,
  preflightResponse,
  rejectOrigin,
  isOriginAllowed,
  getRequestOrigin,
  normalizeIranPhone,
  hmacSha256Hex,
  generateOtp,
  adminClient,
} from "../_shared/registration-security.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return preflightResponse(req);

  const origin = getRequestOrigin(req);
  if (!isOriginAllowed(origin)) return rejectOrigin(req);

  const json = (data: unknown, status = 200) => corsResponse(req, data, status);

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return json({ error: "Content-Type must be JSON" }, 400);

    const body = await req.text();
    if (body.length > 8192) return json({ error: "Body too large" }, 400);

    const { first_name, last_name, username, email, phone } = JSON.parse(body);

    const trimmedFirst = (first_name || "").trim();
    const trimmedLast = (last_name || "").trim();
    const trimmedUsername = (username || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();
    const phoneDigits = normalizeIranPhone(phone);

    if (!trimmedFirst || !trimmedLast) return json({ error: "نام و نام خانوادگی الزامی است" }, 400);
    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) return json({ error: "نام کاربری باید ۳ تا ۵۰ کاراکتر باشد" }, 400);
    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(trimmedUsername)) return json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(trimmedEmail)) return json({ error: "ایمیل نامعتبر است" }, 400);
    if (!phoneDigits) return json({ error: "شماره موبایل نامعتبر است" }, 400);

    const supabase = adminClient();

    // Check registration readiness
    const { data: settings } = await supabase.from("auth_security_settings").select("registration_enabled").eq("id", 1).maybeSingle();
    if (!settings?.registration_enabled) return json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Check secret proxy
    const { data: secretProxy } = await supabase.from("system_config").select("value").eq("section", "security").eq("key", "registration_phone_otp_secret_configured").maybeSingle();
    if (secretProxy?.value !== "true") return json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Get TTL
    const { data: ttlRow } = await supabase.from("system_config").select("value").eq("section", "security").eq("key", "registration_phone_otp_ttl_seconds").maybeSingle();
    const ttlSeconds = parseInt(ttlRow?.value || "300", 10);
    const resendSeconds = 60;

    // Get provider
    const { data: providerRow } = await supabase.from("system_config").select("value").eq("section", "sms").eq("key", "phone_login_sms_provider_id").maybeSingle();
    if (!providerRow?.value) return json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Check template
    const { data: template } = await supabase.from("sms_templates").select("body").eq("category", "auth").eq("event_type", "registration_phone_otp").eq("audience", "all").eq("is_active", true).maybeSingle();
    if (!template?.body || !template.body.includes("{{otp}}")) return json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);

    // Rate limit
    const ipHash = await hmacSha256Hex("ip", req.headers.get("x-forwarded-for") || "unknown");
    const identityHash = await hmacSha256Hex("identity", `${trimmedFirst}|${trimmedLast}|${trimmedUsername}|${trimmedEmail}|${phoneDigits}`);
    const phoneHash = await hmacSha256Hex("phone", phoneDigits);

    const { count: identityCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("identity_hash", identityHash).eq("purpose", "registration_request").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (identityCount && identityCount >= 3) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    const { count: phoneCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("phone_hash", phoneHash).eq("purpose", "registration_request").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (phoneCount && phoneCount >= 3) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    const { count: ipCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("purpose", "registration_request").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (ipCount && ipCount >= 10) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    await supabase.rpc("consume_public_registration_rate_limit", {
      p_identity_hash: identityHash,
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_purpose: "registration_request",
    });

    // Check identifier availability via RPC
    const { data: available, error: availError } = await supabase.rpc("check_public_registration_identifiers_available", {
      p_normalized_username: trimmedUsername,
      p_normalized_email: trimmedEmail,
      p_normalized_phone: phoneDigits,
    });

    if (availError) {
      return json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }

    const hasConflict = available !== true;
    if (hasConflict) {
      // Decoy response — same shape as success, no OTP sent
      return json({
        ok: true,
        challenge_id: crypto.randomUUID(),
        retry_after_seconds: resendSeconds,
      });
    }

    // Generate OTP using Web Crypto (crypto.subtle) via hmacSha256Hex
    const otp = generateOtp();
    const otpHash = await hmacSha256Hex(Deno.env.get("REGISTRATION_PHONE_OTP_SECRET")!, `${identityHash}|${phoneHash}|${otp}`);
    const emailHash = await hmacSha256Hex("email", trimmedEmail);
    const usernameHash = await hmacSha256Hex("username", trimmedUsername.toLowerCase());
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    const requestId = crypto.randomUUID();

    // Create challenge
    const { data: challengeId } = await supabase.rpc("create_public_registration_challenge", {
      p_identity_hash: identityHash,
      p_email_hash: emailHash,
      p_username_hash: usernameHash,
      p_phone_hash: phoneHash,
      p_otp_hash: otpHash,
      p_expires_at: expiresAt,
      p_request_id: requestId,
    });

    if (!challengeId) return json({ error: "خطا در ایجاد چالش" }, 500);

    // Send OTP via send-sms
    const smsBody = template.body.replace("{{otp}}", otp);
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
          phone: `+${phoneDigits}`,
          message: smsBody,
          provider_id: providerRow.value,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!sendRes.ok) {
        await supabase.rpc("mark_registration_delivery_failed", { p_challenge_id: challengeId });
        console.log("[AUTH_OTP_REDACTED] delivery failed");
      }
    } catch {
      await supabase.rpc("mark_registration_delivery_failed", { p_challenge_id: challengeId });
      console.log("[AUTH_OTP_REDACTED] delivery error");
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

    return json({
      ok: true,
      challenge_id: challengeId,
      retry_after_seconds: resendSeconds,
    });
  } catch {
    return json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
