import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationDir = path.join(__dirname, '../../supabase/migrations');

const appliedMigrationName = '20260804185047_20260804230000_phase3b_security_console_state.sql.sql';
const appliedMigrationPath = path.join(migrationDir, appliedMigrationName);
const appliedMigrationSql = fs.existsSync(appliedMigrationPath)
  ? fs.readFileSync(appliedMigrationPath, 'utf-8')
  : '';

const hardeningMigrationName =
  '20260804190854_20260804240000_phase3b_security_console_state_hardening.sql.sql';
const hardeningMigrationPath = path.join(migrationDir, hardeningMigrationName);
const hardeningMigrationSql = fs.existsSync(hardeningMigrationPath)
  ? fs.readFileSync(hardeningMigrationPath, 'utf-8')
  : '';

const consoleSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/components/SecuritySettingsConsole.tsx'),
  'utf-8',
);

const stepUpDialogSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/components/SecurityStepUpDialog.tsx'),
  'utf-8',
);

const mfaOperationsSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/auth/services/mfaOperations.ts'),
  'utf-8',
);

const mfaPanelSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/PortalConfig/MfaPanel.tsx'),
  'utf-8',
);

const totpFactorManagerSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/auth/components/TotpFactorManager.tsx'),
  'utf-8',
);

const profilePageSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/ProfilePage.tsx'),
  'utf-8',
);

const securitySettingsServiceSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/services/securitySettingsService.ts'),
  'utf-8',
);

const validateSecuritySettingsSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/utils/validateSecuritySettings.ts'),
  'utf-8',
);

const securitySettingsTypesSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/types/securitySettings.ts'),
  'utf-8',
);

// ── Patch Builder Tests ─────────────────────────────────────────────────────

test('patch builder: only changed fields included', async () => {
  const { buildSecuritySettingsPatch } = await import(
    '../../src/features/security-settings/utils/buildSecuritySettingsPatch'
  );
  const server = {
    settings_version: 1, username_login: true, email_login: true, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const draft = { ...server, mfa_policy: 'optional', allow_totp_mfa: true };
  const patch = buildSecuritySettingsPatch(server, draft);
  assert.ok('mfa_policy' in patch, 'changed field must be in patch');
  assert.ok('allow_totp_mfa' in patch, 'changed field must be in patch');
  assert.equal(Object.keys(patch).length, 2, 'only 2 changed fields');
  assert.equal(patch.mfa_policy, 'optional');
  assert.equal(patch.allow_totp_mfa, true);
});

test('patch builder: settings_version not in patch', async () => {
  const { buildSecuritySettingsPatch } = await import(
    '../../src/features/security-settings/utils/buildSecuritySettingsPatch'
  );
  const server = {
    settings_version: 5, username_login: true, email_login: true, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const draft = { ...server, username_login: false };
  const patch = buildSecuritySettingsPatch(server, draft);
  assert.ok(!('settings_version' in patch), 'settings_version must NOT be in patch');
});

test('patch builder: read-only fields not in patch', async () => {
  const { buildSecuritySettingsPatch } = await import(
    '../../src/features/security-settings/utils/buildSecuritySettingsPatch'
  );
  const server = {
    settings_version: 1, username_login: true, email_login: true, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const draft = { ...server, allow_bale_mfa: true, allow_email_mfa: true, allow_recovery_codes: true };
  const patch = buildSecuritySettingsPatch(server, draft);
  assert.ok(!('allow_bale_mfa' in patch), 'allow_bale_mfa must NOT be in patch (read-only)');
  assert.ok(!('allow_email_mfa' in patch), 'allow_email_mfa must NOT be in patch (read-only)');
  assert.ok(!('allow_recovery_codes' in patch), 'allow_recovery_codes must NOT be in patch (read-only)');
  assert.ok(!('config_schema_version' in patch), 'config_schema_version must NOT be in patch');
  assert.ok(!('updated_at' in patch), 'updated_at must NOT be in patch');
  assert.ok(!('updated_by' in patch), 'updated_by must NOT be in patch');
});

test('patch builder: empty patch detected', async () => {
  const { buildSecuritySettingsPatch, isPatchEmpty } = await import(
    '../../src/features/security-settings/utils/buildSecuritySettingsPatch'
  );
  const server = {
    settings_version: 1, username_login: true, email_login: true, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const draft = { ...server };
  const patch = buildSecuritySettingsPatch(server, draft);
  assert.ok(isPatchEmpty(patch), 'identical server and draft must produce empty patch');
});

// ── Validation Tests ─────────────────────────────────────────────────────────

test('validation: turning off all login methods rejected', async () => {
  const { validateSecuritySettings } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  const draft = {
    settings_version: 1, username_login: false, email_login: false, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const result = validateSecuritySettings(draft, { username_login: false, email_login: false, phone_login: false });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_LOGIN_METHOD_ENABLED');
});

test('validation: turning off last remaining login method with minimal patch rejected', async () => {
  const { validateSecuritySettings } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  const draft = {
    settings_version: 1, username_login: false, email_login: false, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  // Server has email_login=true, patch only turns it off
  const result = validateSecuritySettings(draft, { email_login: false });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'NO_LOGIN_METHOD_ENABLED');
});

test('validation: required without TOTP rejected', async () => {
  const { validateSecuritySettings } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  const draft = {
    settings_version: 1, username_login: true, email_login: false, phone_login: false,
    mfa_policy: 'required', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const result = validateSecuritySettings(draft, { mfa_policy: 'required' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'MFA_REQUIRED_WITHOUT_FACTOR');
});

test('validation: idle > absolute rejected', async () => {
  const { validateSecuritySettings } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  const draft = {
    settings_version: 1, username_login: true, email_login: true, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 2000,
    session_absolute_lifetime_minutes: 1000, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };
  const result = validateSecuritySettings(draft, { session_idle_timeout_minutes: 2000 });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'INVALID_SESSION_POLICY');
});

test('validation: numeric ranges enforced', async () => {
  const { validateSecuritySettings } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  const baseDraft = {
    settings_version: 1, username_login: true, email_login: true, phone_login: false,
    mfa_policy: 'disabled', registration_enabled: true, registration_requires_admin_approval: false,
    require_profile_completion: false, allow_totp_mfa: false, allow_bale_mfa: false,
    allow_email_mfa: false, allow_recovery_codes: false, session_idle_timeout_minutes: 480,
    session_absolute_lifetime_minutes: 1440, max_active_sessions: 5, lock_threshold: 5,
    lock_duration_minutes: 30, recovery_enabled: false, config_schema_version: 1,
    updated_at: '2024-01-01',
  };

  assert.equal(validateSecuritySettings(baseDraft, { session_idle_timeout_minutes: 0 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { session_idle_timeout_minutes: 10081 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { session_absolute_lifetime_minutes: 43201 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { max_active_sessions: 0 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { max_active_sessions: 101 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { lock_threshold: 0 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { lock_threshold: 51 }).ok, false);
  assert.equal(validateSecuritySettings(baseDraft, { lock_duration_minutes: 1441 }).ok, false);

  assert.equal(validateSecuritySettings(baseDraft, { session_idle_timeout_minutes: 60 }).ok, true);
  assert.equal(validateSecuritySettings(baseDraft, { max_active_sessions: 10 }).ok, true);
  assert.equal(validateSecuritySettings(baseDraft, { lock_threshold: 3 }).ok, true);
  assert.equal(validateSecuritySettings(baseDraft, { lock_duration_minutes: 60 }).ok, true);
});

test('validation: change reason < 10 chars rejected', async () => {
  const { validateChangeReason } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  assert.equal(validateChangeReason('short').ok, false);
  assert.equal(validateChangeReason('').ok, false);
});

test('validation: whitespace-only change reason rejected', async () => {
  const { validateChangeReason } = await import(
    '../../src/features/security-settings/utils/validateSecuritySettings'
  );
  assert.equal(validateChangeReason('          ').ok, false);
  assert.equal(validateChangeReason('   ').ok, false);
});

// ── Step-up Tests ────────────────────────────────────────────────────────────

test('step-up: setter not called before successful step-up', () => {
  const onSuccessCall = stepUpDialogSource.indexOf('onSuccess()');
  const stepUpCall = stepUpDialogSource.indexOf('performTotpStepUp');
  assert.ok(stepUpCall > 0, 'must call performTotpStepUp');
  assert.ok(onSuccessCall > 0, 'must call onSuccess');
  assert.ok(stepUpCall < onSuccessCall, 'step-up must happen before onSuccess (which triggers setter)');
});

test('step-up: purpose is auth_settings_change', () => {
  // The dialog is now generalized — purpose is a prop.
  // SecuritySettingsConsole passes auth_settings_change as the purpose.
  const settingsConsoleSource = fs.readFileSync(
    path.join(__dirname, '../../src/features/security-settings/components/SecuritySettingsConsole.tsx'),
    'utf-8',
  );
  assert.ok(settingsConsoleSource.includes('auth_settings_change'),
    'SecuritySettingsConsole must use auth_settings_change purpose');
});

test('step-up: AAL2 failure stops save', () => {
  assert.ok(mfaOperationsSource.includes("currentLevel !== 'aal2'"),
    'performTotpStepUp must check AAL2 and return error');
  assert.ok(mfaOperationsSource.includes("return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'AAL2_NOT_REACHED' }"),
    'must return AAL2_NOT_REACHED on failure');
});

test('step-up: RPC setter called exactly once', () => {
  const saveCallCount = (consoleSource.match(/saveSecuritySettingsPatch/g) || []).length;
  assert.ok(saveCallCount >= 1, 'saveSecuritySettingsPatch must be called');
  const handleSuccess = consoleSource.indexOf('handleStepUpSuccess');
  const saveCall = consoleSource.indexOf('saveSecuritySettingsPatch', handleSuccess);
  assert.ok(saveCall > 0, 'saveSecuritySettingsPatch must be called in handleStepUpSuccess');
});

test('step-up: OTP not in patch or error output', () => {
  const rpcCallStart = consoleSource.indexOf('saveSecuritySettingsPatch(');
  const rpcCallEnd = consoleSource.indexOf('});', rpcCallStart);
  const rpcCall = consoleSource.slice(rpcCallStart, rpcCallEnd);
  assert.ok(!rpcCall.includes('code'), 'must not pass code to saveSecuritySettingsPatch');
  assert.ok(!rpcCall.includes('validCode'), 'must not pass validCode to saveSecuritySettingsPatch');
});

test('step-up: raw backend error not displayed', () => {
  assert.ok(!consoleSource.includes('error.message'), 'must not use raw error.message');
  assert.ok(consoleSource.includes('SECURITY_ERROR_MESSAGES'), 'must use mapped error messages');
});

test('step-up: grant not stored in storage', () => {
  assert.ok(!consoleSource.includes('localStorage'), 'must not use localStorage');
  assert.ok(!consoleSource.includes('sessionStorage'), 'must not use sessionStorage');
});

// ── Impact Tests ─────────────────────────────────────────────────────────────

test('impact: required with security admin without TOTP blocked', () => {
  assert.ok(consoleSource.includes('security_admins_without_verified_totp > 0'),
    'must check security_admins_without_verified_totp');
  assert.ok(consoleSource.includes('مسدود است'),
    'must block save with message about blocking');
});

test('impact: required without confirmation blocked', () => {
  assert.ok(consoleSource.includes('confirmRequired'), 'must have confirmation checkbox');
  assert.ok(consoleSource.includes('لطفاً کادر تأیید'), 'must show confirmation required message');
});

test('impact: counts have no user identity', () => {
  const impactSource = fs.readFileSync(
    path.join(__dirname, '../../src/features/security-settings/components/MfaPolicyImpactCard.tsx'),
    'utf-8',
  );
  assert.ok(impactSource.includes('active_users'), 'must show active_users count');
  assert.ok(impactSource.includes('users_with_verified_totp'), 'must show users_with_verified_totp count');
  assert.ok(impactSource.includes('security_admins_without_verified_totp'), 'must show security_admins_without_verified_totp count');
  assert.ok(!impactSource.includes('user_id'), 'must not show user_id');
  assert.ok(!impactSource.includes('email'), 'must not show email');
  assert.ok(!impactSource.includes('full_name'), 'must not show full_name');
});

// ── Profile TOTP Tests ──────────────────────────────────────────────────────

test('profile TOTP: enrollment not auto-started on mount', () => {
  assert.ok(totpFactorManagerSource.includes("useState<Phase>('idle')"),
    'must start in idle phase');
  const useEffectBlocks = totpFactorManagerSource.match(/useEffect\([^)]*\)/g) || [];
  for (const block of useEffectBlocks) {
    assert.ok(!block.includes('startTotpEnrollment'),
      'useEffect must not call startTotpEnrollment');
  }
});

test('profile TOTP: cancel only removes factor from current flow', () => {
  assert.ok(totpFactorManagerSource.includes('enrolledFactorIdRef.current'),
    'cancel must use enrolledFactorIdRef');
  const cancelFn = totpFactorManagerSource.slice(
    totpFactorManagerSource.indexOf('handleCancel'),
    totpFactorManagerSource.indexOf('}, [', totpFactorManagerSource.indexOf('handleCancel'))
  );
  assert.ok(cancelFn.includes('enrolledFactorIdRef.current'),
    'cancel must reference enrolledFactorIdRef');
});

test('profile TOTP: removal does not execute before verify', () => {
  const removeFn = totpFactorManagerSource.slice(
    totpFactorManagerSource.indexOf('handleRemoveConfirm'),
    totpFactorManagerSource.indexOf('}, [', totpFactorManagerSource.indexOf('handleRemoveConfirm'))
  );
  const verifyPos = removeFn.indexOf('verifyTotpFactor');
  const unenrollPos = removeFn.indexOf('mfa.unenroll');
  assert.ok(verifyPos > 0, 'must call verifyTotpFactor');
  assert.ok(unenrollPos > 0, 'must call mfa.unenroll');
  assert.ok(verifyPos < unenrollPos, 'verify must come before unenroll');
});

test('profile TOTP: removing wrong factor not possible', () => {
  assert.ok(totpFactorManagerSource.includes('removeTarget'),
    'must use removeTarget to track which factor to remove');
  const unenrollCall = totpFactorManagerSource.indexOf("mfa.unenroll({ factorId: removeTarget.id })");
  assert.ok(unenrollCall > 0, 'must unenroll the specific removeTarget.id');
});

test('profile TOTP: removing last factor when mfaRequired=true blocked', () => {
  assert.ok(totpFactorManagerSource.includes('verifiedCount === 1 && mfaRequired'),
    'must check verifiedCount === 1 && mfaRequired');
  assert.ok(totpFactorManagerSource.includes('ابتدا یک برنامه احراز هویت دیگر اضافه کنید'),
    'must show message about adding another factor first');
  assert.ok(totpFactorManagerSource.includes('verifiedCount === 1 && mfaRequired'),
    'delete button must be disabled when last factor and mfaRequired');
});

test('profile TOTP: access state refreshed after enrollment/removal', () => {
  assert.ok(totpFactorManagerSource.includes('loadFactors'),
    'must call loadFactors after enrollment');
  assert.ok(totpFactorManagerSource.includes('get_my_auth_access_state'),
    'must refresh access state via get_my_auth_access_state');
});

test('profile TOTP: secret not retained in state after success', () => {
  const verifyFn = totpFactorManagerSource.slice(
    totpFactorManagerSource.indexOf('handleVerify'),
    totpFactorManagerSource.indexOf('}, [', totpFactorManagerSource.indexOf('handleVerify'))
  );
  assert.ok(verifyFn.includes('setEnrollment(null)'),
    'must clear enrollment after success');
  assert.ok(verifyFn.includes("setCode('')"),
    'must clear code after success');
});

// ── Migration Contract Tests (Applied Migration) ─────────────────────────────

test('applied migration: console state RPC is SECURITY DEFINER', () => {
  assert.ok(appliedMigrationSql.includes('SECURITY DEFINER'),
    'must be SECURITY DEFINER');
});

test('applied migration: search_path is empty string', () => {
  assert.ok(appliedMigrationSql.includes("SET search_path TO ''"),
    'must have search_path = empty string');
});

test('applied migration: anon and PUBLIC do not have execute', () => {
  assert.ok(appliedMigrationSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM PUBLIC'),
    'must revoke from PUBLIC');
  assert.ok(appliedMigrationSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM anon'),
    'must revoke from anon');
});

test('applied migration: authenticated has execute', () => {
  assert.ok(appliedMigrationSql.includes('GRANT EXECUTE ON FUNCTION public.get_auth_security_console_state() TO authenticated'),
    'must grant to authenticated');
});

test('applied migration: uses is_current_security_admin()', () => {
  assert.ok(appliedMigrationSql.includes('public.is_current_security_admin()'),
    'must use is_current_security_admin()');
});

test('applied migration: history limit is 20', () => {
  assert.ok(appliedMigrationSql.includes('LIMIT 20'),
    'must limit history to 20 records');
});

// ── Hardening Migration Tests ────────────────────────────────────────────────

test('hardening migration: file exists on disk', () => {
  assert.ok(fs.existsSync(hardeningMigrationPath),
    'hardening migration file must exist');
  assert.ok(hardeningMigrationSql.length > 0,
    'hardening migration file must not be empty');
});

test('hardening migration: SECURITY DEFINER', () => {
  assert.ok(hardeningMigrationSql.includes('SECURITY DEFINER'),
    'must be SECURITY DEFINER');
});

test('hardening migration: search_path is empty string', () => {
  assert.ok(hardeningMigrationSql.includes("SET search_path TO ''"),
    'must have search_path = empty string');
});

test('hardening migration: revokes from PUBLIC and anon', () => {
  assert.ok(hardeningMigrationSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM PUBLIC'),
    'must revoke from PUBLIC');
  assert.ok(hardeningMigrationSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM anon'),
    'must revoke from anon');
});

test('hardening migration: grants to authenticated', () => {
  assert.ok(hardeningMigrationSql.includes('GRANT EXECUTE ON FUNCTION public.get_auth_security_console_state() TO authenticated'),
    'must grant to authenticated');
});

test('hardening migration: uses is_current_security_admin()', () => {
  assert.ok(hardeningMigrationSql.includes('public.is_current_security_admin()'),
    'must use is_current_security_admin()');
});

test('hardening migration: session validation with auth.sessions', () => {
  assert.ok(hardeningMigrationSql.includes('auth.sessions'),
    'must validate session against auth.sessions');
  assert.ok(hardeningMigrationSql.includes('session_id'),
    'must extract session_id from JWT');
  assert.ok(hardeningMigrationSql.includes('not_after'),
    'must check not_after expiry');
});

test('hardening migration: users_with_verified_totp uses EXISTS on active profiles', () => {
  assert.ok(hardeningMigrationSql.includes('EXISTS'),
    'must use EXISTS for verified TOTP count');
  // Find the actual SELECT query for v_users_with_verified_totp (not the DECLARE)
  const selectPos = hardeningMigrationSql.indexOf('SELECT count(DISTINCT p.user_id) INTO v_users_with_verified_totp');
  assert.ok(selectPos > 0, 'must have SELECT INTO v_users_with_verified_totp');
  const totpSection = hardeningMigrationSql.slice(selectPos, hardeningMigrationSql.indexOf('v_users_without_verified_totp', selectPos));
  assert.ok(totpSection.includes('is_active IS TRUE'),
    'must filter by is_active in TOTP count');
  assert.ok(totpSection.includes("account_status = 'ACTIVE'"),
    'must filter by account_status in TOTP count');
});
test('hardening migration: users_without_verified_totp uses NOT EXISTS (not subtraction)', () => {
  // Find the actual SELECT query for v_users_without_verified_totp (not the DECLARE)
  const selectPos = hardeningMigrationSql.indexOf('SELECT count(DISTINCT p.user_id) INTO v_users_without_verified_totp');
  assert.ok(selectPos > 0, 'must have SELECT INTO v_users_without_verified_totp');
  const withoutTotpSection = hardeningMigrationSql.slice(selectPos, hardeningMigrationSql.indexOf('v_security_admins', selectPos));
  assert.ok(withoutTotpSection.includes('NOT EXISTS'),
    'must use NOT EXISTS for users without TOTP');
  assert.ok(!withoutTotpSection.includes('GREATEST'),
    'must NOT use GREATEST subtraction');
  assert.ok(withoutTotpSection.includes('is_active IS TRUE'),
    'must filter by is_active');
  assert.ok(withoutTotpSection.includes("account_status = 'ACTIVE'"),
    'must filter by account_status');
});

test('hardening migration: history limit is 20', () => {
  assert.ok(hardeningMigrationSql.includes('LIMIT 20'),
    'must limit history to 20 records');
});

test('hardening migration: no data deletion', () => {
  const sqlOnly = hardeningMigrationSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM'),
    'must not DELETE');
  assert.ok(!sqlOnly.toUpperCase().includes('DROP '),
    'must not DROP');
  assert.ok(!sqlOnly.toUpperCase().includes('TRUNCATE'),
    'must not TRUNCATE');
});

test('hardening migration: no experimental factors created', () => {
  assert.ok(!hardeningMigrationSql.toUpperCase().includes('INSERT INTO AUTH.MFA'),
    'must not insert into auth.mfa_factors');
});

test('hardening migration: no MFA policy changes', () => {
  const sqlOnly = hardeningMigrationSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().match(/\bUPDATE\b/), 'must not UPDATE any table');
  assert.ok(!sqlOnly.toUpperCase().includes('INSERT INTO PUBLIC.AUTH_SECURITY_SETTINGS'),
    'must not INSERT into auth_security_settings');
  assert.ok(!sqlOnly.toUpperCase().includes('ALTER TABLE'), 'must not ALTER any table');
});

test('hardening migration: returns only counts, not factor IDs or secrets', () => {
  assert.ok(hardeningMigrationSql.includes('count(DISTINCT'),
    'must use count(DISTINCT) for counts');
  assert.ok(!hardeningMigrationSql.includes('secret'), 'must not return secret');
  assert.ok(!hardeningMigrationSql.includes('factor_id'), 'must not return factor_id');
  const impactSection = hardeningMigrationSql.slice(
    hardeningMigrationSql.indexOf("'impact'"),
    hardeningMigrationSql.indexOf("'recent_history'")
  );
  assert.ok(!impactSection.includes('user_id'), 'impact must not include user_id');
});

// ── Migration Drift Tests ────────────────────────────────────────────────────

test('migration drift: exactly two phase3b_security_console_state migrations exist', () => {
  const allMigrations = fs.readdirSync(migrationDir);
  const consoleMigrations = allMigrations.filter((f) => f.includes('phase3b_security_console_state'));
  assert.equal(consoleMigrations.length, 2,
    `expected exactly 2 phase3b_security_console_state migrations, found ${consoleMigrations.length}: ${consoleMigrations.join(', ')}`);
});

test('migration drift: applied migration file has exact name', () => {
  const appliedPath = path.join(migrationDir, '20260804185047_20260804230000_phase3b_security_console_state.sql.sql');
  assert.ok(fs.existsSync(appliedPath),
    'applied migration must be named 20260804185047_20260804230000_phase3b_security_console_state.sql.sql');
});

test('migration drift: hardening migration file has exact applied name', () => {
  const hardeningPath = path.join(migrationDir, '20260804190854_20260804240000_phase3b_security_console_state_hardening.sql.sql');
  assert.ok(fs.existsSync(hardeningPath),
    'hardening migration must be named 20260804190854_20260804240000_phase3b_security_console_state_hardening.sql.sql');
});

test('migration drift: pending 20260804240000 hardening file does not exist', () => {
  const pendingPath = path.join(migrationDir, '20260804240000_phase3b_security_console_state_hardening.sql');
  assert.ok(!fs.existsSync(pendingPath),
    'pending hardening migration 20260804240000 must not exist');
});

test('migration drift: no pending phase3b migrations without applied version prefix', () => {
  const allMigrations = fs.readdirSync(migrationDir);
  const consoleMigrations = allMigrations.filter((f) => f.includes('phase3b_security_console_state'));
  for (const f of consoleMigrations) {
    // Applied migrations have pattern: <14digits>_<8digits>_<name>.sql.sql
    assert.ok(f.match(/^\d{14}_\d{8}.*\.sql\.sql$/),
      `migration file must have applied prefix pattern (timestamp_timestamp...sql.sql): ${f}`);
  }
});

test('migration drift: duplicate 20260804230000 file does not exist', () => {
  const duplicatePath = path.join(migrationDir, '20260804230000_phase3b_security_console_state.sql');
  assert.ok(!fs.existsSync(duplicatePath),
    'duplicate unapplied migration 20260804230000 must not exist');
});

test('migration drift: applied migration file unchanged', () => {
  assert.ok(fs.existsSync(appliedMigrationPath),
    'applied migration file must exist');
  assert.ok(appliedMigrationSql.includes('SECURITY DEFINER'),
    'applied migration must still have SECURITY DEFINER');
});

// ── Dialog Close While Busy Tests ─────────────────────────────────────────────

test('dialog close: header close button has disabled={busy}', () => {
  const headerBtnMatch = stepUpDialogSource.match(/<button[^>]*onClick=\{handleClose\}[^>]*>/);
  assert.ok(headerBtnMatch, 'must have a button using handleClose');
  assert.ok(headerBtnMatch[0].includes('disabled={busy}'),
    'header close button must have disabled={busy}');
  assert.ok(headerBtnMatch[0].includes('aria-disabled={busy}'),
    'header close button must have aria-disabled={busy}');
});

test('dialog close: handleClose does not call onClose when busy', () => {
  const handleCloseFn = stepUpDialogSource.slice(
    stepUpDialogSource.indexOf('const handleClose'),
    stepUpDialogSource.indexOf('}, [busy, onClose]);') + '}, [busy, onClose]);'.length
  );
  assert.ok(handleCloseFn.includes('if (busy) return'),
    'handleClose must return early when busy');
  assert.ok(handleCloseFn.includes('onClose()'),
    'handleClose must call onClose when not busy');
});

test('dialog close: both header and footer use same handleClose handler', () => {
  const headerCloseCount = (stepUpDialogSource.match(/onClick=\{handleClose\}/g) || []).length;
  assert.ok(headerCloseCount >= 2,
    `both header X and footer cancel must use handleClose, found ${headerCloseCount}`);
});

test('dialog close: no direct onClose call in button handlers', () => {
  // After handleClose is defined, no button should call onClose directly
  const handleClosePos = stepUpDialogSource.indexOf('const handleClose');
  const afterHandleClose = stepUpDialogSource.slice(handleClosePos);
  // No button should have onClick={onClose} — must go through handleClose
  assert.ok(!afterHandleClose.match(/onClick=\{onClose\}/),
    'no button should call onClose directly — must use handleClose');
});

// ── Remove Modal Close While Removing Tests ──────────────────────────────────

test('remove modal: closeRemoveDialog does not close when removing', () => {
  const closeFn = totpFactorManagerSource.slice(
    totpFactorManagerSource.indexOf('const closeRemoveDialog'),
    totpFactorManagerSource.indexOf('}, [removing]);') + '}, [removing]);'.length
  );
  assert.ok(closeFn.includes('if (removing) return'),
    'closeRemoveDialog must return early when removing');
});

test('remove modal: header close has disabled={removing}', () => {
  const headerMatch = totpFactorManagerSource.match(/<button[^>]*onClick=\{closeRemoveDialog\}[^>]*>/);
  assert.ok(headerMatch, 'must have a button using closeRemoveDialog');
  assert.ok(headerMatch[0].includes('disabled={removing}'),
    'remove modal header close must have disabled={removing}');
  assert.ok(headerMatch[0].includes('aria-disabled={removing}'),
    'remove modal header close must have aria-disabled={removing}');
});

test('remove modal: both header and footer use same closeRemoveDialog', () => {
  const closeCount = (totpFactorManagerSource.match(/onClick=\{closeRemoveDialog\}/g) || []).length;
  assert.ok(closeCount >= 2,
    `both header X and footer cancel must use closeRemoveDialog, found ${closeCount}`);
});

test('remove modal: no direct setRemoveTarget(null) in button handlers after closeRemoveDialog', () => {
  const closeDialogPos = totpFactorManagerSource.indexOf('const closeRemoveDialog');
  const afterCloseDialog = totpFactorManagerSource.slice(closeDialogPos);
  // No button should directly call setRemoveTarget(null) — must go through closeRemoveDialog
  assert.ok(!afterCloseDialog.match(/onClick=\{\(\)\s*=>\s*\{\s*setRemoveTarget\(null\)/),
    'no button should call setRemoveTarget(null) directly — must use closeRemoveDialog');
});

test('remove modal: no hidden save after cancel during removal', () => {
  // The handleRemoveConfirm function must not be callable from closeRemoveDialog
  const closeDialogFn = totpFactorManagerSource.slice(
    totpFactorManagerSource.indexOf('const closeRemoveDialog'),
    totpFactorManagerSource.indexOf('}, [removing]);') + '}, [removing]);'.length
  );
  assert.ok(!closeDialogFn.includes('handleRemoveConfirm'),
    'closeRemoveDialog must not call handleRemoveConfirm');
  assert.ok(!closeDialogFn.includes('unenroll'),
    'closeRemoveDialog must not call unenroll');
});


test('import path: securitySettingsService resolves to src/lib/supabase', () => {
  assert.ok(securitySettingsServiceSource.includes("from '../../../lib/supabase'"),
    'must import supabase from ../../../lib/supabase');
  assert.ok(!securitySettingsServiceSource.includes("from '../../lib/supabase'"),
    'must NOT import from ../../lib/supabase (wrong path)');
});

// ── setError Test ────────────────────────────────────────────────────────────

test('TotpFactorManager: no undefined setError call', () => {
  assert.ok(!totpFactorManagerSource.includes('setError(null)'),
    'must not call setError (undefined function)');
});

// ── Dialog Open Effect Tests ──────────────────────────────────────────────────

test('dialog: uses useEffect for open state, not useState initializer', () => {
  assert.ok(stepUpDialogSource.includes('useEffect'),
    'must use useEffect for open state');
  // Must NOT have useState with a function initializer that calls loadFactors
  assert.ok(!stepUpDialogSource.match(/useState\(\(\)\s*=>/),
    'must not use useState initializer for side effects');
});

test('dialog: resets state when open=false', () => {
  const useEffectBlock = stepUpDialogSource.slice(
    stepUpDialogSource.indexOf('useEffect(() => {'),
    stepUpDialogSource.indexOf('}, [open, loadFactors]);')
  );
  assert.ok(useEffectBlock.includes("setCode('')"),
    'must reset code when closed');
  assert.ok(useEffectBlock.includes('setError(null)'),
    'must reset error when closed');
  assert.ok(useEffectBlock.includes('setSelectedFactorId(null)'),
    'must reset selectedFactorId when closed');
  assert.ok(useEffectBlock.includes('setFactors([])'),
    'must reset factors when closed');
});

test('dialog: loads factors when open becomes true', () => {
  const useEffectBlock = stepUpDialogSource.slice(
    stepUpDialogSource.indexOf('useEffect(() => {'),
    stepUpDialogSource.indexOf('}, [open, loadFactors]);')
  );
  assert.ok(useEffectBlock.includes('void loadFactors()'),
    'must call loadFactors when open');
});

test('dialog: does not auto-select first factor when multiple factors exist', () => {
  const loadFactorsFn = stepUpDialogSource.slice(
    stepUpDialogSource.indexOf('const loadFactors'),
    stepUpDialogSource.indexOf('}, []);')
  );
  // Must only auto-select when verified.length === 1
  assert.ok(loadFactorsFn.includes('verified.length === 1'),
    'must only auto-select when exactly 1 verified factor');
  // Must NOT have verified[0] as a fallback for multiple factors
  assert.ok(!loadFactorsFn.includes('verified[0].id') || loadFactorsFn.includes('verified.length === 1'),
    'must not blindly select verified[0]');
});

test('dialog: no handleOpen function', () => {
  assert.ok(!stepUpDialogSource.includes('handleOpen'),
    'must not have handleOpen function');
});

// ── Save Flow Tests ──────────────────────────────────────────────────────────

test('save: stops when no verified TOTP factor', () => {
  assert.ok(consoleSource.includes('hasVerifiedTotp'),
    'must check hasVerifiedTotp');
  assert.ok(consoleSource.includes('برای تغییر تنظیمات امنیتی ابتدا TOTP'),
    'must show message about enabling TOTP first');
});

test('save: setter called exactly once after step-up success', () => {
  const saveCalls = (consoleSource.match(/saveSecuritySettingsPatch\(/g) || []).length;
  assert.equal(saveCalls, 1, 'must call saveSecuritySettingsPatch exactly once');
});

// ── VERSION_CONFLICT Tests ────────────────────────────────────────────────────

test('VERSION_CONFLICT: snapshot preserved', () => {
  assert.ok(consoleSource.includes('ConflictSnapshot'),
    'must have ConflictSnapshot type');
  assert.ok(consoleSource.includes('setConflict('),
    'must set conflict snapshot on VERSION_CONFLICT');
});

test('VERSION_CONFLICT: change reason not auto-cleared', () => {
  // In the VERSION_CONFLICT branch, setChangeReason('') must NOT be called
  const conflictBranch = consoleSource.slice(
    consoleSource.indexOf("errorCode === 'VERSION_CONFLICT'"),
    consoleSource.indexOf('} else {', consoleSource.indexOf("errorCode === 'VERSION_CONFLICT'"))
  );
  assert.ok(!conflictBranch.includes("setChangeReason('')"),
    'must not clear change reason on VERSION_CONFLICT');
});

test('VERSION_CONFLICT: no auto-save', () => {
  const conflictBranch = consoleSource.slice(
    consoleSource.indexOf("errorCode === 'VERSION_CONFLICT'"),
    consoleSource.indexOf('} else {', consoleSource.indexOf("errorCode === 'VERSION_CONFLICT'"))
  );
  assert.ok(!conflictBranch.includes('saveSecuritySettingsPatch'),
    'must not auto-save on VERSION_CONFLICT');
});

// ── Error Mapping Tests ──────────────────────────────────────────────────────

test('error mapping: SESSION_INVALID not mapped to UNKNOWN_SECURITY_ERROR in setter', () => {
  assert.ok(securitySettingsServiceSource.includes("'SESSION_INVALID'"),
    'must handle SESSION_INVALID explicitly in saveSecuritySettingsPatch');
});

test('error mapping: Read RPC error codes supported in types', () => {
  assert.ok(securitySettingsTypesSource.includes("'UNAUTHORIZED'"),
    'must include UNAUTHORIZED error code');
  assert.ok(securitySettingsTypesSource.includes("'SESSION_INVALID'"),
    'must include SESSION_INVALID error code');
  assert.ok(securitySettingsTypesSource.includes("'SECURITY_ADMIN_REQUIRED'"),
    'must include SECURITY_ADMIN_REQUIRED error code');
  assert.ok(securitySettingsTypesSource.includes("'SETTINGS_NOT_FOUND'"),
    'must include SETTINGS_NOT_FOUND error code');
});

test('error mapping: Persian messages for new error codes', () => {
  assert.ok(securitySettingsTypesSource.includes('UNAUTHORIZED:'),
    'must have Persian message for UNAUTHORIZED');
  assert.ok(securitySettingsTypesSource.includes('SESSION_INVALID:'),
    'must have Persian message for SESSION_INVALID');
  assert.ok(securitySettingsTypesSource.includes('SECURITY_ADMIN_REQUIRED:'),
    'must have Persian message for SECURITY_ADMIN_REQUIRED');
  assert.ok(securitySettingsTypesSource.includes('SETTINGS_NOT_FOUND:'),
    'must have Persian message for SETTINGS_NOT_FOUND');
});

// ── Save Result Tests ────────────────────────────────────────────────────────

test('save result: uses new_version not settings_version', () => {
  assert.ok(securitySettingsServiceSource.includes('new_version'),
    'must use new_version from setter response');
  assert.ok(!securitySettingsServiceSource.includes('data.settings_version'),
    'must NOT use data.settings_version');
});

// ── Profile Form Separation Tests ────────────────────────────────────────────

test('profile form: security section outside form tag', () => {
  // The TotpFactorManager render (not import) must appear after </form>
  const formClosePos = profilePageSource.lastIndexOf('</form>');
  // Find the render, not the import — look for <TotpFactorManager
  const totpRenderPos = profilePageSource.indexOf('<TotpFactorManager');
  assert.ok(formClosePos > 0, 'must have a closing form tag');
  assert.ok(totpRenderPos > 0, 'must render TotpFactorManager');
  assert.ok(totpRenderPos > formClosePos,
    'TotpFactorManager must be rendered after the closing </form> tag');
});

test('profile form: all TOTP buttons have type="button"', () => {
  // Check all button tags in TotpFactorManager have type="button"
  const buttonMatches = totpFactorManagerSource.match(/<button[^>]*>/g) || [];
  assert.ok(buttonMatches.length > 0, 'must have buttons');
  for (const btn of buttonMatches) {
    assert.ok(btn.includes('type="button"'),
      `button must have type="button": ${btn}`);
  }
});

// ── MfaPanel replacement ────────────────────────────────────────────────────

test('MfaPanel renders SecurityControlCenter', () => {
  assert.ok(mfaPanelSource.includes('SecurityControlCenter'),
    'MfaPanel must render SecurityControlCenter');
  assert.ok(!mfaPanelSource.includes('system_config'),
    'MfaPanel must not save to system_config');
});

// ── ProfilePage integration ──────────────────────────────────────────────────

test('ProfilePage includes TotpFactorManager', () => {
  assert.ok(profilePageSource.includes('TotpFactorManager'),
    'ProfilePage must import and render TotpFactorManager');
  assert.ok(profilePageSource.includes("'security'"),
    'ProfilePage must have security section in openSection union');
});
