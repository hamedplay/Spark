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
  hashPhone,
  hashIp,
  hashOtp,
  adminClient,
} from "../_shared/registration-security.ts";
import {
  authorizeGatewaySession,
  getSessionIdFromAccessToken,
  revokeLocalSession,
} from "../_shared/authorizeGatewaySession.ts";

const INTERNAL_AUTH_DOMAIN = "auth.spark.invalid";

interface ClaimResult {
  ok?: boolean;
  error?: string;
  created_user_id?: string;
  claim_id?: string;
}

interface ReconcileResult {
  ok?: boolean;
  error?: string;
  found?: boolean;
  user_id?: string;
  account_status?: string;
  profile_created?: boolean;
  challenge_finalized?: boolean;
}

async function registerSessionSecurityState(
  supabase: ReturnType<typeof adminClient>,
  sessionId: string | undefined,
  userId: string,
  deviceSummary: string,
  ipHash: string,
): Promise<boolean> {
  if (!sessionId) return false;
  const { data: settings, error: settingsError } = await supabase
    .from("auth_security_settings")
    .select("session_management_enabled, session_idle_timeout_minutes, session_absolute_lifetime_minutes")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) return false;
  if (!settings?.session_management_enabled) return true;

  const { data, error } = await supabase.rpc("register_session_security_state_v2", {
    p_session_id: sessionId,
    p_user_id: userId,
    p_idle_timeout_minutes: settings.session_idle_timeout_minutes ?? 480,
    p_absolute_lifetime_minutes: settings.session_absolute_lifetime_minutes ?? 1440,
    p_device_summary: deviceSummary,
    p_ip_hash: ipHash,
  });
  return !error && data?.ok === true;
}

async function reconcileRegistration(
  supabase: ReturnType<typeof adminClient>,
  challengeId: string,
  identityHash: string,
): Promise<ReconcileResult> {
  const { data, error } = await supabase.rpc("reconcile_public_registration_user_service", {
    p_challenge_id: challengeId,
    p_identity_hash: identityHash,
  });
  if (error || !data) {
    console.error("[REGISTRATION_VERIFY] reconcile failed", {
      code: error?.code,
      message: error?.message,
    });
    return { ok: false, error: "RECONCILE_FAILED" };
  }
  return (Array.isArray(data) ? data[0] : data) as ReconcileResult;
}

function internalCredentialEmail(seed: string): string {
  return `reg-${seed}@${INTERNAL_AUTH_DOMAIN}`;
}

async function ensureRegistrationAuthEmail(
  supabase: ReturnType<typeof adminClient>,
  expectedUserId: string,
  phoneDigits: string,
  password: string,
): Promise<string | null> {
  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(expectedUserId);
  if (userError || !userData?.user) return null;

  const authUser = userData.user;
  if (authUser.app_metadata?.registration_flow !== "public_phone_v1") return null;
  if (!authUser.phone_confirmed_at || normalizeIranPhone(authUser.phone) !== phoneDigits) return null;

  if (typeof authUser.email === "string" && authUser.email.length > 0 && authUser.email_confirmed_at) {
    return authUser.email;
  }

  // Legacy repair: older public-phone registrations were created with an
  // unconfirmed real email and a confirmed phone. Since GoTrue phone-password
  // login is intentionally disabled, verify the existing password hash via the
  // service-only RPC before changing the Auth credential.
  const { data: passwordMatches, error: passwordError } = await supabase.rpc(
    "verify_public_registration_password_service",
    { p_user_id: expectedUserId, p_password: password },
  );
  if (passwordError || passwordMatches !== true) return null;

  const { data: migrated, error: migrateError } = await supabase.auth.admin.updateUserById(
    expectedUserId,
    {
      email: internalCredentialEmail(expectedUserId),
      email_confirm: true,
    },
  );
  if (migrateError || !migrated?.user?.email || !migrated.user.email_confirmed_at) return null;
  return migrated.user.email;
}

async function signInRegisteredUser(
  supabase: ReturnType<typeof adminClient>,
  req: Request,
  phoneDigits: string,
  password: string,
  expectedUserId: string,
  identityHash: string,
  ipHash: string,
): Promise<
  | { ok: true; session: unknown; user: unknown }
  | { ok: false; error: string }
> {
  const authEmail = await ensureRegistrationAuthEmail(
    supabase,
    expectedUserId,
    phoneDigits,
    password,
  );
  if (!authEmail) return { ok: false, error: "AUTO_LOGIN_CREDENTIAL_UNAVAILABLE" };

  const { data: signInData, error: signInErr } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });

  if (signInErr || !signInData.session || !signInData.user) {
    console.error("[REGISTRATION_VERIFY] internal email password sign-in failed", {
      code: signInErr?.code,
      name: signInErr?.name,
    });
    return { ok: false, error: "AUTO_LOGIN_FAILED" };
  }

  if (signInData.user.id !== expectedUserId) {
    await revokeLocalSession(signInData.session.access_token);
    return { ok: false, error: "AUTO_LOGIN_USER_MISMATCH" };
  }

  const accessToken = signInData.session.access_token;
  const authResult = await authorizeGatewaySession({
    adminClient: supabase,
    accessToken,
    expectedUserId,
    loginMethod: "public_registration",
    identifierHash: identityHash,
    ipHash,
  });

  if (!authResult.authorized) {
    await revokeLocalSession(accessToken);
    return { ok: false, error: "GATEWAY_AUTHORIZATION_FAILED" };
  }

  if (!await registerSessionSecurityState(
    supabase,
    getSessionIdFromAccessToken(accessToken) ?? undefined,
    expectedUserId,
    req.headers.get("user-agent")?.slice(0, 200) ?? "unknown",
    ipHash,
  )) {
    await revokeLocalSession(accessToken);
    return { ok: false, error: "SESSION_SECURITY_STATE_FAILED" };
  }

  return { ok: true, session: signInData.session, user: signInData.user };
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
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > 8192) return await json({ error: "Body too large" }, 400);

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

    const supabase = adminClient();
    let secret: string;
    try {
      secret = await getRegistrationSecret(supabase);
    } catch {
      console.error("[REGISTRATION_VERIFY] secret unavailable");
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست", code: "REGISTRATION_NOT_READY" }, 503);
    }

    const identityHash = await hashIdentity(secret, trimmedFirst, trimmedLast, trimmedUsername, trimmedEmail, phoneDigits);
    const phoneHash = await hashPhone(secret, phoneDigits);
    const ipHash = await hashIp(secret, req.headers.get("x-forwarded-for") || "unknown");
    const otpHash = await hashOtp(secret, challenge_id, identityHash, phoneHash, otp);

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

    const preClaimReconcile = await reconcileRegistration(supabase, challenge_id, identityHash);
    if (preClaimReconcile.ok !== true) {
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }
    if (preClaimReconcile.found === true && preClaimReconcile.user_id) {
      if (preClaimReconcile.account_status !== "ACTIVE") {
        return await json({
          ok: true,
          registration_complete: true,
          pending_approval: preClaimReconcile.account_status === "PENDING_ADMIN_APPROVAL",
        });
      }

      const recoveredSignIn = await signInRegisteredUser(
        supabase,
        req,
        phoneDigits,
        password,
        preClaimReconcile.user_id,
        identityHash,
        ipHash,
      );
      if (recoveredSignIn.ok) {
        return await json({ ok: true, session: recoveredSignIn.session, user: recoveredSignIn.user, recovered: true });
      }
      return await json({ ok: true, registration_complete: true, requires_login: true });
    }

    const claimId = crypto.randomUUID();
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
        const signIn = await signInRegisteredUser(
          supabase,
          req,
          phoneDigits,
          password,
          claim.created_user_id,
          identityHash,
          ipHash,
        );
        if (signIn.ok) return await json({ ok: true, session: signIn.session, user: signIn.user });
        return await json({ ok: true, registration_complete: true, requires_login: true });
      }

      if (claim.error === "ACTIVE_PROCESSING") {
        const retryReconcile = await reconcileRegistration(supabase, challenge_id, identityHash);
        if (retryReconcile.ok === true && retryReconcile.found === true && retryReconcile.user_id) {
          if (retryReconcile.account_status !== "ACTIVE") {
            return await json({
              ok: true,
              registration_complete: true,
              pending_approval: retryReconcile.account_status === "PENDING_ADMIN_APPROVAL",
            });
          }
          const signIn = await signInRegisteredUser(
            supabase,
            req,
            phoneDigits,
            password,
            retryReconcile.user_id,
            identityHash,
            ipHash,
          );
          if (signIn.ok) return await json({ ok: true, session: signIn.session, user: signIn.user, recovered: true });
          return await json({ ok: true, registration_complete: true, requires_login: true });
        }
        return await json({ error: "درخواست در حال پردازش است. لطفاً چند ثانیه بعد دوباره تلاش کنید." }, 409);
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

    const postClaimReconcile = await reconcileRegistration(supabase, challenge_id, identityHash);
    if (postClaimReconcile.ok !== true) {
      await supabase.rpc("release_public_registration_claim_v2", { p_challenge_id: challenge_id, p_claim_id: claimId });
      return await json({ error: "ثبت‌نام در حال حاضر فعال نیست" }, 503);
    }
    if (postClaimReconcile.found === true && postClaimReconcile.user_id) {
      if (postClaimReconcile.account_status !== "ACTIVE") {
        return await json({
          ok: true,
          registration_complete: true,
          pending_approval: postClaimReconcile.account_status === "PENDING_ADMIN_APPROVAL",
        });
      }
      const signIn = await signInRegisteredUser(
        supabase,
        req,
        phoneDigits,
        password,
        postClaimReconcile.user_id,
        identityHash,
        ipHash,
      );
      if (signIn.ok) return await json({ ok: true, session: signIn.session, user: signIn.user, recovered: true });
      return await json({ ok: true, registration_complete: true, requires_login: true });
    }

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
      return await json({ error: "نام کاربری، ایمیل یا شماره موبایل واردشده قبلاً در سامانه ثبت شده است." }, 409);
    }

    const fullName = `${trimmedFirst} ${trimmedLast}`.trim();
    const { data: userData, error: createErr } = await supabase.auth.admin.createUser({
      // The contact email is intentionally kept in user_metadata/profiles. Auth
      // uses a non-PII internal confirmed email solely as the password credential,
      // so public registration does not depend on GoTrue's phone-password provider.
      email: internalCredentialEmail(challenge_id),
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

    if (createErr || !userData?.user) {
      const recovery = await reconcileRegistration(supabase, challenge_id, identityHash);
      if (recovery.ok === true && recovery.found === true && recovery.user_id) {
        if (recovery.account_status !== "ACTIVE") {
          return await json({
            ok: true,
            registration_complete: true,
            pending_approval: recovery.account_status === "PENDING_ADMIN_APPROVAL",
          });
        }
        const signIn = await signInRegisteredUser(
          supabase,
          req,
          phoneDigits,
          password,
          recovery.user_id,
          identityHash,
          ipHash,
        );
        if (signIn.ok) return await json({ ok: true, session: signIn.session, user: signIn.user, recovered: true });
        return await json({ ok: true, registration_complete: true, requires_login: true });
      }

      await supabase.rpc("release_public_registration_claim_v2", { p_challenge_id: challenge_id, p_claim_id: claimId });
      if (createErr?.message?.includes("already") || createErr?.message?.includes("duplicate")) {
        return await json({ error: "نام کاربری، ایمیل یا شماره موبایل واردشده قبلاً در سامانه ثبت شده است." }, 409);
      }
      return await json({ error: "خطا در ایجاد حساب کاربری" }, 500);
    }

    const userId = userData.user.id;
    const reconciled = await reconcileRegistration(supabase, challenge_id, identityHash);
    if (reconciled.ok !== true || reconciled.found !== true || reconciled.user_id !== userId) {
      console.error("[REGISTRATION_VERIFY] user created but reconciliation incomplete", { userId });
      return await json({
        error: "حساب ایجاد شد اما تکمیل ثبت‌نام موقتاً ناموفق بود. دوباره دکمه تأیید را بزنید.",
        code: "REGISTRATION_RECONCILE_PENDING",
      }, 503);
    }

    if (reconciled.account_status !== "ACTIVE") {
      return await json({
        ok: true,
        registration_complete: true,
        pending_approval: reconciled.account_status === "PENDING_ADMIN_APPROVAL",
      });
    }

    const signIn = await signInRegisteredUser(
      supabase,
      req,
      phoneDigits,
      password,
      userId,
      identityHash,
      ipHash,
    );

    if (!signIn.ok) {
      return await json({ ok: true, registration_complete: true, requires_login: true });
    }

    return await json({ ok: true, session: signIn.session, user: signIn.user });
  } catch (error) {
    console.error("[REGISTRATION_VERIFY] unexpected error", error instanceof Error ? error.name : "unknown");
    return await json({ error: "خطا در پردازش درخواست" }, 500);
  }
});