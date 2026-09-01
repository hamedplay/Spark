import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
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
  PHONE_OTP_MAX_BODY_BYTES as MAX_BODY_BYTES,
  PHONE_OTP_MAX_RAW_PHONE_LEN as MAX_RAW_PHONE_LEN,
  type PhoneAuthConfig,
  getPhoneAuthConfig,
} from "../_shared/phoneOtpLoginV2.ts";

interface SystemConfig {
  backendReady: boolean;
  canonicalEnabled: boolean;
  ttlSeconds: number;
  resendSeconds: number;
  maxAttempts: number;
  configuredProviderId: string | null;
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

  if (smsError) throw new Error("CONFIG_UNAVAILABLE");
  const configuredProviderId = smsData?.value ?? null;
  if (configuredProviderId !== null && !isValidUuid(configuredProviderId)) throw new Error("CONFIG_UNAVAILABLE");

  return { backendReady, canonicalEnabled, ttlSeconds, resendSeconds, maxAttempts, configuredProviderId };
}

interface ResolvedProvider {
  providerId: string;
  providerName: string;
  errorCode: string | null;
}

async function resolveProvider(
  admin: ReturnType<typeof adminClient>,
  configuredProviderId: string | null,
): Promise<ResolvedProvider> {
  if (configuredProviderId && isValidUuid(configuredProviderId)) {
    const { data, error } = await admin
      .from("sms_providers")
      .select("id, title, is_active")
      .eq("id", configuredProviderId)
      .maybeSingle();
    if (error) return { providerId: "", providerName: "", errorCode: "SMS_PROVIDER_CONFIG_INVALID" };
    if (data && data.is_active === true) {
      return { providerId: data.id, providerName: data.title ?? "", errorCode: null };
    }
  }

  const { data: defaultProviders, error: defaultError } = await admin
    .from("sms_providers")
    .select("id, title")
    .eq("is_active", true)
    .eq("is_default", true)
    .limit(1);
  if (defaultError) return { providerId: "", providerName: "", errorCode: "SMS_PROVIDER_CONFIG_INVALID" };
  if (defaultProviders && defaultProviders.length > 0) {
    return { providerId: defaultProviders[0].id, providerName: defaultProviders[0].title ?? "", errorCode: null };
  }

  const { data: activeProviders, error: activeError } = await admin
    .from("sms_providers")
    .select("id, title")
    .eq("is_active", true);
  if (activeError) return { providerId: "", providerName: "", errorCode: "SMS_PROVIDER_CONFIG_INVALID" };
  if (!activeProviders || activeProviders.length === 0) {
    return { providerId: "", providerName: "", errorCode: "NO_ACTIVE_SMS_PROVIDER" };
  }
  if (activeProviders.length === 1) {
    return { providerId: activeProviders[0].id, providerName: activeProviders[0].title ?? "", errorCode: null };
  }

  return { providerId: "", providerName: "", errorCode: "AMBIGUOUS_SMS_PROVIDER" };
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


interface PhoneSyncDiagnosis {
  status?: string | null;
  orphan_auth_user_id?: string | null;
}

interface PhoneOnlyOrphanRow {
  auth_user_id?: string | null;
  has_profile?: boolean | null;
  has_identity?: boolean | null;
  has_sessions?: boolean | null;
  has_dependent_records?: boolean | null;
  primary_profile_user_id?: string | null;
}

function authUserIsBlocked(user: unknown): boolean {
  const row = user as Record<string, unknown>;
  const deletedAt = typeof row.deleted_at === "string" ? row.deleted_at : "";
  if (deletedAt) return true;

  const bannedUntil = typeof row.banned_until === "string" ? row.banned_until : "";
  if (!bannedUntil) return false;

  const bannedDate = new Date(bannedUntil);
  return Number.isFinite(bannedDate.getTime()) && bannedDate.getTime() > Date.now();
}

/**
 * Repairs only a provably safe profiles → auth.users phone drift.
 *
 * Security invariants:
 * - the resolver has already matched exactly one active, profile-verified phone;
 * - profile phone must still equal the requested canonical phone;
 * - an existing different Auth phone is never overwritten;
 * - a conflicting phone-only Auth user is deleted only when it has no profile,
 *   identity, session, or dependent application records and points back to the
 *   same primary profile;
 * - the canonical Auth phone is written through the GoTrue Admin API and then
 *   re-read before eligibility continues.
 */
async function ensureCanonicalAuthPhone(
  admin: ReturnType<typeof adminClient>,
  userId: string,
  canonicalPhone: string,
): Promise<boolean> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("phone, phone_verified_at, is_active, account_status")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) throw new Error("PROFILE_UNAVAILABLE");
  if (
    !profile ||
    profile.is_active !== true ||
    profile.account_status !== "ACTIVE" ||
    !profile.phone_verified_at
  ) {
    return false;
  }

  const profilePhone = canonicalizeIranPhone(String(profile.phone ?? ""));
  if (profilePhone !== canonicalPhone) return false;

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(userId);
  if (authError) throw new Error("AUTH_UNAVAILABLE");

  const authUser = authData?.user;
  if (!authUser || !authUser.email || authUserIsBlocked(authUser)) return false;

  const currentAuthPhone = authUser.phone
    ? canonicalizeIranPhone(authUser.phone)
    : null;

  if (currentAuthPhone === canonicalPhone && authUser.phone_confirmed_at) {
    return true;
  }

  // Never overwrite a different canonical Auth phone.
  if (currentAuthPhone && currentAuthPhone !== canonicalPhone) {
    return false;
  }

  const { data: diagnosisData, error: diagnosisError } = await admin.rpc(
    "diagnose_phone_auth_sync_status",
    { p_target_user_id: userId },
  );
  if (diagnosisError) throw new Error("AUTH_SYNC_DIAGNOSIS_UNAVAILABLE");

  const diagnosis = (
    Array.isArray(diagnosisData) ? diagnosisData[0] : diagnosisData
  ) as PhoneSyncDiagnosis | null;

  const diagnosisStatus = String(diagnosis?.status ?? "");

  if (diagnosisStatus === "PHONE_ONLY_AUTH_ORPHAN") {
    const orphanUserId = diagnosis?.orphan_auth_user_id;
    if (!orphanUserId || !isValidUuid(orphanUserId)) return false;

    const { data: orphanRows, error: orphanError } = await admin.rpc(
      "diagnose_phone_only_orphans",
    );
    if (orphanError || !Array.isArray(orphanRows)) {
      throw new Error("AUTH_ORPHAN_DIAGNOSIS_UNAVAILABLE");
    }

    const orphan = (orphanRows as PhoneOnlyOrphanRow[]).find(
      (row) =>
        row.auth_user_id === orphanUserId &&
        row.primary_profile_user_id === userId,
    );

    if (
      !orphan ||
      orphan.has_profile === true ||
      orphan.has_identity === true ||
      orphan.has_sessions === true ||
      orphan.has_dependent_records === true
    ) {
      return false;
    }

    const { data: orphanAuthData, error: orphanAuthError } =
      await admin.auth.admin.getUserById(orphanUserId);
    if (orphanAuthError || !orphanAuthData?.user) {
      throw new Error("AUTH_ORPHAN_UNAVAILABLE");
    }

    const orphanAuthUser = orphanAuthData.user;
    const orphanPhone = orphanAuthUser.phone
      ? canonicalizeIranPhone(orphanAuthUser.phone)
      : null;

    if (orphanAuthUser.email || orphanPhone !== canonicalPhone) {
      return false;
    }

    const { error: deleteError } =
      await admin.auth.admin.deleteUser(orphanUserId);

    if (deleteError) {
      throw new Error("AUTH_ORPHAN_DELETE_FAILED");
    }
  } else if (
    diagnosisStatus !== "AUTH_PHONE_MISSING" &&
    diagnosisStatus !== "SYNCED"
  ) {
    return false;
  }

  const authBaseUrl =
    Deno.env.get("SUPABASE_INTERNAL_URL") ??
    Deno.env.get("SUPABASE_URL") ??
    "http://kong:8000";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!serviceRoleKey) throw new Error("AUTH_ADMIN_CONFIG_UNAVAILABLE");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  let syncResponse: Response;
  try {
    syncResponse = await fetch(
      `${authBaseUrl}/auth/v1/admin/users/${userId}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          phone: `+${canonicalPhone}`,
          phone_confirm: true,
        }),
        signal: controller.signal,
      },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!syncResponse.ok) {
    // A conflict or invalid target is an eligibility failure; server failures
    // are operational and must not be disguised as an unknown phone.
    if (syncResponse.status >= 500) {
      throw new Error("AUTH_PHONE_SYNC_UNAVAILABLE");
    }
    return false;
  }

  const { data: verifiedAuthData, error: verifyAuthError } =
    await admin.auth.admin.getUserById(userId);

  if (verifyAuthError) throw new Error("AUTH_UNAVAILABLE");

  const verifiedUser = verifiedAuthData?.user;
  if (!verifiedUser || authUserIsBlocked(verifiedUser)) return false;

  const verifiedPhone = verifiedUser.phone
    ? canonicalizeIranPhone(verifiedUser.phone)
    : null;

  return (
    verifiedPhone === canonicalPhone &&
    Boolean(verifiedUser.phone_confirmed_at)
  );
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

// ── SendSmsResult ────────────────────────────────────────────────────

interface SendSmsResult {
  ok: boolean;
  errorCode: string | null;
  providerId: string | null;
  providerName: string | null;
  providerMessageId: string | null;
  packId: string | null;
  cost: number | null;
}

function normalizeProviderId(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function normalizeCost(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  return null;
}

async function sendSms(
  canonicalPhone: string,
  message: string,
  providerId: string,
  providerName: string,
): Promise<SendSmsResult> {
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

    if (!resp.ok) {
      return { ok: false, errorCode: "SMS_DISPATCH_FAILED", providerId, providerName, providerMessageId: null, packId: null, cost: null };
    }
    const result = await resp.json();
    const ok = result.ok === true || result.success === true;
    const returnIds: unknown[] | undefined = result.returnIds;
    const messageIds: unknown[] | undefined = result.messageIds;
    const providerMessageId =
      (Array.isArray(returnIds) && returnIds.length > 0 && normalizeProviderId(returnIds[0])) ||
      (Array.isArray(messageIds) && messageIds.length > 0 && normalizeProviderId(messageIds[0])) ||
      null;
    const packId = normalizeProviderId(result.packId);
    const cost = normalizeCost(result.cost);
    if (!ok) {
      const ec = typeof result.errorCode === "string" ? result.errorCode : "SMS_PROVIDER_REJECTED";
      return { ok: false, errorCode: ec, providerId, providerName, providerMessageId: null, packId: null, cost: null };
    }
    return { ok: true, errorCode: null, providerId, providerName, providerMessageId, packId, cost };
  } catch {
    clearTimeout(timer);
    return { ok: false, errorCode: "SMS_PROVIDER_TIMEOUT", providerId, providerName, providerMessageId: null, packId: null, cost: null };
  }
}

// ── Masking ──────────────────────────────────────────────────────────

function maskCanonicalIranPhoneForLog(canonicalPhone: string): string {
  if (!/^989\d{9}$/.test(canonicalPhone)) {
    return "***";
  }
  const localPhone = `0${canonicalPhone.slice(2)}`;
  return (
    localPhone.slice(0, 4) +
    "*".repeat(localPhone.length - 7) +
    localPhone.slice(-3)
  );
}

// ── Dispatch Log Lifecycle ────────────────────────────────────────────

const AUTH_OTP_LOG_MESSAGE_PENDING = "درخواست کد یک‌بارمصرف ورود";

async function createOtpDispatchLog(
  admin: ReturnType<typeof adminClient>,
  params: {
    maskedPhone: string;
    targetUserId: string | null;
  },
): Promise<string | null> {
  const { data, error } = await admin
    .from("sms_dispatch_logs")
    .insert({
      target_user_id: params.targetUserId,
      category: "auth",
      event_type: "login_otp",
      audience: "all",
      message: AUTH_OTP_LOG_MESSAGE_PENDING,
      target_phone: params.maskedPhone,
      status: "pending",
      provider_id: null,
      provider_name: null,
      provider_message_id: null,
      pack_id: null,
      cost: null,
      delivery_status: null,
      error_text: null,
    })
    .select("id")
    .single();

  if (error || !data) return null;
  return typeof data.id === "string" ? data.id : null;
}

async function updateOtpDispatchLog(
  admin: ReturnType<typeof adminClient>,
  logId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const { error } = await admin
    .from("sms_dispatch_logs")
    .update(patch)
    .eq("id", logId);

  if (error) {
    console.log("[PHONE_OTP_V2] dispatch log update failed");
    return false;
  }
  return true;
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
  const maskedPhone = maskCanonicalIranPhoneForLog(canonicalPhone);

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

  // ── Create dispatch log BEFORE any provider/user/challenge work ──
  const dispatchLogId = await createOtpDispatchLog(admin, {
    maskedPhone,
    targetUserId: null,
  });
  if (!dispatchLogId) {
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // ── Resolve user ──────────────────────────────────────────────────
  let resolved: ResolvedUser | null;
  try {
    resolved = await resolveUser(admin, canonicalPhone);
  } catch {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      error_text: "RESOLVE_UNAVAILABLE",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!resolved) {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "skipped",
      error_text: "AUTH_TARGET_NOT_ELIGIBLE",
    });
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

  // ── Repair canonical Auth phone drift before eligibility ───────────
  let authPhoneReady: boolean;
  try {
    authPhoneReady = await ensureCanonicalAuthPhone(
      admin,
      resolved.userId,
      canonicalPhone,
    );
  } catch {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      target_user_id: resolved.userId,
      status: "failed",
      error_text: "AUTH_PHONE_SYNC_UNAVAILABLE",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!authPhoneReady) {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      target_user_id: resolved.userId,
      status: "skipped",
      error_text: "AUTH_TARGET_NOT_ELIGIBLE",
    });
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

  // ── Check eligibility ─────────────────────────────────────────────
  let eligibility: EligibilityResult;
  try {
    eligibility = await checkEligibility(admin, resolved.userId);
  } catch {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      target_user_id: resolved.userId,
      status: "failed",
      error_text: "AUTH_UNAVAILABLE",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!eligibility.eligible) {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      target_user_id: resolved.userId,
      status: "skipped",
      error_text: "AUTH_TARGET_NOT_ELIGIBLE",
    });
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

  // ── Update log with target_user_id ───────────────────────────────
  await updateOtpDispatchLog(admin, dispatchLogId, {
    target_user_id: resolved.userId,
  });

  // ── Resolve provider (server-side only) ──────────────────────────
  const provider = await resolveProvider(admin, sysConfig.configuredProviderId);
  if (provider.errorCode) {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      error_text: provider.errorCode,
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  await updateOtpDispatchLog(admin, dispatchLogId, {
    provider_id: provider.providerId,
    provider_name: provider.providerName,
  });

  // ── Template ──────────────────────────────────────────────────────
  let templateBody: string | null;
  try {
    templateBody = await getTemplate(admin);
  } catch {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      error_text: "OTP_TEMPLATE_UNAVAILABLE",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
  if (!templateBody) {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      error_text: "OTP_TEMPLATE_UNAVAILABLE",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // ── Challenge ─────────────────────────────────────────────────────
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
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      error_text: "CHALLENGE_CREATION_FAILED",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  if (!challengeResult.created) {
    if (challengeResult.errorCode === "RESEND_NOT_READY") {
      await updateOtpDispatchLog(admin, dispatchLogId, {
        status: "skipped",
        error_text: "RESEND_NOT_READY",
      });
      if (challengeResult.retryAfterSeconds === null) {
        return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      }
      return jsonResponse(
        { error: "RATE_LIMITED", retry_after_seconds: challengeResult.retryAfterSeconds },
        429,
        allowedOrigin,
      );
    }
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      error_text: "CHALLENGE_CREATION_FAILED",
    });
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // ── Send SMS ──────────────────────────────────────────────────────
  const renderedTemplate = templateBody.replace(/\{\{otp\}\}/g, otp);
  const redactedRenderedTemplate = templateBody.replace(/\{\{otp\}\}/g, "******");

  await updateOtpDispatchLog(admin, dispatchLogId, {
    message: redactedRenderedTemplate,
  });

  const smsResult = await sendSms(canonicalPhone, renderedTemplate, provider.providerId, provider.providerName);

  if (!smsResult.ok) {
    await updateOtpDispatchLog(admin, dispatchLogId, {
      status: "failed",
      delivery_status: null,
      error_text: smsResult.errorCode,
    });
    console.log("[PHONE_OTP_V2] delivery failed");
    await setDeliveryResult(admin, challengeId, false);
    return jsonResponse({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // ── Success: update log ───────────────────────────────────────────
  await updateOtpDispatchLog(admin, dispatchLogId, {
    status: "sent",
    provider_id: smsResult.providerId,
    provider_name: smsResult.providerName,
    provider_message_id: smsResult.providerMessageId,
    pack_id: smsResult.packId,
    cost: smsResult.cost,
    delivery_status: smsResult.providerMessageId ? "pending" : null,
    error_text: null,
  });

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
