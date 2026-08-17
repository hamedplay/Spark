import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');

const retiredLoginEdge = read('supabase/functions/request-phone-login-otp/index.ts');
const runtimeEdge = read('supabase/functions/check-phone-password-reset-runtime/index.ts');
const phoneAuthCard = read('src/components/PortalConfig/PhoneAuthCard.tsx');
const identityRepairCard = read('src/components/PortalConfig/IdentityRepairCard.tsx');
const phoneLoginToggleCard = read('src/components/PortalConfig/PhoneLoginToggleCard.tsx');
const passwordRecoveryCard = read('src/components/PortalConfig/PasswordRecoveryCard.tsx');
const configPage = read('src/components/PortalConfigPage.tsx');
const constants = read('src/components/PortalConfig/constants.ts');
const migration = read('supabase/migrations/20260811170122_fix_phone_recovery_and_identity_repair.sql');

describe('Auth and security configuration', () => {
  it('keeps the retired phone-login route closed and never dispatches OTP', () => {
    assert.match(retiredLoginEdge, /get_phone_auth_config/);
    assert.match(retiredLoginEdge, /config\.origins\.includes\(origin\)/);
    assert.match(retiredLoginEdge, /status:\s*410/);
    assert.match(retiredLoginEdge, /LOGIN_ROUTE_REPLACED/);
    assert.doesNotMatch(retiredLoginEdge, /signInWithOtp/);
    assert.doesNotMatch(retiredLoginEdge, /req\.json\(\)/);
  });

  it('uses an exact database origin allowlist without wildcard CORS', () => {
    const configPosition = retiredLoginEdge.indexOf('await getConfig()');
    const methodPosition = retiredLoginEdge.indexOf('req.method === "OPTIONS"');
    assert.ok(configPosition > -1 && configPosition < methodPosition);
    assert.doesNotMatch(retiredLoginEdge, /Access-Control-Allow-Origin["']:\s*["']\*["']/);
    assert.match(retiredLoginEdge, /"Vary": "Origin"/);
  });

  it('reloads canonical login and recovery status after every toggle', () => {
    assert.match(phoneLoginToggleCard, /await load\(\)/);
    assert.match(passwordRecoveryCard, /await load\(\)/);
    assert.doesNotMatch(phoneLoginToggleCard, /setEnabled\(v\)/);
    assert.doesNotMatch(passwordRecoveryCard, /setEnabled\(v\)/);
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

  it('renders only explicitly localized security configuration rows', () => {
    assert.match(constants, /VISIBLE_SECURITY_CONFIG_KEYS/);
    assert.match(configPage, /VISIBLE_SECURITY_CONFIG_KEYS\.has\(c\.key\)/);
    assert.doesNotMatch(configPage, /entry\.label\s*\|\|\s*entry\.key/);
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

  it('ships Persian labels for internal phone-auth configuration keys', () => {
    assert.match(migration, /phone_login_canonical_enabled/);
    assert.match(migration, /فعال‌سازی مرجع ورود با موبایل/);
    assert.match(migration, /phone_otp_login_backend_ready/);
    assert.match(migration, /آمادگی سرویس ورود با کد یک‌بارمصرف/);
  });
});
