import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  corsResponse,
  preflightResponse,
  rejectOrigin,
  isOriginAllowed,
  getRequestOrigin,
  normalizeIranPhone,
  getRegistrationSecret,
  hashIdentity,
  hashPhone,
  hashIp,
  hashOtp,
  adminClient,
} from "../_shared/registration-security.ts";

interface ClaimResult {
  ok?: boolean;
  error?: string;
  created_user_id?: string;
  claim_id?: string;
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

    const { challenge_id, otp, first_name, last_name, username, email, phone, password } = JSON.parse(body);

    if (!challenge_id) return await json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
    if (!otp || !/^\d{6}$/.test(otp)) return await json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);

    if (!password || password.length < 8) return await json({ error: "رمز عبور باید حداقل ۸ کاراکتر باشد" }, 400);
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(password)) return await json({ error: "رمز عبور باید شامل حروف و عدد باشد" }, 400);

    const trimmedFirst = (first_name || "").trim();
    const trimmedLast = (last_name || "").trim();
    const trimmedUsername = (username || "").trim();
    const trimmedEmail = (email || "").trim().toLowerCase();
    const phoneDigits = normalizeIranPhone(phone);

    if (!trimmedFirst || !trimmedLast) return await json({ error: "نام و نام خانوادگی الزامی است" }, 400);
    if (trimmedUsername.length < 3 || trimmedUsername.length > 50) return await json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(trimmedUsername)) return await json({ error: "نام کاربری نامعتبر است" }, 400);
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(trimmedEmail)) return await json({ error: "ایمیل نامعتبر است" }, 400);
    if (!phoneDigits) return await json({ error: "شماره موبایل نامعتبر است" }, 400);

    const secret = getRegistrationSecret();
    const supabase = adminClient();

    // Recompute hashes with domain separation
    const identityHash = await hashIdentity(secret, trimmedFirst, trimmedLast, trimmedUsername, trimmedEmail, phoneDigits);
    const phoneHash = await hashPhone(secret, phoneDigits);
    const ipHash = await hashIp(secret, req.headers.get("x-forwarded-for") || "unknown");

    // Generate claimId
    const claimId = crypto.randomUUID();

    // Compute OTP hash bound to challenge
    const otpHash = await hashOtp(secret, challenge_id, identityHash, phoneHash, otp);

    // Rate limit verify via V2 RPC
    const { data: rateRaw, error: rateError } = await supabase.rpc("consume_public_registration_rate_limit_v2", {
      p_identity_hash: identityHash,
      p_phone_hash: phoneHash,
      p_ip_hash: ipHash,
      p_purpose: "registration_verify",
      p_identity_limit: 5,
      p_phone_limit: 5,
      p_ip_limit: 20,
      p_window_seconds: 900,
    });
    if (rateError) return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    const rate = Array.isArray(rateRaw) ? rateRaw[0] : rateRaw;
    if (rate?.allowed !== true) return await json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);

    // Claim challenge via V2 RPC
    const { data: claimResult, error: claimError } = await supabase.rpc("claim_public_registration_challenge_v2", {
      p_challenge_id: challenge_id,
      p_identity_hash: identityHash,
      p_otp_hash: otpHash,
      p_claim_id: claimId,
    });

    if (claimError || !claimResult) {
      try {
        await supabase.from("security_audit_events").insert({
          event_type: "registration_otp_invalid",
          event_category: "auth",
          severity: "warning",
          result: "failure",
          metadata: { error: "claim_error" },
        });
      } catch { /* best-effort */ }
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }

    const claim = (Array.isArray(claimResult) ? claimResult[0] : claimResult) as ClaimResult;

    if (!claim.ok) {
      if (claim.error === "ALREADY_CONSUMED" && claim.created_user_id) {
        const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (signInErr || !signInData.session || !signInData.user) {
          return await json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
        }
        if (signInData.user.id !== claim.created_user_id) {
          return await json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
        }
        return await json({ ok: true, session: signInData.session, user: signInData.user });
      }

      if (claim.error === "ACTIVE_PROCESSING") {
        return await json({ error: "درخواست در حال پردازش است. لطفاً صبر کنید." }, 409);
      }

      if (claim.error === "CHALLENGE_LOCKED") {
        return await json({ error: "تعداد درخواست‌ها بیش از حد مجاز است" }, 429);
      }

      try {
        await supabase.from("security_audit_events").insert({
          event_type: "registration_otp_invalid",
          event_category: "auth",
          severity: "warning",
          result: "failure",
          metadata: { error: claim.error || "unknown" },
        });
      } catch { /* best-effort */ }

      return await json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
    }

    // Check identifier availability via RPC
    const { data: available, error: availError } = await supabase.rpc("check_public_registration_identifiers_available", {
      p_normalized_username: trimmedUsername,
      p_normalized_email: trimmedEmail,
      p_normalized_phone: phoneDigits,
    });

    if (availError) {
      await supabase.rpc("release_public_registration_claim_v2", { p_challenge_id: challenge_id, p_claim_id: claimId });
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }

    if (available !== true) {
      await supabase.rpc("release_public_registration_claim_v2", { p_challenge_id: challenge_id, p_claim_id: claimId });
      return await json({ error: "کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد." }, 400);
    }

    // Create auth user
    const fullName = `${trimmedFirst} ${trimmedLast}`.trim();
    const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
      email: trimmedEmail,
      password,
      email_confirm: true,
      phone: `+${phoneDigits}`,
      phone_confirm: true,
      user_metadata: {
        first_name: trimmedFirst,
        last_name: trimmedLast,
        full_name: fullName,
        username: trimmedUsername,
        email: trimmedEmail,
        phone: `+${phoneDigits}`,
      },
      app_metadata: {
        registration_flow: "public_phone_v1",
        registration_challenge_id: challenge_id,
        registration_claim_id: claimId,
        registration_identity_hash: identityHash,
      },
    });

    if (createErr) {
      await supabase.rpc("release_public_registration_claim_v2", { p_challenge_id: challenge_id, p_claim_id: claimId });
      if (createErr.message?.includes("already") || createErr.message?.includes("duplicate")) {
        return await json({ error: "این ایمیل یا شماره قبلاً ثبت شده است" }, 409);
      }
      return await json({ error: "خطا در ایجاد حساب کاربری" }, 500);
    }

    const userId = userData.user.id;

    // Sign in with email/password
    const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (signInErr || !signInData.session || !signInData.user || signInData.user.id !== userId) {
      return await json({ error: "حساب ساخته شد اما ورود خودکار ناموفق بود. لطفاً وارد شوید." }, 400);
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

    return await json({
      ok: true,
      session: signInData.session,
      user: signInData.user,
    });
  } catch {
    return await json({ error: "خطا در پردازش درخواست" }, 500);
  }
});
