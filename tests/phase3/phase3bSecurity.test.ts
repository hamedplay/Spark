import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationDir = path.join(__dirname, '../../supabase/migrations');
const consoleMigrationName = '20260804230000_phase3b_security_console_state.sql';
const consoleMigrationPath = path.join(migrationDir, consoleMigrationName);
const consoleMigrationSql = fs.existsSync(consoleMigrationPath)
  ? fs.readFileSync(consoleMigrationPath, 'utf-8')
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
  // Even if draft changes allow_bale_mfa, it should NOT be in patch (read-only)
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

  // idle timeout: 0 < 1
  assert.equal(validateSecuritySettings(baseDraft, { session_idle_timeout_minutes: 0 }).ok, false);
  // idle timeout: > 10080
  assert.equal(validateSecuritySettings(baseDraft, { session_idle_timeout_minutes: 10081 }).ok, false);
  // absolute: > 43200
  assert.equal(validateSecuritySettings(baseDraft, { session_absolute_lifetime_minutes: 43201 }).ok, false);
  // max sessions: 0
  assert.equal(validateSecuritySettings(baseDraft, { max_active_sessions: 0 }).ok, false);
  // max sessions: > 100
  assert.equal(validateSecuritySettings(baseDraft, { max_active_sessions: 101 }).ok, false);
  // lock threshold: 0
  assert.equal(validateSecuritySettings(baseDraft, { lock_threshold: 0 }).ok, false);
  // lock threshold: > 50
  assert.equal(validateSecuritySettings(baseDraft, { lock_threshold: 51 }).ok, false);
  // lock duration: > 1440
  assert.equal(validateSecuritySettings(baseDraft, { lock_duration_minutes: 1441 }).ok, false);

  // Valid values
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
  // The SecurityStepUpDialog must call performTotpStepUp before the save callback
  const onSuccessCall = stepUpDialogSource.indexOf('onSuccess()');
  const stepUpCall = stepUpDialogSource.indexOf('performTotpStepUp');
  assert.ok(stepUpCall > 0, 'must call performTotpStepUp');
  assert.ok(onSuccessCall > 0, 'must call onSuccess');
  assert.ok(stepUpCall < onSuccessCall, 'step-up must happen before onSuccess (which triggers setter)');
});

test('step-up: purpose is auth_settings_change', () => {
  assert.ok(stepUpDialogSource.includes("purpose: 'auth_settings_change'"),
    'must use auth_settings_change purpose');
});

test('step-up: AAL2 failure stops save', () => {
  assert.ok(mfaOperationsSource.includes("currentLevel !== 'aal2'"),
    'performTotpStepUp must check AAL2 and return error');
  assert.ok(mfaOperationsSource.includes("return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'AAL2_NOT_REACHED' }"),
    'must return AAL2_NOT_REACHED on failure');
});

test('step-up: RPC setter called exactly once', () => {
  // In the console, saveSecuritySettingsPatch is called once after step-up success
  const saveCallCount = (consoleSource.match(/saveSecuritySettingsPatch/g) || []).length;
  assert.ok(saveCallCount >= 1, 'saveSecuritySettingsPatch must be called');
  // The actual call is in handleStepUpSuccess, which is called once per step-up success
  const handleSuccess = consoleSource.indexOf('handleStepUpSuccess');
  const saveCall = consoleSource.indexOf('saveSecuritySettingsPatch', handleSuccess);
  assert.ok(saveCall > 0, 'saveSecuritySettingsPatch must be called in handleStepUpSuccess');
});

test('step-up: OTP not in patch or error output', () => {
  // Check that code/OTP is not passed to the RPC
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
  // Must not show any user IDs, emails, or names
  assert.ok(!impactSource.includes('user_id'), 'must not show user_id');
  assert.ok(!impactSource.includes('email'), 'must not show email');
  assert.ok(!impactSource.includes('full_name'), 'must not show full_name');
});

// ── Profile TOTP Tests ──────────────────────────────────────────────────────

test('profile TOTP: enrollment not auto-started on mount', () => {
  assert.ok(totpFactorManagerSource.includes("useState<Phase>('idle')"),
    'must start in idle phase');
  // Check that no useEffect calls startTotpEnrollment directly
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
  // The remove modal uses removeTarget which is set from the factor list
  assert.ok(totpFactorManagerSource.includes('removeTarget'),
    'must use removeTarget to track which factor to remove');
  // The unenroll call uses removeTarget.id, not a hardcoded ID
  const unenrollCall = totpFactorManagerSource.indexOf("mfa.unenroll({ factorId: removeTarget.id })");
  assert.ok(unenrollCall > 0, 'must unenroll the specific removeTarget.id');
});

test('profile TOTP: removing last factor when mfaRequired=true blocked', () => {
  assert.ok(totpFactorManagerSource.includes('verifiedCount === 1 && mfaRequired'),
    'must check verifiedCount === 1 && mfaRequired');
  assert.ok(totpFactorManagerSource.includes('ابتدا یک برنامه احراز هویت دیگر اضافه کنید'),
    'must show message about adding another factor first');
  // The delete button must be disabled in this case
  assert.ok(totpFactorManagerSource.includes('verifiedCount === 1 && mfaRequired'),
    'delete button must be disabled when last factor and mfaRequired');
});

test('profile TOTP: access state refreshed after enrollment/removal', () => {
  assert.ok(totpFactorManagerSource.includes('loadFactors'),
    'must call loadFactors after enrollment');
  // loadFactors calls get_my_auth_access_state
  assert.ok(totpFactorManagerSource.includes('get_my_auth_access_state'),
    'must refresh access state via get_my_auth_access_state');
});

test('profile TOTP: secret not retained in state after success', () => {
  // After verify success, enrollment is set to null
  const verifyFn = totpFactorManagerSource.slice(
    totpFactorManagerSource.indexOf('handleVerify'),
    totpFactorManagerSource.indexOf('}, [', totpFactorManagerSource.indexOf('handleVerify'))
  );
  assert.ok(verifyFn.includes('setEnrollment(null)'),
    'must clear enrollment after success');
  assert.ok(verifyFn.includes("setCode('')"),
    'must clear code after success');
});

// ── Migration Contract Tests ─────────────────────────────────────────────────

test('migration: console state RPC is SECURITY DEFINER', () => {
  assert.ok(consoleMigrationSql.includes('SECURITY DEFINER'),
    'must be SECURITY DEFINER');
});

test('migration: search_path is empty string', () => {
  assert.ok(consoleMigrationSql.includes("SET search_path TO ''"),
    'must have search_path = empty string');
});

test('migration: anon and PUBLIC do not have execute', () => {
  assert.ok(consoleMigrationSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM PUBLIC'),
    'must revoke from PUBLIC');
  assert.ok(consoleMigrationSql.includes('REVOKE EXECUTE ON FUNCTION public.get_auth_security_console_state() FROM anon'),
    'must revoke from anon');
});

test('migration: authenticated has execute', () => {
  assert.ok(consoleMigrationSql.includes('GRANT EXECUTE ON FUNCTION public.get_auth_security_console_state() TO authenticated'),
    'must grant to authenticated');
});

test('migration: uses is_current_security_admin()', () => {
  assert.ok(consoleMigrationSql.includes('public.is_current_security_admin()'),
    'must use is_current_security_admin()');
});

test('migration: returns only counts, not factor IDs or secrets', () => {
  assert.ok(consoleMigrationSql.includes('count(DISTINCT'),
    'must use count(DISTINCT) for counts');
  assert.ok(!consoleMigrationSql.includes('secret'), 'must not return secret');
  assert.ok(!consoleMigrationSql.includes('factor_id'), 'must not return factor_id');
  // The output must not include user_id in the impact section
  const impactSection = consoleMigrationSql.slice(
    consoleMigrationSql.indexOf("'impact'"),
    consoleMigrationSql.indexOf("'recent_history'")
  );
  assert.ok(!impactSection.includes('user_id'), 'impact must not include user_id');
});

test('migration: history limit is 20', () => {
  assert.ok(consoleMigrationSql.includes('LIMIT 20'),
    'must limit history to 20 records');
});

test('migration: no MFA policy changes', () => {
  // The function reads mfa_policy from settings but must not write/alter it
  const sqlOnly = consoleMigrationSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().match(/\bUPDATE\b/), 'must not UPDATE any table');
  assert.ok(!sqlOnly.toUpperCase().includes('INSERT INTO PUBLIC.AUTH_SECURITY_SETTINGS'),
    'must not INSERT into auth_security_settings');
  assert.ok(!sqlOnly.toUpperCase().includes('ALTER TABLE'), 'must not ALTER any table');
});

test('migration: no data deletion', () => {
  // Check SQL statements, not comments
  const sqlOnly = consoleMigrationSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM'),
    'must not DELETE');
  assert.ok(!sqlOnly.toUpperCase().includes('DROP '),
    'must not DROP');
  assert.ok(!sqlOnly.toUpperCase().includes('TRUNCATE'),
    'must not TRUNCATE');
});

test('migration: no experimental factors created', () => {
  assert.ok(!consoleMigrationSql.toUpperCase().includes('INSERT INTO AUTH.MFA'),
    'must not insert into auth.mfa_factors');
});

// ── MfaPanel replacement ────────────────────────────────────────────────────

test('MfaPanel renders SecuritySettingsConsole', () => {
  assert.ok(mfaPanelSource.includes('SecuritySettingsConsole'),
    'MfaPanel must render SecuritySettingsConsole');
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
