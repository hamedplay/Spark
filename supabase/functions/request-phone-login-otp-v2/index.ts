import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  adminClient,
  canonicalizeIranPhone,
  hmacSha256Hex,
  generateSixDigitOtp,
  getClientIp,
  isValidUuid,
  minimumResponseDelay,
  corsHeaders,
  checkOrigin,
  jsonResponse,
} from "../_shared/phoneOtpLoginV2.ts";

const MAX_BODY_BYTES = 2048;
const MAX_RAW_PHONE_LEN = 32;

interface PhoneAuthConfig {
  origins: string[];
  pepper: string;
}

async function getPhoneAuthConfig(): Promise<PhoneAuthConfig> {
  const admin = adminClient();
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) throw new Error("CONFIG_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("CONFIG_UNAVAILABLE");
  const allowedOrigins: string[] = Array.isArray(row?.allowed_origins) ? row.allowed_origins : [];
  const pepper: string = typeof row?.pepper === "string" ? row.pepper : "";
  return { origins: allowedOrigins, pepper };
}

interface SystemConfig {
  backendReady: boolean;
  canonicalEnabled: boolean;
  ttlSeconds: number;
  resendSeconds: number;
  maxAttempts: number;
  providerId: string;
}

const SECURITY_CONFIG_KEYS = [
  "phone_otp_login_backend_ready",
  "phone_login_canonical_enabled",
  "phone_otp_login_ttl_seconds",
  "phone_otp_login_resend_seconds",
  "phone_otp_login_max_attempts",
] as const;

async function getSystemConfig(): Promise<SystemConfig> {
  const admin = adminClient();

  const { data: secData, error: secError } = await admin
    .from("system_config")
    .select("key, value")
    .eq("section", "security")
    .in("key", [...SECURITY_CONFIG_KEYS]);

  if (secError || !secData) throw new Error("CONFIG_UNAVAILABLE");
  if (secData.length !== SECURITY_CONFIG_KEYS.length) throw new Error("CONFIG_UNAVAILABLE");

  const secMap: Record<string, string> = {};
  for (const row of secData) {
    secMap[row.key] = row.value;
  }
  for (const key of SECURITY_CONFIG_KEYS) {
    if (!(key in secMap)) throw new Error("CONFIG_UNAVAILABLE");
  }

  const backendReady = secMap["phone_otp_login_backend_ready"] === "true";
  const canonicalEnabled = secMap["phone_login_canonical_enabled"] === "true";
  const ttlSeconds = parseInt(secMap["phone_otp_login_ttl_seconds"] ?? "", 10);
  const resendSeconds = parseInt(secMap["phone_otp_login_resend_seconds"] ?? "", 10);
  const maxAttempts = parseInt(secMap["phone_otp_login_max_attempts"] ?? "", 10);

  if (!backendReady || !canonicalEnabled) throw new Error("BACKEND_NOT_READY");
  if (isNaN(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 300) throw new Error("CONFIG_UNAVAILABLE");
  if (isNaN(resendSeconds) || resendSeconds < 30 || resendSeconds > 300) throw new Error("CONFIG_UNAVAILABLE");
  if (resendSeconds > ttlSeconds) throw new Error("CONFIG_UNAVAILABLE");
  if (isNaN(maxAttempts) || maxAttempts < 3 || maxAttempts > 10) throw new Error("CONFIG_UNAVAILABLE");

  const { data: smsData, error: smsError } = await admin
    .from("system_config")
    .select("key, value")
    .eq("section", "sms")
    .eq("key", "phone_login_sms_provider_id")
    .maybeSingle();

  if (smsError || !smsData) throw new Error("CONFIG_UNAVAILABLE");
  const providerId = smsData.value ?? "";
  if (!isValidUuid(providerId)) throw new Error("CONFIG_UNAVAILABLE");

  return { backendReady, canonicalEnabled, ttlSeconds, resendSeconds, maxAttempts, providerId };
}

async function validateProvider(admin: ReturnType<typeof adminClient>, providerId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("sms_providers")
    .select("id, is_active")
    .eq("id", providerId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return false;
  return true;
}

async function getTemplate(admin: ReturnType<typeof adminClient>): Promise<string | null> {
  const { data, error } = await admin
    .from("sms_templates")
    .select("body")
    .eq("category", "auth")
    .eq("event_type", "login_otp")
    .eq("audience", "all")
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  const body: string = data.body ?? "";
  const matches = body.match(/\{\{otp\}\}/g) ?? [];
  if (matches.length !== 1) return null;
  return body;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

async function consumeRateLimit(
  admin: ReturnType<typeof adminClient>,
  phoneHash: string,
  ipHash: string,
  phoneLimit: number,
  ipLimit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const { data, error } = await admin.rpc("consume_phone_otp_login_rate_limit_v2", {
    p_purpose: "phone_otp_login_request",
    p_phone_hash: phoneHash,
    p_ip_hash: ipHash,
    p_phone_limit: phoneLimit,
    p_ip_limit: ipLimit,
    p_window_seconds: windowSeconds,
  });

  if (error) throw new Error("RATE_LIMIT_UNAVAILABLE");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("RATE_LIMIT_UNAVAILABLE");

  const allowed = row.allowed === true;
  const retryAfter = typeof row.retry_after_seconds === "number" ? Math.max(1, row.retry_after_seconds) : 1;
  return { allowed, retryAfterSeconds: retryAfter };
}

interface ResolvedUser {
  userId: string;
}

async function resolveUser(admin: ReturnType<typeof adminClient>, canonicalPhone: string): Promise<ResolvedUser | null> {
  const { data, error } = await admin.rpc("resolve_phone_password_login_v1", {
    p_normalized_phone: canonicalPhone,
  });

  if (error) throw new Error("RESOLVE_UNAVAILABLE");

  const row = Array.isArray(data) ? data[0] : data;
  const userId = row?.user_id;
  if (typeof userId !== "string" || !isValidUuid(userId)) return null;
  return { userId };
}

interface EligibilityResult {
  eligible: boolean;
}

async function checkEligibility(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<EligibilityResult> {
  const { data: authData, error: authErr } = await admin.auth.admin.getUserById(userId);
  if (authErr) throw new Error("AUTH_UNAVAILABLE");
  if (!authData?.user || !authData.user.email) return { eligible: false };

  const user = authData.user;
  const phoneConfirmedAt = user.phone_confirmed_at;
  if (!phoneConfirmedAt) return { eligible: false };

  const deletedAt = (user as unknown as Record<string, unknown>).deleted_at as string | undefined;
  if (deletedAt) return { eligible: false };

  const bannedUntil = (user as unknown as Record<string, unknown>).banned_until as string | undefined;
  if (bannedUntil) {
    const bannedDate = new Date(bannedUntil);
    if (bannedDate.getTime() > Date.now()) return { eligible: false };
  }

  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("account_status, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileErr) throw new Error("PROFILE_UNAVAILABLE");
  if (!profile) return { eligible: false };
  if (profile.account_status !== "ACTIVE") return { eligible: false };
  if (profile.is_active !== true) return { eligible: false };

  return { eligible: true };
}

interface ChallengeCreationResult {
  created: boolean;
  idempotent: boolean;
  challengeId: string | null;
  errorCode: string | null;
  retryAfterSeconds: number | null;
}

async function createChallenge(
  admin: ReturnType<typeof adminClient>,
  params: {
    challengeId: string;
    userId: string;
    phoneHash: string;
    otpHash: string;
    ipHash: string;
    expiresAt: string;
    resendAvailableAt: string;
    requestId: string;
    maxAttempts: number;
  },
): Promise<ChallengeCreationResult> {
  const { data, error } = await admin.rpc("create_phone_otp_login_challenge_v2", {
    p_challenge_id: params.challengeId,
    p_user_id: params.userId,
    p_phone_hash: params.phoneHash,
    p_otp_hash: params.otpHash,
    p_ip_hash: params.ipHash,
    p_expires_at: params.expiresAt,
    p_resend_available_at: params.resendAvailableAt,
    p_request_id: params.requestId,
    p_max_attempts: params.maxAttempts,
  });

  if (error) throw new Error("CHALLENGE_UNAVAILABLE");

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("CHALLENGE_UNAVAILABLE");

  const retryAfter = typeof row.retry_after_seconds === "number" ? Math.max(1, row.retry_after_seconds) : null;

  if (row.created === true && row.idempotent === false && row.error_code === null) {
    const rpcChallengeId = typeof row.challenge_id === "string" ? row.challenge_id : null;
    if (rpcChallengeId !== params.challengeId) throw new Error("CHALLENGE_ID_MISMATCH");
    return { created: true, idempotent: false, challengeId: rpcChallengeId, errorCode: null, retryAfterSeconds: null };
  }

  if (row.error_code === "RESEND_NOT_READY") {
    return { created: false, idempotent: false, challengeId: null, errorCode: "RESEND_NOT_READY", retryAfterSeconds: retryAfter };
  }

  return { created: false, idempotent: false, challengeId: null, errorCode: row.error_code ?? "UNKNOWN", retryAfterSeconds: retryAfter };
}

async function setDeliveryResult(
  admin: ReturnType<typeof adminClient>,
  challengeId: string,
  sent: boolean,
): Promise<boolean> {
  const { data, error } = await admin.rpc("set_phone_otp_login_delivery_v2", {
    p_challenge_id: challengeId,
    p_sent: sent,
  });

  if (error) return false;
  const row = Array.isArray(data) ? data[0] : data;
  return row === true;
}

async function sendSms(
  canonicalPhone: string,
  message: string,
  providerId: string,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const resp = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({
        mode: "auth_otp",
        providerId,
        mobiles: [`+${canonicalPhone}`],
        message,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) return false;
    const result = await resp.json();
    return result.ok === true || result.success === true;
  } catch {
    clearTimeout(timer);
    return false;
  }
}

async function writeAudit(
  admin: ReturnType<typeof adminClient>,
  requestId: string,
): Promise<void> {
  try {
    await admin.from("audit_log").insert({
      module: "auth",
      action: "phone_otp_login_requested",
      entity_name: "auth",
      entity_id: requestId,
      details: JSON.stringify({ login_method: "phone_otp" }),
      severity: "info",
    });
  } catch {
    // audit failure should not block response
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  let allowedOrigin: string | null = null;
  let config: PhoneAuthConfig;

  try {
    config = await getPhoneAuthConfig();
    const origin = req.headers.get("Origin");
    allowedOrigin = checkOrigin(origin, config.origins);
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, null);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(allowedOrigin) });
  }

  if (!allowedOrigin) {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400, null);
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, allowedOrigin);
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return jsonResponse({ error: "INVALID_CONTENT_TYPE" }, 400, allowedOrigin);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return jsonResponse({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  const bodyBytes = new TextEncoder().encode(rawBody).byteLength;
  if (bodyBytes > MAX_BODY_BYTES) {
    return jsonResponse({ error: "BODY_TOO_LARGE" }, 400, allowedOrigin);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return jsonResponse({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  const body = parsed as Record<string, unknown>;
  const bodyKeys = Object.keys(body);
  if (bodyKeys.length !== 1 || bodyKeys[0] !== "phone") {
    return jsonResponse({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  const phoneRaw = body.phone;
  if (typeof phoneRaw !== "string") {
    return jsonResponse({ error: "INVALID_PHONE" }, 400, allowedOrigin);
  }

  if (phoneRaw.length === 0 || phoneRaw.length > MAX_RAW_PHONE_LEN) {
    return jsonResponse({ error: "INVALID_PHONE" }, 400, allowedOrigin);
  }

  const canonicalPhone = canonicalizeIranPhone(phoneRaw);
  if (!canonicalPhone) {
    return jsonResponse({ error: "INVALID_PHONE" }, 400, allowedOrigin);
  }

  if (config.pepper.length < 32) {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  let sysConfig: SystemConfig;
  try {
    sysConfig = await getSystemConfig();
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  const admin = adminClient();

  let providerActive: boolean;
  try {
    providerActive = await validateProvider(admin, sysConfig.providerId);
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
  if (!providerActive) {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  let templateBody: string | null;
  try {
    templateBody = await getTemplate(admin);
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
  if (!templateBody) {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  const clientIp = getClientIp(req);

  const phoneHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|phone|${canonicalPhone}`);
  const ipHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|ip|${clientIp}`);

  const rateShortPhoneHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|rate-short|phone|${canonicalPhone}`);
  const rateShortIpHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|rate-short|ip|${clientIp}`);
  const rateLongPhoneHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|rate-long|phone|${canonicalPhone}`);
  const rateLongIpHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|rate-long|ip|${clientIp}`);

  // Long-term rate limit first
  let longRateLimit: RateLimitResult;
  try {
    longRateLimit = await consumeRateLimit(
      admin,
      rateLongPhoneHash,
      rateLongIpHash,
      3,
      30,
      900,
    );
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
  if (!longRateLimit.allowed) {
    return jsonResponse(
      { error: "RATE_LIMITED", retry_after_seconds: longRateLimit.retryAfterSeconds },
      429,
      allowedOrigin,
    );
  }

  // Short-term rate limit
  let shortRateLimit: RateLimitResult;
  try {
    shortRateLimit = await consumeRateLimit(
      admin,
      rateShortPhoneHash,
      rateShortIpHash,
      1,
      10,
      sysConfig.resendSeconds,
    );
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
  if (!shortRateLimit.allowed) {
    return jsonResponse(
      { error: "RATE_LIMITED", retry_after_seconds: shortRateLimit.retryAfterSeconds },
      429,
      allowedOrigin,
    );
  }

  // Resolve user
  let resolved: ResolvedUser | null;
  try {
    resolved = await resolveUser(admin, canonicalPhone);
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!resolved) {
    // Decoy path — no challenge, no SMS, same response shape
    await minimumResponseDelay(startedAt);
    return jsonResponse(
      {
        ok: true,
        challenge_id: crypto.randomUUID(),
        retry_after_seconds: sysConfig.resendSeconds,
        expires_in_seconds: sysConfig.ttlSeconds,
      },
      200,
      allowedOrigin,
    );
  }

  // Check eligibility
  let eligibility: EligibilityResult;
  try {
    eligibility = await checkEligibility(admin, resolved.userId);
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!eligibility.eligible) {
    // Decoy path
    await minimumResponseDelay(startedAt);
    return jsonResponse(
      {
        ok: true,
        challenge_id: crypto.randomUUID(),
        retry_after_seconds: sysConfig.resendSeconds,
        expires_in_seconds: sysConfig.ttlSeconds,
      },
      200,
      allowedOrigin,
    );
  }

  // Create challenge
  const challengeId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const otp = generateSixDigitOtp();
  const now = Date.now();
  const expiresAt = new Date(now + sysConfig.ttlSeconds * 1000).toISOString();
  const resendAvailableAt = new Date(now + sysConfig.resendSeconds * 1000).toISOString();

  const otpHash = await hmacSha256Hex(config.pepper, `phone-otp-login-v2|otp|${challengeId}|${phoneHash}|${otp}`);

  let challengeResult: ChallengeCreationResult;
  try {
    challengeResult = await createChallenge(admin, {
      challengeId,
      userId: resolved.userId,
      phoneHash,
      otpHash,
      ipHash,
      expiresAt,
      resendAvailableAt,
      requestId,
      maxAttempts: sysConfig.maxAttempts,
    });
  } catch {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!challengeResult.created) {
    if (challengeResult.errorCode === "RESEND_NOT_READY") {
      if (challengeResult.retryAfterSeconds === null) {
        return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      }
      return jsonResponse(
        { error: "RATE_LIMITED", retry_after_seconds: challengeResult.retryAfterSeconds },
        429,
        allowedOrigin,
      );
    }
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // Send SMS
  const renderedTemplate = templateBody.replace(/\{\{otp\}\}/g, otp);
  const smsSuccess = await sendSms(canonicalPhone, renderedTemplate, sysConfig.providerId);

  if (!smsSuccess) {
    console.log("[PHONE_OTP_V2] delivery failed");
    await setDeliveryResult(admin, challengeId, false);
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // Record delivery result
  const deliveryRecorded = await setDeliveryResult(admin, challengeId, true);
  if (!deliveryRecorded) {
    console.log("[PHONE_OTP_V2] delivery state unavailable");
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // Audit (best effort)
  await writeAudit(admin, requestId);

  await minimumResponseDelay(startedAt);

  return jsonResponse(
    {
      ok: true,
      challenge_id: challengeId,
      retry_after_seconds: sysConfig.resendSeconds,
      expires_in_seconds: sysConfig.ttlSeconds,
    },
    200,
    allowedOrigin,
  );
});
