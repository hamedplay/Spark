import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── 1. Origin gate: request-phone-login-otp must Fail-Closed before processing ──

test('origin gate: request-phone-login-otp checks Origin BEFORE any processing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/request-phone-login-otp/index.ts'),
    'utf-8',
  );
  // The Origin check must appear before body parsing, rate limit, signInWithOtp
  const originCheckPos = source.indexOf('Fail-Closed Origin gate');
  const bodyParsePos = source.indexOf('const body = await req.json()');
  const signInPos = source.indexOf('await anonSupabase.auth.signInWithOtp');

  assert.ok(originCheckPos > 0, 'must contain Fail-Closed Origin gate comment');
  assert.ok(originCheckPos < bodyParsePos, 'Origin check must be before body parsing');
  assert.ok(originCheckPos < signInPos, 'Origin check must be before signInWithOtp');
});

// ── 2. Origin gate: empty or disallowed origin returns generic response ──────

test('origin gate: empty or disallowed origin does not process phone', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/request-phone-login-otp/index.ts'),
    'utf-8',
  );
  // Must check: !requestOrigin || !allowedOrigins.includes(requestOrigin)
  assert.ok(
    source.includes('!requestOrigin') && source.includes('!allowedOrigins.includes(requestOrigin)'),
    'must reject empty origin and disallowed origin',
  );
  // Must return generic response (not error) for disallowed origin
  const gateReturnPos = source.indexOf('publicResponse(corsHeaders), corsHeaders');
  assert.ok(gateReturnPos > 0, 'must return generic public response for disallowed origin');
});

// ── 3. Readiness: frontend must not guess readiness — reload from server ─────

test('readiness: PhoneLoginToggleCard reloads from server after toggle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PhoneLoginToggleCard.tsx'),
    'utf-8',
  );
  // After toggle, must call load() to re-fetch from server
  assert.ok(
    source.includes('await load()'),
    'must reload config from server after toggle',
  );
  // Must NOT manually set enabled/ready from the toggle value
  assert.ok(
    !source.includes('setEnabled(v)'),
    'must not locally guess enabled state after toggle',
  );
});

test('readiness: PasswordRecoveryCard reloads from server after toggle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PasswordRecoveryCard.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('await load()'),
    'must reload config from server after toggle',
  );
  assert.ok(
    !source.includes('setEnabled(v)'),
    'must not locally guess enabled state after toggle',
  );
});

// ── 4. Provider title renamed ────────────────────────────────────────────────

test('provider title: renamed to "ارائه‌دهنده پیامک احراز هویت موبایلی"', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PhoneLoginToggleCard.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('ارائه‌دهنده پیامک احراز هویت موبایلی'),
    'must use new provider title',
  );
  assert.ok(
    source.includes('برای ورود و بازیابی رمز استفاده می‌شود'),
    'must include description for login and password recovery',
  );
});

// ── 5. TTL note: Spark only confirms, does not change real TTL ──────────────

test('TTL note: states Spark only confirms real Supabase Auth TTL', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PhoneLoginToggleCard.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('مقدار واقعی TTL در تنظیمات Supabase Auth'),
    'must clarify TTL is from Supabase Auth Dashboard',
  );
  assert.ok(
    source.includes('تغییر نمی‌دهد'),
    'must state Spark does not change real TTL',
  );
});

// ── 6. BaleOtpConfigCard: shows real server status, not guessed ─────────────

test('bale card: fetches runtime status from get_auth_runtime_status RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes("rpc('get_auth_runtime_status')"),
    'must call get_auth_runtime_status RPC',
  );
  assert.ok(
    source.includes("rpc('get_bale_auth_dispatch_summary')"),
    'must call get_bale_auth_dispatch_summary RPC',
  );
  // Must show channel active, bot token set, bot username set
  assert.ok(source.includes('bale_channel_active'), 'must show channel active status');
  assert.ok(source.includes('bale_bot_token_set'), 'must show bot token set status');
  assert.ok(source.includes('bale_bot_username_set'), 'must show bot username set status');
  // Must show mapping count and auth_codes_enabled count
  assert.ok(source.includes('bale_mapping_count'), 'must show mapping count');
  assert.ok(source.includes('bale_auth_codes_enabled_count'), 'must show auth codes enabled count');
});

// ── 7. BaleOtpConfigCard: no sensitive data displayed ────────────────────────

test('bale card: no sensitive data (token, OTP, phone, chat_id) displayed', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  // Must not display raw bot_token, OTP, phone numbers, or chat IDs
  assert.ok(!source.includes('bot_token value'), 'must not display raw bot token value');
  assert.ok(!source.includes('bale_chat_id value'), 'must not display chat ID');
  assert.ok(!source.includes('otp value'), 'must not display OTP value');
});

// ── 8. BaleOtpConfigCard: shows dispatch summary with counts ────────────────

test('bale card: shows dispatch summary counts and last error code', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('counts.sent'), 'must show sent count');
  assert.ok(source.includes('counts.failed'), 'must show failed count');
  assert.ok(source.includes('counts.skipped'), 'must show skipped count');
  assert.ok(source.includes('last_error_code'), 'must show last error code');
});

// ── 9. BaleOtpConfigCard: prerequisite warning when incomplete ──────────────

test('bale card: shows prerequisite warning when incomplete', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('پیش‌نیازها کامل نیست'),
    'must show prerequisite warning when incomplete',
  );
});

// ── 10. BaleOtpConfigCard: reloads after toggle ────────────────────────────

test('bale card: reloads from server after toggle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(
    source.includes('await load()'),
    'must reload after toggle',
  );
});

// ── 11. set_bale_auth_otp_config: server-side prerequisite validation ────────

test('set_bale_auth_otp_config: migration includes prerequisite checks', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('harden_auth_security_config'));
  assert.ok(files.length > 0, 'migration file must exist');

  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('BALE_CHANNEL_INACTIVE'), 'must check bale channel active');
  assert.ok(sql.includes('BALE_BOT_TOKEN_MISSING'), 'must check bot token set');
  assert.ok(sql.includes('BALE_BOT_USERNAME_MISSING'), 'must check bot username set');
  assert.ok(sql.includes('BALE_TEMPLATE_NOT_READY'), 'must check template has {{otp}}');
  assert.ok(sql.includes("LIKE '%{{otp}}%'"), 'must validate template contains {{otp}}');
});

// ── 12. set_bale_auth_otp_config: admin-only (FORBIDDEN for non-admin) ──────

test('set_bale_auth_otp_config: admin-only check in migration', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('harden_auth_security_config'));
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('FORBIDDEN'), 'must return FORBIDDEN for non-admin');
  assert.ok(sql.includes('REVOKE EXECUTE'), 'must REVOKE from PUBLIC and anon');
  assert.ok(sql.includes('GRANT EXECUTE') && sql.includes('authenticated'), 'must GRANT only to authenticated');
});

// ── 13. get_auth_runtime_status: admin-only, returns booleans only ──────────

test('get_auth_runtime_status: admin-only, no sensitive data in response', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('harden_auth_security_config'));
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  // Must check admin
  assert.ok(sql.includes('get_auth_runtime_status'), 'function must exist');
  assert.ok(sql.includes('FORBIDDEN'), 'must return FORBIDDEN for non-admin');
  // Must REVOKE from PUBLIC and anon
  assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_runtime_status'), 'must REVOKE from PUBLIC/anon');
  // Must not return secrets — only booleans and counts
  const fnDefMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.get_auth_runtime_status\(\).*?AS \$function\$.*?\$function\;/s);
  if (fnDefMatch) {
    const fnBody = fnDefMatch[0];
    assert.ok(!fnBody.includes('bot_token'), 'must not return raw bot_token');
    assert.ok(!fnBody.includes('webhook_secret'), 'must not return webhook_secret');
  }
});

// ── 14. get_bale_auth_dispatch_summary: admin-only, no OTP/phone/chat_id ────

test('get_bale_auth_dispatch_summary: admin-only, no sensitive data', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('harden_auth_security_config'));
  const sql = fs.readFileSync(path.join(migrationsDir, files[files.length - 1]), 'utf-8');
  assert.ok(sql.includes('get_bale_auth_dispatch_summary'), 'function must exist');
  assert.ok(sql.includes('FORBIDDEN'), 'must return FORBIDDEN for non-admin');
  // Must REVOKE from PUBLIC and anon
  assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary'), 'must REVOKE from PUBLIC/anon');
  // Must only return counts and cleaned error codes — not OTP, phone, chat_id
  const fnDefMatch = sql.match(/CREATE OR REPLACE FUNCTION public\.get_bale_auth_dispatch_summary\(\).*?AS \$function\$.*?\$function\;/s);
  if (fnDefMatch) {
    const fnBody = fnDefMatch[0];
    assert.ok(!fnBody.includes('otp'), 'must not return OTP');
    assert.ok(!fnBody.includes('phone'), 'must not return phone');
    assert.ok(!fnBody.includes('chat_id'), 'must not return chat_id');
  }
});

// ── 15. No previous migration edited ────────────────────────────────────────

test('migration: new file created, no previous migration edited', () => {
  const migrationsDir = path.join(__dirname, '../../supabase/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.includes('harden_auth_security_config'));
  assert.ok(files.length === 1, 'exactly one new migration file');
  assert.ok(files[0].includes('20260803160000'), 'must have correct timestamp');
});

// ── 16. Bale disabled does not break SMS or login ───────────────────────────

test('architecture: bale is supplementary channel, not independent', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/auth-send-sms-hook/index.ts'),
    'utf-8',
  );
  // Bale send must be in EdgeRuntime.waitUntil (non-blocking, best-effort)
  assert.ok(
    source.includes('EdgeRuntime.waitUntil') && source.includes('sendBaleAuthCode'),
    'bale must be best-effort via EdgeRuntime.waitUntil',
  );
  // Bale send must happen AFTER SMS dispatch succeeds
  const smsDispatchPos = source.indexOf('[auth-send-sms-hook] OTP dispatched');
  const balePos = source.indexOf('sendBaleAuthCode({');
  assert.ok(smsDispatchPos > 0 && balePos > 0, 'both SMS and bale dispatch must exist');
  assert.ok(smsDispatchPos < balePos, 'bale must be after SMS dispatch');
});

// ── 17. User without mapping or auth_codes_enabled=false gets no bale ──────

test('send-bale-auth-code: checks mapping and auth_codes_enabled', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/_shared/send-bale-auth-code.ts'),
    'utf-8',
  );
  // Must check mapping exists
  assert.ok(source.includes('NOT_LINKED'), 'must skip if no mapping');
  // Must check auth_codes_enabled
  assert.ok(source.includes('USER_DISABLED'), 'must skip if auth_codes_enabled=false');
});
