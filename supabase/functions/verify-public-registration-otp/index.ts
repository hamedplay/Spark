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

    const { challenge_id, otp, first_name, last_name, username, email, phone, password } = JSON.parse(body);

    // Validate challenge_id and OTP
    if (!challenge_id) return json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
    if (!otp || !/^\d{6}$/.test(otp)) return json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);

    // Validate password
    if (!password || password.length < 8) return json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد" }, 400);
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) return json({ error: "رمز عبور باید شامل حروف و عدد باشد" }, 400);

    // Validate other fields
    const trimmedFirst = (first_name || "").trim();
    const trimmedLast = (last_name || "").trim();
    const trimmedUsername = (username || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();
    const normalizedPhone = normalizeIranPhone(phone);

    if (!trimmedFirst || !trimmedLast) return json({ error: "نام و نام خانوادگی الزامی است" }, 400);
    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) return json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(trimmedUsername)) return json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(trimmedEmail)) return json({ error: "ایمیل نامعتبر است" }, 400);
    if (!normalizedPhone) return json({ error: "شماره موبایل نامعتبر است" }, 400);

    const supabase = adminClient();

    // Recompute identity hash
    const identityHash = await hmacSha256Hex("identity", `${trimmedFirst}|${trimmedLast}|${trimmedUsername}|${trimmedEmail}|${normalizedPhone}`);
    const phoneHash = await hmacSha256Hex("phone", normalizedPhone);
    const otpHash = await hmacSha256Hex(Deno.env.get("REGISTRATION_PHONE_OTP_SECRET")!, `${identityHash}|${phoneHash}|${otp}`);

    // Rate limit verify (IP: 20 in 15 min)
    const ipHash = await hmacSha256Hex("ip", req.headers.get("x-forwarded-for") || "unknown");
    const { count: ipVerifyCount } = await supabase.from("public_registration_rate_limit").select("*", { count: "exact", head: true }).eq("ip_hash", ipHash).eq("purpose", "registration_verify").gt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());
    if (ipVerifyCount && ipVerifyCount >= 20) return json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    await supabase.rpc("consume_public_registration_rate_limit", {
      p_identity_hash: identityHash,
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_purpose: "registration_verify",
    });

    // Claim challenge
    const { data: claimResult } = await supabase.rpc("claim_public_registration_challenge", {
      p_challenge_id: challenge_id,
      p_identity_hash: identityHash,
      p_otp_hash: otpHash,
    });

    if (!claimResult?.ok) {
      // Audit invalid OTP
      try {
        await supabase.from("security_audit_events").insert({
          event_type: "registration_otp_invalid",
          event_category: "auth",
          severity: "warning",
          result: "failure",
          metadata: { error: claimResult?.error || "unknown" },
        });
      } catch { /* best-effort */ }

      if (claimResult?.error === "CHALLENGE_LOCKED") {
        return json({ error: "تعداد تلاش‌ها بیش از حد مجاز است" }, 429);
      }
      return json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
    }

    // Recheck uniqueness
    const { data: existingUsername } = await supabase.from("profiles").select("user_id").eq("normalized_username", trimmedUsername.toLowerCase()).maybeSingle();
    if (existingUsername) {
      await supabase.rpc("release_public_registration_claim", { p_challenge_id: challenge_id });
      return json({ error: "این نام کاربری قبلاً استفاده شده است" }, 409);
    }

    const { data: existingEmail } = await supabase.from("profiles").select("user_id").eq("normalized_email", trimmedEmail).maybeSingle();
    if (existingEmail) {
      await supabase.rpc("release_public_registration_claim", { p_challenge_id: challenge_id });
      return json({ error: "این ایمیل قبلاً ثبت شده است" }, 409);
    }

    const { data: existingPhone } = await supabase.from("profiles").select("user_id").eq("normalized_phone", normalizedPhone).maybeSingle();
    if (existingPhone) {
      await supabase.rpc("release_public_registration_claim", { p_challenge_id: challenge_id });
      return json({ error: "این شماره موبایل قبلاً ثبت شده است" }, 409);
    }

    // Create auth user
    const fullName = `${trimmedFirst} ${trimmedLast}`.trim();
    const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
      phone: `+${normalizedPhone}`,
      phone_confirm: true,
      user_metadata: {
        first_name: trimmedFirst,
        last_name: trimmedLast,
        full_name: fullName,
        username: trimmedUsername,
        email: trimmedEmail,
        phone: `+${normalizedPhone}`,
      },
      app_metadata: {
        registration_flow: "public_phone_v1",
      },
    });

    if (createErr) {
      await supabase.rpc("release_public_registration_claim", { p_challenge_id: challenge_id });
      if (createErr.message?.includes("already") || createErr.message?.includes("duplicate")) {
        return json({ error: "این ایمیل یا شماره قبلاً ثبت شده است" }, 409);
      }
      return json({ error: "خطا در ایجاد حساب کاربری" }, 500);
    }

    const userId = userData.user.id;

    // Finalize challenge
    await supabase.rpc("finalize_public_registration_challenge", {
      p_challenge_id: challenge_id,
      p_created_user_id: userId,
    });

    // Sign in with email/password
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (signInErr || !signInData.session) {
      return json({ error: "حساب ساخته شد اما ورود خودکار ناموفق بود. لطفاً وارد شوید." }, 400);
    }

    // Audit
    try {
      await supabase.from("security_audit_events").insert({
        actor_user_id: userId,
        event_type: "registration_completed",
        event_category: "auth",
        severity: "info",
        result: "success",
        metadata: { registration_source: "public_phone_registration" },
      });
    } catch { /* best-effort */ }

    return json({
      ok: true,
      session: signInData.session,
      user: signInData.user,
    });
  } catch (err: unknown) {
    return json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
