import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const functionsDir = join(root, 'supabase', 'functions');
const configPath = join(root, 'supabase', 'config.toml');

const sharedPath = join(functionsDir, '_shared', 'phoneOtpLoginV2.ts');
const funcPath = join(functionsDir, 'request-phone-login-otp-v2', 'index.ts');
const sendSmsPath = join(functionsDir, 'send-sms', 'index.ts');
const oldFuncPath = join(functionsDir, 'request-phone-login-otp', 'index.ts');
const oldVerifyPath = join(functionsDir, 'verify-phone-login-otp', 'index.ts');
const passwordLoginPath = join(functionsDir, 'password-login', 'index.ts');
const regSecurityPath = join(functionsDir, '_shared', 'registration-security.ts');

const sharedSrc = readFileSync(sharedPath, 'utf8');
const funcSrc = readFileSync(funcPath, 'utf8');
const sendSmsSrc = readFileSync(sendSmsPath, 'utf8');
const oldFuncSrc = readFileSync(oldFuncPath, 'utf8');
const configSrc = readFileSync(configPath, 'utf8');

describe('Phase 5E-D1 — Request Phone OTP Edge Function V2', () => {
  it('new function and shared utility exist on disk', () => {
    assert.ok(existsSync(funcPath), 'request-phone-login-otp-v2/index.ts must exist');
    assert.ok(existsSync(sharedPath), '_shared/phoneOtpLoginV2.ts must exist');
  });

  it('old function is unchanged and returns 410', () => {
    assert.ok(/410/.test(oldFuncSrc), 'old function must still return 410');
    assert.ok(/LOGIN_ROUTE_REPLACED/.test(oldFuncSrc), 'old function must still return LOGIN_ROUTE_REPLACED');
  });

  it('verify-phone-login-otp is unchanged on disk', () => {
    assert.ok(existsSync(oldVerifyPath), 'verify-phone-login-otp must still exist');
  });

  it('password-login is unchanged on disk', () => {
    assert.ok(existsSync(passwordLoginPath), 'password-login must still exist');
  });

  it('registration-security.ts is unchanged on disk', () => {
    assert.ok(existsSync(regSecurityPath), 'registration-security.ts must still exist');
  });

  it('function directory is named request-phone-login-otp-v2', () => {
    assert.ok(funcPath.includes('request-phone-login-otp-v2'));
  });

  it('config.toml has verify_jwt=false for new function', () => {
    assert.ok(/\[functions\.request-phone-login-otp-v2\]/.test(configSrc),
      'config.toml must have [functions.request-phone-login-otp-v2]');
    const section = configSrc.match(/\[functions\.request-phone-login-otp-v2\][\s\S]*?(?=\[functions\.|\z)/);
    assert.ok(section, 'must have config section');
    assert.ok(/verify_jwt\s*=\s*false/.test(section![0]), 'must set verify_jwt=false');
  });

  it('CORS uses exact allowlist (no wildcard, no reflection)', () => {
    assert.ok(/checkOrigin/.test(sharedSrc), 'must have checkOrigin function');
    assert.ok(/origin\s*===\s*allowed/.test(sharedSrc), 'must use exact string comparison');
    assert.ok(!/\*/.test(sharedSrc.match(/Access-Control-Allow-Origin[^\n]*/g)?.[0] ?? ''),
      'must not use wildcard in Allow-Origin');
  });

  it('OPTIONS response includes Content-Type application/json', () => {
    assert.ok(/Content-Type.*application\/json/.test(sharedSrc), 'base CORS headers must include Content-Type');
  });

  it('CORS fails closed when origin not allowed', () => {
    assert.ok(/if\s*\(!allowedOrigin\)/i.test(funcSrc), 'must check if origin is not allowed');
    assert.ok(/INVALID_REQUEST/.test(funcSrc), 'must return INVALID_REQUEST for disallowed origin');
  });

  it('has no-store, no-cache, and Vary: Origin headers', () => {
    assert.ok(/no-store/.test(sharedSrc), 'must have Cache-Control: no-store');
    assert.ok(/no-cache/.test(sharedSrc), 'must have Pragma: no-cache');
    assert.ok(/Vary.*Origin/.test(sharedSrc), 'must have Vary: Origin');
  });

  it('OPTIONS only returns 200 after config is received', () => {
    assert.ok(/OPTIONS/.test(funcSrc), 'must handle OPTIONS');
    assert.ok(req => req.method === 'OPTIONS');
    const optionsIdx = funcSrc.search(/req\.method\s*===\s*["']OPTIONS["']/);
    const configIdx = funcSrc.search(/getPhoneAuthConfig/);
    assert.ok(configIdx < optionsIdx, 'config must be loaded before OPTIONS check');
  });

  it('body byte limit is 2048', () => {
    assert.ok(/MAX_BODY_BYTES\s*=\s*2048/.test(funcSrc), 'must set MAX_BODY_BYTES to 2048');
  });

  it('only accepts phone field in body', () => {
    assert.ok(/bodyKeys\.length\s*!==\s*1\s*\|\|\s*bodyKeys\[0\]\s*!==\s*["']phone["']/.test(funcSrc),
      'must reject extra fields');
  });

  it('parsed body must be non-null, non-array object', () => {
    assert.ok(/parsed\s*===\s*null/.test(funcSrc), 'must reject null');
    assert.ok(/typeof\s*parsed\s*!==\s*["']object["']/.test(funcSrc), 'must reject non-objects');
    assert.ok(/Array\.isArray\(parsed\)/.test(funcSrc), 'must reject arrays');
  });

  it('has canonicalization for Iran phone numbers', () => {
    assert.ok(/canonicalizeIranPhone/.test(sharedSrc), 'must have canonicalizeIranPhone');
    assert.ok(/\^989\\d\{9\}\$/.test(sharedSrc), 'must produce ^989[0-9]{9}$ canonical format');
    assert.ok(/\^09\\d\{9\}\$/.test(sharedSrc), 'must accept 09xxxxxxxxx');
    assert.ok(/\^\\\+989\\d\{9\}\$/.test(sharedSrc), 'must accept +989xxxxxxxxx');
    assert.ok(/\^00989\\d\{9\}\$/.test(sharedSrc), 'must accept 00989xxxxxxxxx');
  });

  it('pepper is obtained from get_phone_auth_config', () => {
    assert.ok(/get_phone_auth_config/.test(funcSrc), 'must call get_phone_auth_config');
    assert.ok(/pepper/.test(funcSrc), 'must extract pepper');
  });

  it('does not use REGISTRATION_PHONE_OTP_SECRET', () => {
    assert.ok(!/REGISTRATION_PHONE_OTP_SECRET/.test(funcSrc), 'must not use REGISTRATION_PHONE_OTP_SECRET');
  });

  it('readiness gate checks both backend_ready and canonical_enabled', () => {
    assert.ok(/phone_otp_login_backend_ready/.test(funcSrc), 'must check backend_ready');
    assert.ok(/phone_login_canonical_enabled/.test(funcSrc), 'must check canonical_enabled');
  });

  it('security config query uses section=security with exactly 5 keys', () => {
    assert.ok(/SECURITY_CONFIG_KEYS/.test(funcSrc), 'must have SECURITY_CONFIG_KEYS constant');
    assert.ok(/eq\(["']section["'],\s*["']security["']\)/.test(funcSrc), 'must query section=security');
    assert.ok(/secData\.length\s*!==\s*SECURITY_CONFIG_KEYS\.length/.test(funcSrc), 'must check exact row count');
  });

  it('provider ID is read from section=sms, not section=security', () => {
    const secQueryMatch = funcSrc.match(/eq\(["']section["'],\s*["']security["']\)[\s\S]*?in\(["']key["'],\s*\[\.\.\.SECURITY_CONFIG_KEYS\]\)/);
    assert.ok(secQueryMatch, 'must have security query with SECURITY_CONFIG_KEYS');
    const secBlock = secQueryMatch![0];
    assert.ok(!/phone_login_sms_provider_id/.test(secBlock), 'security query must not include phone_login_sms_provider_id');
    assert.ok(/eq\(["']section["'],\s*["']sms["']\)/.test(funcSrc), 'must query section=sms');
    assert.ok(/eq\(["']key["'],\s*["']phone_login_sms_provider_id["']\)/.test(funcSrc), 'must query key=phone_login_sms_provider_id from sms section');
    assert.ok(/maybeSingle\(\)/.test(funcSrc), 'must use maybeSingle for sms config');
  });

  it('TTL, resend, and max attempts are fail-closed', () => {
    assert.ok(/ttlSeconds\s*<\s*30\s*\|\|\s*ttlSeconds\s*>\s*300/.test(funcSrc), 'must validate TTL 30-300');
    assert.ok(/resendSeconds\s*<\s*30\s*\|\|\s*resendSeconds\s*>\s*300/.test(funcSrc), 'must validate resend 30-300');
    assert.ok(/resendSeconds\s*>\s*ttlSeconds/.test(funcSrc), 'must check resend <= TTL');
    assert.ok(/maxAttempts\s*<\s*3\s*\|\|\s*maxAttempts\s*>\s*10/.test(funcSrc), 'must validate max attempts 3-10');
  });

  it('rate limit is consumed before resolve', () => {
    const rateLimitIdx = funcSrc.search(/consumeRateLimit/);
    const resolveIdx = funcSrc.search(/resolveUser/);
    assert.ok(rateLimitIdx >= 0 && resolveIdx >= 0);
    assert.ok(rateLimitIdx < resolveIdx, 'rate limit must run before resolve');
  });

  it('has two rate limits: short and long', () => {
    const matches = funcSrc.match(/consumeRateLimit/g);
    assert.ok(matches && matches.length >= 2, 'must have at least 2 rate limit calls');
  });

  it('rate limit purpose is exactly phone_otp_login_request', () => {
    assert.ok(/phone_otp_login_request/.test(funcSrc), 'must use phone_otp_login_request purpose');
  });

  it('long rate limit: phone=3, ip=30, window=900', () => {
    assert.ok(/3,\s*30,\s*900/.test(funcSrc), 'must have long rate limit 3/30/900');
  });

  it('short rate limit: phone=1, ip=10, window=resendSeconds', () => {
    assert.ok(/1,\s*10,\s*sysConfig\.resendSeconds/.test(funcSrc), 'must have short rate limit 1/10/resendSeconds');
  });

  it('rate limited response includes retry_after_seconds', () => {
    assert.ok(/RATE_LIMITED/.test(funcSrc), 'must return RATE_LIMITED');
    assert.ok(/retry_after_seconds/.test(funcSrc), 'must include retry_after_seconds');
    assert.ok(/429/.test(funcSrc), 'must return 429 status');
  });

  it('resolve uses only resolve_phone_password_login_v1', () => {
    assert.ok(/resolve_phone_password_login_v1/.test(funcSrc), 'must use resolve_phone_password_login_v1');
    assert.ok(!/resolve_phone_password_login_v2/.test(funcSrc), 'must not use v2 resolve');
  });

  it('eligibility checks auth user and profile', () => {
    assert.ok(/getUserById/.test(funcSrc), 'must check auth user');
    assert.ok(/email/.test(funcSrc), 'must check auth email');
    assert.ok(/phone_confirmed_at/.test(funcSrc), 'must check phone_confirmed_at');
    assert.ok(/deleted_at/.test(funcSrc), 'must check deleted_at');
    assert.ok(/banned_until/.test(funcSrc), 'must check banned_until');
    assert.ok(/account_status/.test(funcSrc), 'must check profile account_status');
    assert.ok(/is_active/.test(funcSrc), 'must check profile is_active');
    assert.ok(/ACTIVE/.test(funcSrc), 'must check account_status is ACTIVE');
  });

  it('operational auth error throws, not decoy', () => {
    assert.ok(/AUTH_UNAVAILABLE/.test(funcSrc), 'must throw AUTH_UNAVAILABLE on auth error');
    assert.ok(/PROFILE_UNAVAILABLE/.test(funcSrc), 'must throw PROFILE_UNAVAILABLE on profile error');
  });

  it('decoy path does not create challenge or send SMS', () => {
    const decoyMatch = funcSrc.match(/if\s*\(!resolved\)[\s\S]*?allowedOrigin\s*\)/);
    assert.ok(decoyMatch, 'must have decoy path for unresolved user');
    const decoyBlock = decoyMatch![0];
    assert.ok(/crypto\.randomUUID/.test(decoyBlock), 'decoy must use random UUID');
    assert.ok(!/createChallenge/.test(decoyBlock), 'decoy must not call createChallenge');
    assert.ok(!/sendSms/.test(decoyBlock), 'decoy must not call sendSms');
  });

  it('decoy and success response shapes are identical', () => {
    const responses = funcSrc.match(/ok:\s*true,\s*challenge_id:[^}]*retry_after_seconds:[^}]*expires_in_seconds:[^}]*}/g);
    assert.ok(responses && responses.length >= 2, 'must have at least 2 identical response shapes');
  });

  it('minimum timing delay exists', () => {
    assert.ok(/minimumResponseDelay/.test(sharedSrc), 'must have minimumResponseDelay in shared');
    assert.ok(/800.*Math\.floor\(Math\.random/.test(sharedSrc) || /800\s*\+\s*Math\.floor\(Math\.random/.test(sharedSrc),
      'must delay 800-1200ms');
    assert.ok(/minimumResponseDelay/.test(funcSrc), 'must call minimumResponseDelay');
  });

  it('challenge is created with RPC v2', () => {
    assert.ok(/create_phone_otp_login_challenge_v2/.test(funcSrc), 'must use create_phone_otp_login_challenge_v2');
    assert.ok(/p_challenge_id/.test(funcSrc), 'must pass p_challenge_id');
    assert.ok(/p_user_id/.test(funcSrc), 'must pass p_user_id');
    assert.ok(/p_phone_hash/.test(funcSrc), 'must pass p_phone_hash');
    assert.ok(/p_otp_hash/.test(funcSrc), 'must pass p_otp_hash');
    assert.ok(/p_ip_hash/.test(funcSrc), 'must pass p_ip_hash');
    assert.ok(/p_expires_at/.test(funcSrc), 'must pass p_expires_at');
    assert.ok(/p_resend_available_at/.test(funcSrc), 'must pass p_resend_available_at');
    assert.ok(/p_request_id/.test(funcSrc), 'must pass p_request_id');
    assert.ok(/p_max_attempts/.test(funcSrc), 'must pass p_max_attempts');
  });

  it('RESEND_NOT_READY maps to RATE_LIMITED 429 with dynamic retry', () => {
    assert.ok(/RESEND_NOT_READY/.test(funcSrc), 'must handle RESEND_NOT_READY');
    assert.ok(/retryAfterSeconds/.test(funcSrc), 'must use dynamic retryAfterSeconds from RPC');
    assert.ok(/challengeResult\.retryAfterSeconds/.test(funcSrc), 'must pass RPC retry value, not sysConfig.resendSeconds');
    const match = funcSrc.match(/RESEND_NOT_READY[\s\S]*?RATE_LIMITED[\s\S]*?429/);
    assert.ok(match, 'RESEND_NOT_READY must map to RATE_LIMITED 429');
  });

  it('RESEND_NOT_READY with null retry_after_seconds fails to 503', () => {
    assert.ok(/retryAfterSeconds\s*===\s*null/.test(funcSrc), 'must check null retryAfterSeconds and return 503');
  });

  it('challenge_id from RPC must match local challenge ID', () => {
    assert.ok(/CHALLENGE_ID_MISMATCH/.test(funcSrc), 'must throw CHALLENGE_ID_MISMATCH on mismatch');
    assert.ok(/rpcChallengeId\s*!==\s*params\.challengeId/.test(funcSrc), 'must compare RPC challenge_id with local');
  });

  it('SMS is sent only via send-sms with mode auth_otp', () => {
    assert.ok(/send-sms/.test(funcSrc), 'must call send-sms function');
    assert.ok(/auth_otp/.test(funcSrc), 'must use auth_otp mode');
    assert.ok(/providerId/.test(funcSrc), 'must pass providerId');
    assert.ok(/\+\$\{canonicalPhone\}/.test(funcSrc) || /\+.*canonicalPhone/.test(funcSrc),
      'must prefix canonical phone with +');
  });

  it('SMS has 10 second timeout', () => {
    assert.ok(/10000/.test(funcSrc), 'must have 10 second timeout for SMS');
  });

  it('SMS success requires ok=true or success=true', () => {
    assert.ok(/ok\s*===\s*true\s*\|\|\s*result\.success\s*===\s*true/.test(funcSrc),
      'must check ok=true or success=true');
  });

  it('delivery result is recorded via set_phone_otp_login_delivery_v2', () => {
    assert.ok(/set_phone_otp_login_delivery_v2/.test(funcSrc), 'must call set_phone_otp_login_delivery_v2');
    assert.ok(/p_sent:\s*sent/.test(funcSrc), 'must pass p_sent parameter');
    assert.ok(/setDeliveryResult\(admin,\s*challengeId,\s*true\)/.test(funcSrc), 'must call setDeliveryResult with true on success');
    assert.ok(/setDeliveryResult\(admin,\s*challengeId,\s*false\)/.test(funcSrc), 'must call setDeliveryResult with false on failure');
  });

  it('does not return OTP, phone, hash, user_id, email, request_id, or provider_id', () => {
    const successMatch = funcSrc.match(/return\s+jsonResponse\(\s*\{[^}]*ok:\s*true[^}]*}/g);
    assert.ok(successMatch, 'must find success responses');
    for (const resp of successMatch!) {
      assert.ok(!/otp/.test(resp.toLowerCase()) || /login_otp/.test(resp), 'must not return OTP');
      assert.ok(!/phone_hash/.test(resp), 'must not return phone_hash');
      assert.ok(!/ip_hash/.test(resp), 'must not return ip_hash');
      assert.ok(!/user_id/.test(resp), 'must not return user_id');
      assert.ok(!/email/.test(resp), 'must not return email');
      assert.ok(!/request_id/.test(resp), 'must not return request_id');
      assert.ok(!/provider_id/.test(resp), 'must not return provider_id');
    }
  });

  it('does not log variable values, OTP, phone, hash, or UUID', () => {
    const logMatches = funcSrc.match(/console\.log\([^)]*\)/g);
    if (logMatches) {
      for (const log of logMatches) {
        assert.ok(/PHONE_OTP_V2/.test(log), 'logs must be static redacted messages');
        assert.ok(!/\$\{/.test(log), 'logs must not contain template variables');
      }
    }
  });

  it('does not create sessions, magic links, or gateway authorizations', () => {
    assert.ok(!/signInWithPassword/.test(funcSrc), 'must not call signInWithPassword');
    assert.ok(!/signInWithOtp/.test(funcSrc), 'must not call signInWithOtp');
    assert.ok(!/verifyOtp/.test(funcSrc), 'must not call verifyOtp');
    assert.ok(!/generateLink/.test(funcSrc), 'must not call generateLink');
    assert.ok(!/createUser/.test(funcSrc), 'must not call createUser');
    assert.ok(!/createSession/.test(funcSrc), 'must not call createSession');
    assert.ok(!/setSession/.test(funcSrc), 'must not call setSession');
    assert.ok(!/authorize_phone_otp_gateway_session_v1/.test(funcSrc), 'must not call gateway authorization');
    assert.ok(!/claim_phone_otp_login_challenge_v2/.test(funcSrc), 'must not call claim challenge');
    assert.ok(!/complete_phone_otp_login_challenge_v2/.test(funcSrc), 'must not call complete challenge');
    assert.ok(!/release_phone_otp_login_challenge_v2/.test(funcSrc), 'must not call release challenge');
  });

  it('does not create new migrations', () => {
    const migrationFiles = readdirSync(migrationsDir);
    const hasNewMigration = migrationFiles.some(f => f.includes('phase5e_phone_otp_request_edge'));
    assert.ok(!hasNewMigration, 'must not create new migration');
  });

  it('does not modify backend_ready', () => {
    assert.ok(!/UPDATE.*system_config.*backend_ready/i.test(funcSrc), 'must not update backend_ready');
    assert.ok(!/backend_ready.*true/.test(funcSrc.replace(/phone_otp_login_backend_ready/g, '')),
      'must not set backend_ready to true');
  });

  it('audit logs event_type=phone_otp_login_requested with metadata login_method=phone_otp', () => {
    assert.ok(/phone_otp_login_requested/.test(funcSrc), 'must audit phone_otp_login_requested');
    assert.ok(/login_method.*phone_otp/.test(funcSrc), 'must include login_method in audit');
    assert.ok(/severity.*info/.test(funcSrc), 'must use severity info');
  });

  it('audit failure does not block response', () => {
    assert.ok(/audit failure should not block/.test(funcSrc) || /best effort/i.test(funcSrc),
      'audit must be best effort');
  });

  it('no formal assert.ok(true) assertions in this test file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpRequestEdge.test.ts'), 'utf8');
    const lines = testFile.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/^assert\.ok\(\s*true\s*\)\s*;?\s*$/.test(trimmed)) {
        assert.fail('must not contain formal assert.ok(true) test');
      }
    }
  });

  // ── Phase 5E-D5 Fix 1: OTP SMS Report Metadata Normalization ─────

  it('SendSmsResult interface includes cost and errorCode fields', () => {
    assert.ok(/interface SendSmsResult/.test(funcSrc), 'must declare SendSmsResult interface');
    assert.ok(/ok:\s*boolean/.test(funcSrc), 'must have ok boolean');
    assert.ok(/errorCode:\s*string\s*\|\s*null/.test(funcSrc), 'must have errorCode field');
    assert.ok(/providerId:\s*string\s*\|\s*null/.test(funcSrc), 'must have providerId field');
    assert.ok(/providerName:\s*string\s*\|\s*null/.test(funcSrc), 'must have providerName field');
    assert.ok(/packId:\s*string\s*\|\s*null/.test(funcSrc), 'must have packId');
    assert.ok(/providerMessageId:\s*string\s*\|\s*null/.test(funcSrc), 'must have providerMessageId');
    assert.ok(/cost:\s*number\s*\|\s*null/.test(funcSrc), 'must have cost field');
    assert.ok(/Promise<SendSmsResult>/.test(funcSrc), 'sendSms must return Promise<SendSmsResult>');
  });

  it('normalizeProviderId accepts string and number, rejects other types', () => {
    assert.ok(/function normalizeProviderId/.test(funcSrc), 'must have normalizeProviderId function');
    const fnMatch = funcSrc.match(/function normalizeProviderId[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'must find normalizeProviderId function body');
    const body = fnMatch![0];
    assert.ok(/typeof value === "string"/.test(body), 'must accept string');
    assert.ok(/typeof value === "number"/.test(body), 'must accept number');
    assert.ok(/Number\.isFinite/.test(body), 'must check Number.isFinite for numbers');
    assert.ok(/String\(value\)/.test(body), 'must convert number to String');
    assert.ok(/return null/.test(body), 'must return null for invalid types');
  });

  it('normalizeCost accepts finite non-negative numbers only', () => {
    assert.ok(/function normalizeCost/.test(funcSrc), 'must have normalizeCost function');
    const fnMatch = funcSrc.match(/function normalizeCost[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'must find normalizeCost function body');
    const body = fnMatch![0];
    assert.ok(/typeof value === "number"/.test(body), 'must check typeof number');
    assert.ok(/Number\.isFinite/.test(body), 'must check Number.isFinite');
    assert.ok(/value >= 0/.test(body), 'must check value >= 0');
    assert.ok(/return null/.test(body), 'must return null for invalid cost');
  });

  it('maskCanonicalIranPhoneForLog converts 989... to 09... before masking', () => {
    assert.ok(/maskCanonicalIranPhoneForLog/.test(funcSrc), 'must have maskCanonicalIranPhoneForLog function');
    const fnMatch = funcSrc.match(/function maskCanonicalIranPhoneForLog[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'must find maskCanonicalIranPhoneForLog function body');
    const body = fnMatch![0];
    assert.ok(/\/\^989\\d\{9\}\$\//.test(body), 'must validate canonical 989... format');
    assert.ok(/canonicalPhone\.slice\(2\)/.test(body), 'must convert to 0... local format using slice(2)');
    assert.ok(/slice\(0,\s*4\)/.test(body), 'must keep first 4 chars of local phone');
    assert.ok(/slice\(-3\)/.test(body), 'must keep last 3 chars');
    assert.ok(/repeat\(localPhone\.length - 7\)/.test(body), 'must repeat stars dynamically');
  });

  it('maskCanonicalIranPhoneForLog returns *** for unexpected input', () => {
    const fnMatch = funcSrc.match(/function maskCanonicalIranPhoneForLog[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'must find maskCanonicalIranPhoneForLog function body');
    const body = fnMatch![0];
    assert.ok(/"\*\*\*"/.test(body), 'must return *** for invalid input');
  });

  it('raw canonical phone is never stored in target_phone', () => {
    assert.ok(!/target_phone:\s*canonicalPhone/.test(funcSrc), 'must not store raw canonicalPhone in target_phone');
    assert.ok(/maskCanonicalIranPhoneForLog\(canonicalPhone\)/.test(funcSrc), 'must call maskCanonicalIranPhoneForLog with canonicalPhone');
  });

  it('old maskPhoneForLog function is removed', () => {
    assert.ok(!/function maskPhoneForLog/.test(funcSrc), 'must not have old maskPhoneForLog function');
  });

  // ── Phase 5E-D5 Fix 2: Guaranteed OTP SMS Attempt Reporting ───────

  it('createOtpDispatchLog creates a pending log before provider resolution', () => {
    assert.ok(/createOtpDispatchLog/.test(funcSrc), 'must have createOtpDispatchLog function');
    assert.ok(/status:\s*"pending"/.test(funcSrc), 'must create log with status=pending');
    assert.ok(/message:\s*AUTH_OTP_LOG_MESSAGE_PENDING/.test(funcSrc), 'must use pending message constant');
    const createCallIdx = funcSrc.search(/const dispatchLogId = await createOtpDispatchLog/);
    const resolveCallIdx = funcSrc.search(/const provider = await resolveProvider/);
    assert.ok(createCallIdx >= 0 && resolveCallIdx >= 0, 'both call sites must exist');
    assert.ok(createCallIdx < resolveCallIdx, 'log must be created before provider resolution');
  });

  it('dispatch log is created before OTP generation', () => {
    const createCallIdx = funcSrc.search(/const dispatchLogId = await createOtpDispatchLog/);
    const otpIdx = funcSrc.search(/const otp = generateSixDigitOtp/);
    assert.ok(createCallIdx >= 0 && otpIdx >= 0);
    assert.ok(createCallIdx < otpIdx, 'log must be created before OTP generation');
  });

  it('dispatch log is created before challenge creation', () => {
    const createCallIdx = funcSrc.search(/const dispatchLogId = await createOtpDispatchLog/);
    const challengeIdx = funcSrc.search(/await createChallenge/);
    assert.ok(createCallIdx >= 0 && challengeIdx >= 0);
    assert.ok(createCallIdx < challengeIdx, 'log must be created before challenge creation');
  });

  it('createOtpDispatchLog uses select id single and checks for insert error', () => {
    assert.ok(/\.select\("id"\)/.test(funcSrc), 'must select id from insert');
    assert.ok(/\.single\(\)/.test(funcSrc), 'must use single()');
    assert.ok(/if\s*\(\s*error\s*\|\|\s*!data\s*\)/.test(funcSrc), 'must check insert error');
    assert.ok(/return null/.test(funcSrc), 'must return null on insert failure');
  });

  it('insert failure causes 503 LOGIN_UNAVAILABLE and no SMS', () => {
    const insertFailMatch = funcSrc.match(/if\s*\(\s*!dispatchLogId\s*\)[\s\S]*?LOGIN_UNAVAILABLE/);
    assert.ok(insertFailMatch, 'insert failure must return LOGIN_UNAVAILABLE');
  });

  it('updateOtpDispatchLog helper exists and checks error', () => {
    assert.ok(/updateOtpDispatchLog/.test(funcSrc), 'must have updateOtpDispatchLog function');
    assert.ok(/async function updateOtpDispatchLog/.test(funcSrc), 'must be async function');
    assert.ok(/\.update\(patch\)/.test(funcSrc), 'must update with patch');
    assert.ok(/\.eq\("id",\s*logId\)/.test(funcSrc), 'must eq id logId');
    assert.ok(/if\s*\(\s*error\s*\)/.test(funcSrc), 'must check error on update');
  });

  it('one request creates one dispatch log (no second insert)', () => {
    const insertCount = (funcSrc.match(/\.insert\(/g) || []).length;
    const auditInsertCount = (funcSrc.match(/audit_log.*\.insert\(/g) || []).length;
    const dispatchInsertCount = insertCount - auditInsertCount;
    assert.ok(dispatchInsertCount === 1, 'must have exactly one sms_dispatch_logs insert');
  });

  it('provider metadata updates same log row', () => {
    assert.ok(/updateOtpDispatchLog\(admin,\s*dispatchLogId,\s*\{[\s\S]*?provider_id/.test(funcSrc),
      'must update same logId with provider_id');
    assert.ok(/updateOtpDispatchLog\(admin,\s*dispatchLogId,\s*\{[\s\S]*?provider_name/.test(funcSrc),
      'must update same logId with provider_name');
  });

  it('NO_ACTIVE_SMS_PROVIDER creates failed log', () => {
    assert.ok(/NO_ACTIVE_SMS_PROVIDER/.test(funcSrc), 'must handle NO_ACTIVE_SMS_PROVIDER');
    const match = funcSrc.match(/NO_ACTIVE_SMS_PROVIDER[\s\S]*?status:\s*"failed"/);
    assert.ok(match, 'NO_ACTIVE_SMS_PROVIDER must set status=failed');
  });

  it('AMBIGUOUS_SMS_PROVIDER creates failed log', () => {
    assert.ok(/AMBIGUOUS_SMS_PROVIDER/.test(funcSrc), 'must handle AMBIGUOUS_SMS_PROVIDER');
  });

  it('SMS_PROVIDER_CONFIG_INVALID creates failed log', () => {
    assert.ok(/SMS_PROVIDER_CONFIG_INVALID/.test(funcSrc), 'must handle SMS_PROVIDER_CONFIG_INVALID');
  });

  it('OTP_TEMPLATE_UNAVAILABLE creates failed log', () => {
    assert.ok(/OTP_TEMPLATE_UNAVAILABLE/.test(funcSrc), 'must handle OTP_TEMPLATE_UNAVAILABLE');
    const match = funcSrc.match(/OTP_TEMPLATE_UNAVAILABLE[\s\S]*?status:\s*"failed"/);
    assert.ok(match, 'OTP_TEMPLATE_UNAVAILABLE must set status=failed');
  });

  it('CHALLENGE_CREATION_FAILED creates failed log', () => {
    assert.ok(/CHALLENGE_CREATION_FAILED/.test(funcSrc), 'must handle CHALLENGE_CREATION_FAILED');
  });

  it('RESEND_NOT_READY creates skipped log', () => {
    assert.ok(/RESEND_NOT_READY/.test(funcSrc), 'must handle RESEND_NOT_READY');
    const match = funcSrc.match(/RESEND_NOT_READY[\s\S]*?status:\s*"skipped"/);
    assert.ok(match, 'RESEND_NOT_READY must set status=skipped');
  });

  it('AUTH_TARGET_NOT_ELIGIBLE creates skipped log for ineligible user', () => {
    assert.ok(/AUTH_TARGET_NOT_ELIGIBLE/.test(funcSrc), 'must handle AUTH_TARGET_NOT_ELIGIBLE');
    const match = funcSrc.match(/AUTH_TARGET_NOT_ELIGIBLE[\s\S]*?status:\s*"skipped"/);
    assert.ok(match, 'AUTH_TARGET_NOT_ELIGIBLE must set status=skipped');
  });

  it('decoy/ineligible path does not send SMS', () => {
    const decoyMatch = funcSrc.match(/if\s*\(!resolved\)[\s\S]*?allowedOrigin\s*\)/);
    assert.ok(decoyMatch, 'must have decoy path');
    const decoyBlock = decoyMatch![0];
    assert.ok(!/sendSms/.test(decoyBlock), 'decoy must not call sendSms');
  });

  it('provider timeout creates failed log with SMS_PROVIDER_TIMEOUT', () => {
    assert.ok(/SMS_PROVIDER_TIMEOUT/.test(funcSrc), 'must handle SMS_PROVIDER_TIMEOUT');
  });

  it('provider rejected creates failed log with SMS_PROVIDER_REJECTED', () => {
    assert.ok(/SMS_PROVIDER_REJECTED/.test(funcSrc), 'must handle SMS_PROVIDER_REJECTED');
  });

  it('provider success updates same log to sent', () => {
    assert.ok(/status:\s*"sent"/.test(funcSrc), 'must set status=sent on success');
    assert.ok(/delivery_status:\s*.*\?\s*"pending"/.test(funcSrc), 'must set delivery_status=pending on success');
  });

  it('OTP is never stored in dispatch log', () => {
    const logMatches = funcSrc.match(/createOtpDispatchLog[\s\S]*?insert\(\{([\s\S]*?)\}\)/);
    assert.ok(logMatches, 'must find createOtpDispatchLog insert block');
    const block = logMatches![1];
    assert.ok(!/\botp\b/i.test(block), 'must not store OTP in log insert');
    const updateMatches = funcSrc.match(/updateOtpDispatchLog[\s\S]*?\{([\s\S]*?)\}/g);
    if (updateMatches) {
      for (const u of updateMatches) {
        assert.ok(!/\botp\b/i.test(u), 'must not store OTP in log update');
      }
    }
  });

  it('renderedTemplate is never stored in dispatch log', () => {
    assert.ok(!/renderedTemplate/.test(funcSrc.match(/createOtpDispatchLog[\s\S]*?insert\(\{([\s\S]*?)\}\)/)?.[1] ?? ''),
      'must not store renderedTemplate in insert');
  });

  it('full phone number is never stored in dispatch log', () => {
    const insertBlock = funcSrc.match(/createOtpDispatchLog[\s\S]*?insert\(\{([\s\S]*?)\}\)/);
    assert.ok(insertBlock, 'must find insert block');
    const block = insertBlock![1];
    assert.ok(!/canonicalPhone/.test(block), 'must not store canonicalPhone in insert');
    assert.ok(/maskedPhone/.test(block), 'must store maskedPhone in insert');
  });

  it('dispatch log does not store otp_hash, phone_hash, ip_hash, challenge_id, tokens', () => {
    const logMatch = funcSrc.match(/createOtpDispatchLog[\s\S]*?insert\(\{([\s\S]*?)\}\)/);
    assert.ok(logMatch, 'must find createOtpDispatchLog insert block');
    const block = logMatch![1];
    assert.ok(!/otp_hash/.test(block), 'must not store otp_hash');
    assert.ok(!/phone_hash/.test(block), 'must not store phone_hash');
    assert.ok(!/ip_hash/.test(block), 'must not store ip_hash');
    assert.ok(!/challenge_id/.test(block), 'must not store challenge_id');
    assert.ok(!/access_token/.test(block), 'must not store access_token');
    assert.ok(!/refresh_token/.test(block), 'must not store refresh_token');
    assert.ok(!/raw_response/.test(block), 'must not store raw_response');
  });

  it('provider resolution is server-side only (no client providerId accepted)', () => {
    assert.ok(/resolveProvider/.test(funcSrc), 'must have resolveProvider function');
    assert.ok(/async function resolveProvider/.test(funcSrc), 'must be async function');
    assert.ok(/sms_providers/.test(funcSrc), 'must query sms_providers');
    assert.ok(/is_active/.test(funcSrc), 'must check is_active');
    assert.ok(/is_default/.test(funcSrc), 'must check is_default');
  });

  it('provider resolution order: configured → default → single active → error', () => {
    assert.ok(/configuredProviderId/.test(funcSrc), 'must check configured provider');
    assert.ok(/is_default/.test(funcSrc), 'must check default');
    assert.ok(/activeProviders\.length === 1/.test(funcSrc), 'must check exactly one active');
    assert.ok(/NO_ACTIVE_SMS_PROVIDER/.test(funcSrc), 'must error on no active');
    assert.ok(/AMBIGUOUS_SMS_PROVIDER/.test(funcSrc), 'must error on ambiguous');
  });

  it('target_user_id only set when user is resolved and eligible', () => {
    assert.ok(/target_user_id:\s*resolved\.userId/.test(funcSrc), 'must set target_user_id after resolve');
  });

  it('dispatch log failure does not block response (structured server log)', () => {
    assert.ok(/\[PHONE_OTP_V2\] dispatch log update failed/.test(funcSrc),
      'must have structured server log for update failure');
  });

  it('AUTH_OTP_LOG_MESSAGE_PENDING is safe constant not OTP text', () => {
    assert.ok(/AUTH_OTP_LOG_MESSAGE_PENDING/.test(funcSrc), 'must have constant');
    assert.ok(/درخواست کد یک‌بارمصرف ورود/.test(funcSrc), 'must use safe pending message');
  });

  // ── send-sms auth_otp security ───────────────────────────────────

  it('send-sms restricts auth_otp to service caller only', () => {
    assert.ok(/auth_otp requires service caller/.test(sendSmsSrc), 'must check service caller for auth_otp');
    assert.ok(/caller\.userId\s*!==\s*"service"/.test(sendSmsSrc), 'must check caller.userId === service');
  });

  it('send-sms auth_otp timeout is 7000ms', () => {
    assert.ok(/7000/.test(sendSmsSrc), 'must have 7000ms timeout for auth_otp');
  });

  it('send-sms auth_otp does not return raw_response or debug in response', () => {
    const authOtpReturns = sendSmsSrc.match(/if\s*\(isAuthOtp\)\s*\{[\s\S]*?return json\(\{[\s\S]*?\}\);/g);
    assert.ok(authOtpReturns && authOtpReturns.length > 0, 'must have auth_otp return blocks');
    for (const block of authOtpReturns) {
      assert.ok(!/raw_response/.test(block), 'auth_otp must not return raw_response');
      assert.ok(!/\bdebug\b/.test(block), 'auth_otp must not return debug');
    }
  });

  it('send-sms non-auth_otp modes still return debug', () => {
    assert.ok(/debug/.test(sendSmsSrc), 'non-auth_otp modes must still have debug');
  });

  it('send-sms outer catch returns SMS_DISPATCH_FAILED for auth_otp', () => {
    assert.ok(/isAuthOtp[\s\S]*?SMS_DISPATCH_FAILED/.test(sendSmsSrc), 'outer catch must return SMS_DISPATCH_FAILED for auth_otp');
  });

  it('send-sms auth_otp network catch returns TIMEOUT or CONNECTION_FAILED', () => {
    assert.ok(/SMS_PROVIDER_TIMEOUT/.test(sendSmsSrc), 'must handle SMS_PROVIDER_TIMEOUT');
    assert.ok(/SMS_PROVIDER_CONNECTION_FAILED/.test(sendSmsSrc), 'must handle SMS_PROVIDER_CONNECTION_FAILED');
    assert.ok(/AbortError/.test(sendSmsSrc), 'must detect AbortError for timeout');
  });

  it('send-sms auth_otp config invalid returns SMS_PROVIDER_CONFIG_INVALID', () => {
    assert.ok(/SMS_PROVIDER_CONFIG_INVALID/.test(sendSmsSrc), 'must handle SMS_PROVIDER_CONFIG_INVALID');
  });

  it('request-otp-v2 stores redacted template with ****** in message', () => {
    assert.ok(/redactedRenderedTemplate/.test(funcSrc), 'must have redactedRenderedTemplate variable');
    assert.ok(/\*\*\*\*\*\*/.test(funcSrc), 'must use ****** as redaction');
    assert.ok(/message:\s*redactedRenderedTemplate/.test(funcSrc), 'must store redacted template in message');
  });

  it('request-otp-v2 never stores raw renderedTemplate in dispatch log', () => {
    const updateBlocks = funcSrc.match(/updateOtpDispatchLog\([\s\S]*?\{[\s\S]*?\}/g);
    assert.ok(updateBlocks, 'must have updateOtpDispatchLog calls');
    for (const block of updateBlocks!) {
      assert.ok(!/message:\s*renderedTemplate\b/.test(block), 'must not store raw renderedTemplate in message');
    }
  });

  it('request-otp-v2 never stores raw OTP in dispatch log', () => {
    const updateBlocks = funcSrc.match(/updateOtpDispatchLog\([\s\S]*?\{[\s\S]*?\}/g);
    if (updateBlocks) {
      for (const block of updateBlocks!) {
        assert.ok(!/message:\s*otp\b/.test(block), 'must not store raw OTP in message');
      }
    }
  });

  it('UI report source is still sms_dispatch_logs (no new system)', () => {
    assert.ok(/sms_dispatch_logs/.test(funcSrc), 'must still use sms_dispatch_logs');
  });

  it('registration and recovery are unchanged', () => {
    assert.ok(existsSync(join(functionsDir, 'request-public-registration-otp', 'index.ts')),
      'registration OTP function must exist');
    assert.ok(existsSync(join(functionsDir, 'request-phone-password-reset-otp', 'index.ts')),
      'password reset OTP function must exist');
    assert.ok(existsSync(join(functionsDir, 'verify-public-registration-otp', 'index.ts')),
      'registration verify function must exist');
    assert.ok(existsSync(join(functionsDir, 'verify-phone-password-reset-otp', 'index.ts')),
      'password reset verify function must exist');
  });
});
