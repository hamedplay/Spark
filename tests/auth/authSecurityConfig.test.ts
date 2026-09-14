import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

const retiredLoginEdge = read('supabase/functions/request-phone-login-otp/index.ts');
const retiredLoginRoute = read('supabase/functions/_shared/retiredPhoneLoginRoute.ts');
const runtimeEdge = read('supabase/functions/check-phone-password-reset-runtime/index.ts');
const phoneAuthCard = read('src/components/PortalConfig/PhoneAuthCard.tsx');
const identityRepairCard = read('src/components/PortalConfig/IdentityRepairCard.tsx');
const configPage = read('src/components/PortalConfigPage.tsx');
const constants = read('src/components/PortalConfig/constants.ts');
const securityConsole = read('src/features/security-settings/components/SecuritySettingsConsole.tsx');
const hardeningMigration = read('supabase/migrations/20260914093000_align_security_portal_runtime_controls.sql');

describe('Auth and security configuration', () => {
  it('keeps the retired phone-login entrypoint delegated to the closed shared handler', () => {
    assert.match(retiredLoginEdge, /retiredPhoneLoginRoute/);
    assert.match(retiredLoginEdge, /Deno\.serve\(retiredPhoneLoginRoute\)/);
    assert.match(retiredLoginRoute, /get_phone_auth_config/);
    assert.match(retiredLoginRoute, /config\.origins\.includes\(origin\)/);
    assert.match(retiredLoginRoute, /status:\s*410/);
    assert.match(retiredLoginRoute, /LOGIN_ROUTE_REPLACED/);
    assert.doesNotMatch(retiredLoginRoute, /signInWithOtp/);
    assert.doesNotMatch(retiredLoginRoute, /req\.json\(\)/);
  });

  it('uses an exact database origin allowlist without wildcard CORS', () => {
    const configPosition = retiredLoginRoute.indexOf('await getConfig()');
    const methodPosition = retiredLoginRoute.indexOf('req.method === "OPTIONS"');
    assert.ok(configPosition > -1 && configPosition < methodPosition);
    assert.doesNotMatch(retiredLoginRoute, /Access-Control-Allow-Origin["']:\s*["']\*["']/);
    assert.match(retiredLoginRoute, /"Vary": "Origin"/);
  });

  it('keeps public auth RPC calls bound to the Supabase client', () => {
    const authPage = read('src/components/AuthPage.tsx');
    assert.doesNotMatch(authPage, /const publicRpc\s*=\s*supabase\.rpc/);
    assert.match(authPage, /supabase\.rpc\('get_public_auth_config'\)/);
    assert.match(authPage, /supabase\.rpc\('get_public_login_methods'\)/);
    assert.match(authPage, /authConfigLoading &&/);
    assert.match(authPage, /تلاش دوباره/);
  });

  it('checks recovery runtime before reading the admin status', () => {
    const runtimeCheck = phoneAuthCard.indexOf('check-phone-password-reset-runtime');
    const statusRead = phoneAuthCard.indexOf("rpc('get_phone_auth_admin_status')");
    assert.ok(runtimeCheck > -1 && statusRead > runtimeCheck);
    assert.match(phoneAuthCard, /invokeEdgeFunctionWithTimeout/);
  });

  it('exposes only runtime-backed generic security configuration', () => {
    const presentationStart = constants.indexOf('export const SECURITY_CONFIG_PRESENTATION');
    const visibleStart = constants.indexOf('export const VISIBLE_SECURITY_CONFIG_KEYS');
    assert.ok(presentationStart > -1 && visibleStart > presentationStart);
    const presentation = constants.slice(presentationStart, visibleStart);
    assert.match(presentation, /maintenance_mode/);
    for (const staleKey of [
      'enable_2fa',
      'max_login_attempts',
      'session_timeout_minutes',
      'require_strong_password',
      'allowed_ip_ranges',
      'audit_log_retention_days',
      'log_all_actions',
    ]) {
      assert.doesNotMatch(presentation, new RegExp(staleKey));
    }
  });

  it('does not fetch hidden security secrets into Portal Config', () => {
    assert.match(configPage, /\.neq\('section',\s*'security'\)/);
    assert.match(configPage, /\.eq\('section',\s*'security'\)/);
    assert.match(configPage, /\.in\('key',\s*securityKeys\)/);
    assert.match(configPage, /SecuritySettingsConsole/);
  });

  it('labels password login and OTP login as separate runtime mechanisms', () => {
    assert.match(securityConsole, /ورود با موبایل و رمز عبور/);
    assert.match(phoneAuthCard, /ورود با کد یک‌بارمصرف موبایل \(OTP\)/);
    assert.match(phoneAuthCard, /مستقل از «ورود با موبایل و رمز عبور»/);
  });

  it('requires Security Admin TOTP step-up before changing phone auth entry points', () => {
    assert.match(phoneAuthCard, /useSecurityStepUp/);
    assert.match(phoneAuthCard, /purpose:\s*'auth_settings_change'/);
    assert.match(phoneAuthCard, /rpc\('is_current_security_admin'\)/);
    assert.match(phoneAuthCard, /stepUp\.requireStepUp/);
    assert.match(hardeningMigration, /private\.is_current_security_admin\(\)/);
    assert.match(hardeningMigration, /purpose = 'auth_settings_change'/);
    assert.match(hardeningMigration, /consumed_at = clock_timestamp\(\)/);
  });

  it('blocks authenticated browser access to security secret rows', () => {
    assert.match(hardeningMigration, /AS RESTRICTIVE/);
    assert.match(hardeningMigration, /phone_auth_pepper/);
    assert.match(hardeningMigration, /phone_rate_limit_pepper/);
    assert.match(hardeningMigration, /send_sms_hook_secret/);
  });

  it('keeps identity inspection manual and always releases its busy state', () => {
    assert.doesNotMatch(identityRepairCard, /useEffect\([^]*run\('dry_run'\)/);
    assert.match(identityRepairCard, /invokeEdgeFunctionWithTimeout/);
    assert.match(identityRepairCard, /finally\s*\{\s*setBusy\(''\)/);
    assert.match(identityRepairCard, /REQUEST_TIMEOUT/);
  });

  it('protects the recovery runtime check with full auth and canonical account state', () => {
    assert.match(runtimeEdge, /requireFullAuthAccess\(req\)/);
    assert.match(runtimeEdge, /is_admin/);
    assert.match(runtimeEdge, /account_status/);
    assert.doesNotMatch(runtimeEdge, /profile\?\.is_active/);
  });

  it('reads allowed origins from the database and exposes readiness booleans without secret material', () => {
    assert.match(runtimeEdge, /get_phone_auth_config/);
    assert.match(runtimeEdge, /allowedOrigins\.includes\(origin\)/);
    assert.doesNotMatch(runtimeEdge, /"Access-Control-Allow-Origin": "\*"/);
    assert.match(runtimeEdge, /runtime_confirmed:\s*readiness\.runtimeReady/);
    assert.match(runtimeEdge, /origins_configured:\s*readiness\.originsConfigured/);
    assert.match(runtimeEdge, /provider_ready:\s*readiness\.providerReady/);
    assert.match(runtimeEdge, /template_ready:\s*readiness\.templateReady/);
    assert.doesNotMatch(runtimeEdge, /Deno\.env\.get\(["']PHONE_PASSWORD_RESET_SECRET["']\)/);
    assert.doesNotMatch(runtimeEdge, /secret:\s*secret/);
  });

  it('writes and verifies canonical recovery readiness', () => {
    assert.match(runtimeEdge, /unified_recovery_runtime_ready/);
    assert.match(runtimeEdge, /phone_password_recovery_secret_configured/);
    assert.match(runtimeEdge, /phone_password_recovery_secret_operator_confirmed/);
    assert.match(runtimeEdge, /CONFIG_UPDATE_FAILED/);
  });
});
