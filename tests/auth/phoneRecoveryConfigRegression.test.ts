import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const authPage = read('src/components/AuthPage.tsx');
const configPage = read('src/components/PortalConfigPage.tsx');
const constants = read('src/components/PortalConfig/constants.ts');
const repairCard = read('src/components/PortalConfig/IdentityRepairCard.tsx');
const repairEdge = read('supabase/functions/bulk-sync-profile-phones/index.ts');
const runtimeEdge = read('supabase/functions/check-phone-password-reset-runtime/index.ts');
const migration = read('supabase/migrations/20260811170122_fix_phone_recovery_and_identity_repair.sql');

describe('Phone recovery and security configuration regressions', () => {
  it('never invents a recovery challenge in the browser', () => {
    const recoverySection = authPage.slice(
      authPage.indexOf('const handleRequestPasswordResetOtp'),
      authPage.indexOf('const handleRecoveryVerifyOtp'),
    );
    assert.doesNotMatch(recoverySection, /crypto\.randomUUID/);
    assert.match(recoverySection, /isValidUuid\(data\.challenge_id\)/);
    assert.match(recoverySection, /invokeEdgeFunctionWithTimeout/);
  });

  it('shows a loading state while public recovery readiness is refreshed', () => {
    assert.match(authPage, /authConfigLoading/);
    assert.match(authPage, /در حال بررسی امکان بازیابی رمز عبور/);
    assert.match(authPage, /void loadAuthConfig\(\)/);
  });

  it('renders security configuration from a Persian allowlist only', () => {
    assert.match(constants, /VISIBLE_SECURITY_CONFIG_KEYS/);
    assert.match(configPage, /VISIBLE_SECURITY_CONFIG_KEYS\.has\(c\.key\)/);
    assert.doesNotMatch(configPage, /!HIDDEN_SECURITY_CONFIG_KEYS\.has\(c\.key\)/);
  });

  it('does not start identity inspection automatically and always releases busy state', () => {
    assert.doesNotMatch(repairCard, /autoCheckStarted/);
    assert.match(repairCard, /finally\s*\{\s*setBusy\(''\)/);
    assert.match(repairCard, /REQUEST_TIMEOUT/);
  });

  it('uses the database origin allowlist and keeps step-up for mutations only', () => {
    assert.match(repairEdge, /get_phone_auth_config/);
    assert.doesNotMatch(repairEdge, /PHONE_LOGIN_ALLOWED_ORIGINS/);
    const mutationGate = repairEdge.indexOf('if (mode !== "dry_run")');
    const aalGate = repairEdge.indexOf('claims.aal !== "aal2"');
    const dryRun = repairEdge.indexOf('if (mode === "dry_run")');
    assert.ok(mutationGate > -1 && aalGate > mutationGate);
    assert.ok(dryRun > aalGate);
  });

  it('writes runtime readiness to the canonical recovery key', () => {
    assert.match(runtimeEdge, /phone_password_recovery_secret_configured/);
    assert.match(runtimeEdge, /phone_password_recovery_secret_operator_confirmed/);
    const confirmRead = runtimeEdge.lastIndexOf('.eq("key", "phone_password_recovery_secret_configured")');
    assert.ok(confirmRead > -1);
  });

  it('localizes internal keys and reconciles the prior verified runtime state', () => {
    assert.match(migration, /phone_login_canonical_enabled/);
    assert.match(migration, /فعال‌سازی مرجع ورود با موبایل/);
    assert.match(migration, /phone_otp_login_backend_ready/);
    assert.match(migration, /آمادگی سرویس ورود با کد یک‌بارمصرف/);
    assert.match(migration, /SET value = legacy\.value/);
  });
});
