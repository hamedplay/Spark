import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return "";
}

async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return json({ error: "Content-Type must be JSON" }, 400);

    const body = await req.text();
    if (body.length > 8192) return json({ error: "Body too large" }, 400);

    const { first_name, last_name, username, email, phone } = JSON.parse(body);

    // Validation
    const trimmedFirst = (first_name || "").trim();
    const trimmedLast = (last_name || "").trim();
    const trimmedUsername = (username || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();
    const normalizedPhone = normalizeIranPhone(phone);

    if (!trimmedFirst || !trimmedLast) return json({ error: "نام و نام خانوادگی الزامی است" }, 400);
    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) return json({ error: "نام کاربری باید ۳ تا ۵۰ کاراکتر باشد" }, 400);
    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(trimmedUsername)) return json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(trimmedEmail)) return json({ error: "ایمیل نامعتبر است" }, 400);
    if (!normalizedPhone) return json({ error: "شماره موبایل نامعتبر است" }, 400);

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
    const identityHash = await hmacSha256Hex("identity", `${trimmedFirst}|${trimmedLast}|${trimmedUsername}|${trimmedEmail}|${normalizedPhone}`);
    const phoneHash = await hmacSha256Hex("phone", normalizedPhone);

    // Check identity/phone rate limit (3 in 15 min)
    const { count: identityCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("identity_hash", identityHash).eq("purpose", "registration_request").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (identityCount && identityCount >= 3) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    const { count: phoneCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("phone_hash", phoneHash).eq("purpose", "registration_request").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (phoneCount && phoneCount >= 3) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    // Check IP rate limit (10 in 15 min)
    const { count: ipCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("purpose", "registration_request").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (ipCount && ipCount >= 10) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    // Consume rate limit
    await supabase.rpc("consume_public_registration_rate_limit", {
      p_identity_hash: identityHash,
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_purpose: "registration_request",
    });

    // Check uniqueness (but don't reveal which identifier is taken)
    let hasConflict = false;
    const { data: existingUsername } = await supabase.from("profiles").select("user_id").eq("normalized_username", trimmedUsername.toLowerCase()).maybeSingle();
    if (existingUsername) hasConflict = true;

    if (!hasConflict) {
      const { data: existingEmail } = await supabase.from("profiles").select("user_id").eq("normalized_email", trimmedEmail).maybeSingle();
      if (existingEmail) hasConflict = true;
    }

    if (!hasConflict) {
      const { data: existingPhone } = await supabase.from("profiles").select("user_id").eq("normalized_phone", normalizedPhone).maybeSingle();
      if (existingPhone) hasConflict = true;
    }

    // Generate OTP
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

    // If conflict, return decoy challenge ID (same response shape)
    if (hasConflict) {
      return json({
        ok: true,
        challenge_id: crypto.randomUUID(),
        retry_after_seconds: resendSeconds,
      });
    }

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
          phone: `+${normalizedPhone}`,
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
