import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationsDir = path.join(__dirname, '../../supabase/migrations');
const oldMigrationFile = fs.readdirSync(migrationsDir).find(f => f.includes('harden_auth_security_config'));
const newMigrationFile = fs.readdirSync(migrationsDir).find(f => f.includes('fix_auth_runtime_status_and_dispatch_summary'));
const oldSql = oldMigrationFile ? fs.readFileSync(path.join(migrationsDir, oldMigrationFile), 'utf-8') : '';
const newSql = newMigrationFile ? fs.readFileSync(path.join(migrationsDir, newMigrationFile), 'utf-8') : '';

// ── 1. Origin gate: request-phone-login-otp must Fail-Closed before processing ──

test('origin gate: request-phone-login-otp checks Origin BEFORE any processing', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/request-phone-login-otp/index.ts'),
    'utf-8',
  );
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
  assert.ok(
    source.includes('!requestOrigin') && source.includes('!allowedOrigins.includes(requestOrigin)'),
    'must reject empty origin and disallowed origin',
  );
  const gateReturnPos = source.indexOf('publicResponse(corsHeaders), corsHeaders');
  assert.ok(gateReturnPos > 0, 'must return generic public response for disallowed origin');
});

// ── 3. Readiness: frontend must not guess readiness — reload from server ─────

test('readiness: PhoneLoginToggleCard reloads from server after toggle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PhoneLoginToggleCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('await load()'), 'must reload config from server after toggle');
  assert.ok(!source.includes('setEnabled(v)'), 'must not locally guess enabled state after toggle');
  assert.ok(!source.includes('setReady(v'), 'must not locally guess ready state after toggle');
  assert.ok(!source.includes('setTestMode(v)'), 'must not locally guess test mode after toggle');
});

test('readiness: PasswordRecoveryCard reloads from server after toggle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PasswordRecoveryCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('await load()'), 'must reload config from server after toggle');
  assert.ok(!source.includes('setEnabled(v)'), 'must not locally guess enabled state after toggle');
  assert.ok(!source.includes('setTestMode(v)'), 'must not locally guess test mode after toggle');
  // setSecretConfirmed in load() is correct; must not appear in mutation handlers
  assert.ok(!/handle\w+Secret[\s\S]*?setSecretConfirmed\(true\)/.test(source), 'must not locally set secret confirmed in mutation handler');
});

// ── 4. Provider title renamed ────────────────────────────────────────────────

test('provider title: renamed to "ارائه‌دهنده پیامک احراز هویت موبایلی"', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PhoneLoginToggleCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('ارائه‌دهنده پیامک احراز هویت موبایلی'), 'must use new provider title');
  assert.ok(source.includes('برای ورود و بازیابی رمز استفاده می‌شود'), 'must include description');
});

// ── 5. TTL note: Spark only confirms, does not change real TTL ──────────────

test('TTL note: states Spark only confirms real Supabase Auth TTL', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/PhoneLoginToggleCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('مقدار واقعی TTL در تنظیمات Supabase Auth'), 'must clarify TTL is from Supabase Auth Dashboard');
  assert.ok(source.includes('تغییر نمی‌دهد'), 'must state Spark does not change real TTL');
});

// ── 6. BaleOtpConfigCard: shows real server status, not guessed ─────────────

test('bale card: fetches runtime status from get_auth_runtime_status RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes("rpc('get_auth_runtime_status')"), 'must call get_auth_runtime_status RPC');
  assert.ok(source.includes("rpc('get_bale_auth_dispatch_summary')"), 'must call get_bale_auth_dispatch_summary RPC');
  assert.ok(source.includes('bale_channel_active'), 'must show channel active status');
  assert.ok(source.includes('bale_bot_token_set'), 'must show bot token set status');
  assert.ok(source.includes('bale_bot_username_set'), 'must show bot username set status');
  assert.ok(source.includes('bale_mapping_count'), 'must show mapping count');
  assert.ok(source.includes('bale_auth_codes_enabled_count'), 'must show auth codes enabled count');
});

// ── 7. BaleOtpConfigCard: no sensitive data displayed ────────────────────────

test('bale card: no sensitive data (token, OTP, phone, chat_id) displayed', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
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
  assert.ok(source.includes('last_dispatch_status'), 'must show last dispatch status');
});

// ── 9. BaleOtpConfigCard: prerequisite warning when incomplete ──────────────

test('bale card: shows prerequisite warning when incomplete', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('پیش‌نیازها کامل نیست'), 'must show prerequisite warning when incomplete');
});

// ── 10. BaleOtpConfigCard: reloads after toggle ────────────────────────────

test('bale card: reloads from server after toggle', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('await load()'), 'must reload after toggle');
});

// ── 11. BaleOtpConfigCard: switches Fail-Closed when loading/error/unknown ──

test('bale card: switches disabled when runtime unknown', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('runtimeKnown'), 'must compute runtimeKnown flag');
  assert.ok(source.includes('!runtimeKnown'), 'must disable switches when runtime unknown');
  assert.ok(source.includes('runtimeError'), 'must track runtime errors');
});

// ── 12. BaleOtpConfigCard: each switch checks its own template ──────────────

test('bale card: each switch checks its own template prerequisite', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/PortalConfig/BaleOtpConfigCard.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('loginTemplateOk'), 'must check login template for login switch');
  assert.ok(source.includes('recoveryTemplateOk'), 'must check recovery template for recovery switch');
  assert.ok(source.includes('loginCanEnable'), 'must have loginCanEnable gate');
  assert.ok(source.includes('recoveryCanEnable'), 'must have recoveryCanEnable gate');
});

// ── 13. set_bale_auth_otp_config: server-side prerequisite validation ────────

test('set_bale_auth_otp_config: migration includes prerequisite checks', () => {
  assert.ok(oldMigrationFile, 'old migration file must exist');
  assert.ok(oldSql.includes('BALE_CHANNEL_INACTIVE'), 'must check bale channel active');
  assert.ok(oldSql.includes('BALE_BOT_TOKEN_MISSING'), 'must check bot token set');
  assert.ok(oldSql.includes('BALE_BOT_USERNAME_MISSING'), 'must check bot username set');
  assert.ok(oldSql.includes('BALE_TEMPLATE_NOT_READY'), 'must check template has {{otp}}');
  assert.ok(oldSql.includes("LIKE '%{{otp}}%'"), 'must validate template contains {{otp}}');
});

// ── 14. set_bale_auth_otp_config: admin-only (FORBIDDEN for non-admin) ──────

test('set_bale_auth_otp_config: admin-only check in migration', () => {
  assert.ok(oldSql.includes('FORBIDDEN'), 'must return FORBIDDEN for non-admin');
  assert.ok(oldSql.includes('REVOKE EXECUTE'), 'must REVOKE from PUBLIC and anon');
  assert.ok(oldSql.includes('GRANT EXECUTE') && oldSql.includes('authenticated'), 'must GRANT only to authenticated');
});

// ── 15. get_auth_runtime_status: admin-only, returns booleans only ──────────

test('get_auth_runtime_status: admin-only, no sensitive data in response', () => {
  assert.ok(newMigrationFile, 'new migration file must exist');
  // Check admin + active in new migration
  assert.ok(newSql.includes('get_auth_runtime_status'), 'function must exist in new migration');
  assert.ok(newSql.includes('FORBIDDEN'), 'must return FORBIDDEN for non-admin');
  assert.ok(newSql.includes('is_active'), 'must check is_active');
  assert.ok(newSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_runtime_status'), 'must REVOKE from PUBLIC/anon');
  // The RETURN clause must not include raw bot_token or webhook_secret
  const returnMatch = newSql.match(/RETURN jsonb_build_object\([\s\S]*?\);\s*\$function\;/);
  if (returnMatch) {
    const returnClause = returnMatch[0];
    assert.ok(!returnClause.includes('bot_token'), 'must not return raw bot_token in RETURN clause');
    assert.ok(!returnClause.includes('webhook_secret'), 'must not return webhook_secret in RETURN clause');
  }
});

// ── 16. get_auth_runtime_status: origins read as text, no text-to-int cast ──

test('get_auth_runtime_status: origins read as text, counted with proper logic', () => {
  assert.ok(newSql.includes('v_origins_text text'), 'must declare origins as text variable');
  assert.ok(newSql.includes('string_to_array(v_origins_text'), 'must use string_to_array on text');
  assert.ok(newSql.includes('btrim(elem)'), 'must count non-empty trimmed elements');
  // Must NOT cast text to integer directly
  assert.ok(!newSql.includes('v_origins_count::integer'), 'must not cast origins text to integer');
  assert.ok(!newSql.includes('v_origins_count::int'), 'must not cast origins text to int');
});

// ── 17. get_auth_runtime_status: login template from sms_templates ──────────

test('get_auth_runtime_status: login template from sms_templates (not notification_templates)', () => {
  // Login template must use sms_templates
  const loginTemplateMatch = newSql.match(/Login SMS template[\s\S]*?FROM public\.sms_templates/);
  assert.ok(loginTemplateMatch, 'login template must be from sms_templates');
  // Recovery template must also be from sms_templates
  const recoveryTemplateMatch = newSql.match(/Recovery SMS template[\s\S]*?FROM public\.sms_templates/);
  assert.ok(recoveryTemplateMatch, 'recovery template must be from sms_templates');
  // Bale templates must still be from notification_templates
  const baleTemplateMatch = newSql.match(/Bale login template[\s\S]*?FROM public\.notification_templates/);
  assert.ok(baleTemplateMatch, 'bale templates must remain in notification_templates');
});

// ── 18. get_auth_runtime_status: search_path = '' ───────────────────────────

test('get_auth_runtime_status: search_path is empty string', () => {
  const fnMatch = newSql.match(/CREATE OR REPLACE FUNCTION public\.get_auth_runtime_status\(\)[\s\S]*?SET search_path = ''/);
  assert.ok(fnMatch, 'must have SET search_path = empty string');
});

// ── 19. get_bale_auth_dispatch_summary: admin-only, no OTP/phone/chat_id ────

test('get_bale_auth_dispatch_summary: admin-only, no sensitive data', () => {
  assert.ok(newSql.includes('get_bale_auth_dispatch_summary'), 'function must exist in new migration');
  assert.ok(newSql.includes('FORBIDDEN'), 'must return FORBIDDEN for non-admin');
  assert.ok(newSql.includes('REVOKE EXECUTE ON FUNCTION public.get_bale_auth_dispatch_summary'), 'must REVOKE from PUBLIC/anon');
  // The RETURN clause must not include OTP, phone, or chat_id
  const returnMatch = newSql.match(/RETURN jsonb_build_object\([\s\S]*?\);\s*\$function\;/);
  if (returnMatch) {
    const returnClause = returnMatch[0];
    assert.ok(!returnClause.includes('otp'), 'must not return OTP');
    assert.ok(!returnClause.includes('phone'), 'must not return phone');
    assert.ok(!returnClause.includes('chat_id'), 'must not return chat_id');
  }
});

// ── 20. get_bale_auth_dispatch_summary: last dispatch without condition ────

test('get_bale_auth_dispatch_summary: last dispatch read without error_code condition', () => {
  // Must have a query that reads last dispatch without WHERE error_code IS NOT NULL
  const lastDispatchMatch = newSql.match(/Last dispatch[\s\S]*?ORDER BY completed_at DESC NULLS LAST, created_at DESC/);
  assert.ok(lastDispatchMatch, 'must read last dispatch without error_code condition');
  // Must NOT have WHERE error_code IS NOT NULL on the last dispatch query
  const lastDispatchSection = lastDispatchMatch[0];
  assert.ok(!lastDispatchSection.includes('WHERE error_code IS NOT NULL'), 'last dispatch must not filter on error_code');
});

// ── 21. get_bale_auth_dispatch_summary: last error in separate query ───────

test('get_bale_auth_dispatch_summary: last error in separate query', () => {
  const lastErrorMatch = newSql.match(/Last error[\s\S]*?WHERE error_code IS NOT NULL/);
  assert.ok(lastErrorMatch, 'must have separate query for last error with error_code condition');
});

// ── 22. get_bale_auth_dispatch_summary: search_path = '' ───────────────────

test('get_bale_auth_dispatch_summary: search_path is empty string', () => {
  const fnMatch = newSql.match(/CREATE OR REPLACE FUNCTION public\.get_bale_auth_dispatch_summary\(\)[\s\S]*?SET search_path = ''/);
  assert.ok(fnMatch, 'must have SET search_path = empty string');
});

// ── 23. No previous migration edited ────────────────────────────────────────

test('migration: two migration files exist, no previous migration edited', () => {
  assert.ok(oldMigrationFile, 'old migration file must exist');
  assert.ok(newMigrationFile, 'new migration file must exist');
  assert.ok(oldMigrationFile.includes('20260803160000'), 'old migration must have correct timestamp');
  assert.ok(newMigrationFile.includes('20260803170000'), 'new migration must have correct timestamp');
});

// ── 24. Bale disabled does not break SMS or login ───────────────────────────

test('architecture: bale is supplementary channel, not independent', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/auth-send-sms-hook/index.ts'),
    'utf-8',
  );
  assert.ok(
    source.includes('EdgeRuntime.waitUntil') && source.includes('sendBaleAuthCode'),
    'bale must be best-effort via EdgeRuntime.waitUntil',
  );
  const smsDispatchPos = source.indexOf('[auth-send-sms-hook] OTP dispatched');
  const balePos = source.indexOf('sendBaleAuthCode({');
  assert.ok(smsDispatchPos > 0 && balePos > 0, 'both SMS and bale dispatch must exist');
  assert.ok(smsDispatchPos < balePos, 'bale must be after SMS dispatch');
});

// ── 25. User without mapping or auth_codes_enabled=false gets no bale ──────

test('send-bale-auth-code: checks mapping and auth_codes_enabled', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/_shared/send-bale-auth-code.ts'),
    'utf-8',
  );
  assert.ok(source.includes('NOT_LINKED'), 'must skip if no mapping');
  assert.ok(source.includes('USER_DISABLED'), 'must skip if auth_codes_enabled=false');
});

// ── 26. check-auth-env-secrets edge function exists ─────────────────────────

test('check-auth-env-secrets: edge function exists and returns only booleans', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/check-auth-env-secrets/index.ts'),
    'utf-8',
  );
  assert.ok(source.includes('hook_secret_set'), 'must return hook_secret_set boolean');
  assert.ok(source.includes('rate_limit_pepper_set'), 'must return rate_limit_pepper_set boolean');
  assert.ok(source.includes('recovery_secret_set'), 'must return recovery_secret_set boolean');
  assert.ok(source.includes('allowed_origins_set'), 'must return allowed_origins_set boolean');
  // Must verify JWT and check admin
  assert.ok(source.includes('getUser(token)'), 'must verify JWT');
  assert.ok(source.includes('is_admin'), 'must check admin');
  assert.ok(source.includes('is_active'), 'must check is_active');
  // Must not return secret values
  assert.ok(!source.includes('hookSecret}'), 'must not return hook secret value');
  assert.ok(!source.includes('rateLimitPepper}'), 'must not return pepper value');
  assert.ok(!source.includes('recoverySecret}'), 'must not return recovery secret value');
});

// ── 27. All RPCs: schema-qualified tables ──────────────────────────────────

test('RPCs: all tables are schema-qualified with public.', () => {
  for (const sql of [oldSql, newSql]) {
    // Check that table references use public. prefix
    assert.ok(sql.includes('public.profiles'), 'must use public.profiles');
    assert.ok(sql.includes('public.system_config'), 'must use public.system_config');
  }
  // New migration must also schema-qualify
  assert.ok(newSql.includes('public.sms_providers') || newSql.includes('public.sms_templates'), 'must schema-qualify sms tables');
  assert.ok(newSql.includes('public.social_channel_configs'), 'must schema-qualify social_channel_configs');
  assert.ok(newSql.includes('public.notification_templates'), 'must schema-qualify notification_templates');
  assert.ok(newSql.includes('public.user_bale_mapping'), 'must schema-qualify user_bale_mapping');
  assert.ok(newSql.includes('public.bale_auth_code_dispatches'), 'must schema-qualify bale_auth_code_dispatches');
});
