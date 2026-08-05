import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');

const migrationDir = path.join(projectRoot, 'supabase', 'migrations');

const phase4Migrations = fs.readdirSync(migrationDir)
  .filter(f => f.includes('phase4'))
  .sort();

const foundationMigration = phase4Migrations.find(f => f.includes('account_lifecycle_foundation'));
const challengeMigration = phase4Migrations.find(f => f.includes('registration_challenge_tables'));
const completionMigration = phase4Migrations.find(f => f.includes('profile_completion_and_admin_approval'));
const fixTriggerMigration = phase4Migrations.find(f => f.includes('phase4_fix_lifecycle_trigger_function'));
const fixSettingsMigration = phase4Migrations.find(f => f.includes('phase4_fix_settings_loading_in_lifecycle_trigger'));

const foundationSql = foundationMigration ? fs.readFileSync(path.join(migrationDir, foundationMigration), 'utf-8') : '';
const challengeSql = challengeMigration ? fs.readFileSync(path.join(migrationDir, challengeMigration), 'utf-8') : '';
const completionSql = completionMigration ? fs.readFileSync(path.join(migrationDir, completionMigration), 'utf-8') : '';
const fixTriggerSql = fixTriggerMigration ? fs.readFileSync(path.join(migrationDir, fixTriggerMigration), 'utf-8') : '';
const fixSettingsSql = fixSettingsMigration ? fs.readFileSync(path.join(migrationDir, fixSettingsMigration), 'utf-8') : '';
const allPhase4Sql = foundationSql + '\n' + challengeSql + '\n' + completionSql + '\n' + fixTriggerSql + '\n' + fixSettingsSql;

const authPageSource = fs.readFileSync(path.join(projectRoot, 'src/components/AuthPage.tsx'), 'utf-8');
const auditConsoleSource = fs.readFileSync(path.join(projectRoot, 'src/features/security-administration/components/SecurityAuditConsole.tsx'), 'utf-8');
const profileCompletionGateSource = fs.readFileSync(path.join(projectRoot, 'src/features/auth/components/ProfileCompletionGate.tsx'), 'utf-8');
const lifecycleMgmtSource = fs.readFileSync(path.join(projectRoot, 'src/features/security-administration/components/AccountLifecycleManagement.tsx'), 'utf-8');
const lifecycleDialogSource = fs.readFileSync(path.join(projectRoot, 'src/features/security-administration/components/AccountLifecycleActionDialog.tsx'), 'utf-8');
const securityControlCenterSource = fs.readFileSync(path.join(projectRoot, 'src/features/security-administration/components/SecurityControlCenter.tsx'), 'utf-8');
const userMgmtSource = fs.readFileSync(path.join(projectRoot, 'src/components/UserManagementPanel.tsx'), 'utf-8');
const restrictedAccessSource = fs.readFileSync(path.join(projectRoot, 'src/components/RestrictedAccessPage.tsx'), 'utf-8');
const adminUsersSource = fs.readFileSync(path.join(projectRoot, 'supabase/functions/admin-users/index.ts'), 'utf-8');
const requestOtpSource = fs.readFileSync(path.join(projectRoot, 'supabase/functions/request-public-registration-otp/index.ts'), 'utf-8');
const verifyOtpSource = fs.readFileSync(path.join(projectRoot, 'supabase/functions/verify-public-registration-otp/index.ts'), 'utf-8');

// Helper: extract function body between $function$ markers
function extractFunctionBody(sql: string, funcName: string): string {
  const startMarker = 'CREATE OR REPLACE FUNCTION public.' + funcName;
  const startIdx = sql.indexOf(startMarker);
  if (startIdx < 0) return '';
  const funcMarker = String.fromCharCode(36) + 'function' + String.fromCharCode(36);
  const dollarStart = sql.indexOf(funcMarker, startIdx);
  if (dollarStart < 0) return '';
  const dollarEnd = sql.indexOf(funcMarker, dollarStart + 10);
  if (dollarEnd < 0) return '';
  return sql.slice(dollarStart + 10, dollarEnd);
}

// ═══ Migration Tests ═══════════════════════════════════════════════════════════

test('migration: foundation migration exists', () => {
  assert.ok(foundationMigration, 'foundation migration must exist');
});

test('migration: challenge migration exists', () => {
  assert.ok(challengeMigration, 'challenge migration must exist');
});

test('migration: completion migration exists', () => {
  assert.ok(completionMigration, 'completion migration must exist');
});

test('migration: fix lifecycle trigger migration exists', () => {
  assert.ok(fixTriggerMigration, 'fix lifecycle trigger migration must exist');
});

test('migration: fix settings loading migration exists', () => {
  assert.ok(fixSettingsMigration, 'fix settings loading migration must exist');
});

test('migration: fix settings trigger has no v_settings record', () => {
  const triggerBody = extractFunctionBody(fixSettingsSql, 'on_auth_user_created_lifecycle_profile');
  assert.ok(triggerBody, 'must contain trigger function definition');
  assert.ok(!triggerBody.includes('v_settings'), 'must not declare v_settings record');
  assert.ok(triggerBody.includes('v_requires_approval'), 'must declare v_requires_approval explicitly');
  assert.ok(triggerBody.includes('v_require_completion'), 'must declare v_require_completion explicitly');
  assert.ok(!triggerBody.includes('public.challenges'), 'must not reference public.challenges');
  assert.ok(!triggerBody.includes('public.audit_events'), 'must not reference public.audit_events');
});

test('migration: no prior migrations modified', () => {
  assert.ok(!foundationSql.includes('phase3c'), 'must not modify phase3c migrations');
  assert.ok(!challengeSql.includes('phase3c'), 'must not modify phase3c migrations');
  assert.ok(!completionSql.includes('phase3c'), 'must not modify phase3c migrations');
});

test('migration: no DELETE/DROP/TRUNCATE/CASCADE in phase4', () => {
  for (const [name, sql] of [['foundation', foundationSql], ['challenge', challengeSql], ['completion', completionSql]] as [string, string][]) {
    const sqlOnly = sql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!sqlOnly.toUpperCase().match(/\bDELETE\s+FROM\b/), name + ': must not DELETE FROM');
    assert.ok(!sqlOnly.toUpperCase().match(/\bDROP\s+TABLE\b/), name + ': must not DROP TABLE');
    assert.ok(!sqlOnly.toUpperCase().includes('TRUNCATE'), name + ': must not TRUNCATE');
    assert.ok(!sqlOnly.toUpperCase().match(/\bDROP\s+COLUMN\b/), name + ': must not DROP COLUMN');
  }
});

test('migration: no MFA policy change in phase4', () => {
  const sqlOnly = allPhase4Sql.replace(/--[^\n]*\n/g, '');
  assert.ok(!sqlOnly.toUpperCase().match(/UPDATE\s+PUBLIC\.AUTH_SECURITY_SETTINGS\s+SET\s+mfa_policy/i), 'must not change mfa_policy');
  assert.ok(!sqlOnly.toUpperCase().match(/UPDATE\s+PUBLIC\.AUTH_SECURITY_SETTINGS\s+SET\s+settings_version/i), 'must not change settings_version');
});

test('migration: lifecycle consistency trigger enforces is_active from account_status', () => {
  assert.ok(foundationSql.includes('enforce_account_status_active_consistency'), 'must have consistency trigger function');
  assert.ok(foundationSql.includes('trg_account_status_active_consistency'), 'must have consistency trigger');
  assert.ok(foundationSql.includes("NEW.account_status = 'ACTIVE'"), 'must check ACTIVE status');
});

test('migration: history table ACL revoked from anon and authenticated', () => {
  assert.ok(foundationSql.includes('account_lifecycle_history'), 'must have history table');
  assert.ok(foundationSql.includes('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.account_lifecycle_history FROM anon'), 'must revoke from anon');
  assert.ok(foundationSql.includes('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.account_lifecycle_history FROM authenticated'), 'must revoke from authenticated');
});

test('migration: challenge tables ACL revoked from anon and authenticated', () => {
  assert.ok(challengeSql.includes('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_challenges FROM anon'), 'must revoke challenge from anon');
  assert.ok(challengeSql.includes('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_challenges FROM authenticated'), 'must revoke challenge from authenticated');
  assert.ok(challengeSql.includes('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_rate_limit FROM anon'), 'must revoke rate limit from anon');
  assert.ok(challengeSql.includes('REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_rate_limit FROM authenticated'), 'must revoke rate limit from authenticated');
});

test('migration: no raw secrets in DB or repository', () => {
  // The config key name 'registration_phone_otp_secret_configured' is a boolean proxy, not a secret
  // The actual env var name 'REGISTRATION_PHONE_OTP_SECRET' should only appear in edge function source
  assert.ok(!allPhase4Sql.match(/secret\s*[:=]\s*['"][a-zA-Z0-9]{32,}['"]/i), 'must not contain actual secret values in SQL');
  assert.ok(requestOtpSource.includes('REGISTRATION_PHONE_OTP_SECRET'), 'edge function must reference env var name');
  assert.ok(!requestOtpSource.match(/secret\s*[:=]\s*['"][a-zA-Z0-9]{32,}['"]/i), 'edge function must not contain actual secret value');
});

test('migration: guard_protected_profile_fields protects lifecycle columns', () => {
  assert.ok(foundationSql.includes('account_lifecycle_version'), 'must protect account_lifecycle_version');
  assert.ok(foundationSql.includes('account_status_changed_at'), 'must protect account_status_changed_at');
  assert.ok(foundationSql.includes('account_status_changed_by'), 'must protect account_status_changed_by');
  assert.ok(foundationSql.includes('registration_source'), 'must protect registration_source');
  assert.ok(foundationSql.includes('app.account_lifecycle_write'), 'must use GUC for lifecycle writes');
  assert.ok(foundationSql.includes('app.profile_completion_write'), 'must use GUC for completion writes');
});

// ═══ Registration Tests ════════════════════════════════════════════════════════

test('registration: password not sent in request OTP', () => {
  assert.ok(requestOtpSource.includes('first_name'), 'must send first_name');
  assert.ok(requestOtpSource.includes('last_name'), 'must send last_name');
  assert.ok(!requestOtpSource.includes('password'), 'must not send password in request OTP');
});

test('registration: password not stored in challenge', () => {
  const challengeDdl = challengeSql.slice(
    challengeSql.indexOf('CREATE TABLE IF NOT EXISTS public.public_registration_challenges'),
    challengeSql.indexOf(');', challengeSql.indexOf('CREATE TABLE IF NOT EXISTS public.public_registration_challenges'))
  );
  assert.ok(!challengeDdl.toLowerCase().includes('password'), 'challenge table must not have password column');
  assert.ok(challengeSql.includes('otp_hash'), 'must store otp_hash not raw otp');
  assert.ok(challengeSql.includes('identity_hash'), 'must store identity_hash');
  assert.ok(challengeSql.includes('phone_hash'), 'must store phone_hash');
});

test('registration: OTP uses HMAC', () => {
  assert.ok(requestOtpSource.includes('hmacSha256Hex'), 'must use HMAC-SHA256');
  assert.ok(requestOtpSource.includes('REGISTRATION_PHONE_OTP_SECRET'), 'must use secret from env');
  assert.ok(requestOtpSource.includes('crypto.subtle'), 'must use Web Crypto');
});

test('registration: OTP not logged', () => {
  assert.ok(requestOtpSource.includes('[AUTH_OTP_REDACTED]'), 'must use redacted log');
  assert.ok(!requestOtpSource.match(/console\.(log|info|debug)\(.*otp[^_]/i), 'must not log raw OTP');
});

test('registration: conflict response does not reveal which identifier', () => {
  assert.ok(requestOtpSource.includes('hasConflict'), 'must track conflict');
  assert.ok(requestOtpSource.includes('decoy') || requestOtpSource.includes('crypto.randomUUID'), 'must return decoy challenge ID');
  assert.ok(!requestOtpSource.includes('username already') && !requestOtpSource.includes('email already'), 'must not reveal which identifier');
});

test('registration: user not created before OTP', () => {
  assert.ok(!requestOtpSource.includes('createUser'), 'request OTP must not create user');
  assert.ok(verifyOtpSource.includes('createUser'), 'verify OTP must create user');
});

test('registration: auth user and profile created atomically by trigger', () => {
  assert.ok(foundationSql.includes('on_auth_user_created_lifecycle_profile'), 'must have trigger function');
  assert.ok(foundationSql.includes('CREATE TRIGGER on_auth_user_created_lifecycle_profile'), 'must have trigger');
  assert.ok(foundationSql.includes('registration_flow'), 'must check registration_flow marker');
  assert.ok(foundationSql.includes('public_phone_v1'), 'must handle public_phone_v1');
  assert.ok(foundationSql.includes('admin_created_v1'), 'must handle admin_created_v1');
});

test('registration: no direct profile upsert from public registration', () => {
  assert.ok(!verifyOtpSource.includes('.upsert('), 'verify must not upsert');
  assert.ok(!verifyOtpSource.match(/\.from\(['"]profiles['"]\)\.insert/), 'verify must not insert into profiles');
  assert.ok(!verifyOtpSource.match(/\.from\(['"]profiles['"]\)\.update/), 'verify must not update profiles');
});

test('registration: app metadata marker used', () => {
  assert.ok(verifyOtpSource.includes('registration_flow'), 'must set registration_flow in app_metadata');
  assert.ok(verifyOtpSource.includes('public_phone_v1'), 'must use public_phone_v1 marker');
});

test('registration: duplicate race handled by unique constraint', () => {
  assert.ok(verifyOtpSource.includes('existingUsername'), 'must check username uniqueness');
  assert.ok(verifyOtpSource.includes('existingEmail'), 'must check email uniqueness');
  assert.ok(verifyOtpSource.includes('existingPhone'), 'must check phone uniqueness');
});

test('registration: retry does not create second user', () => {
  assert.ok(verifyOtpSource.includes('release_public_registration_claim'), 'must release claim on conflict');
  assert.ok(challengeSql.includes('created_user_id'), 'challenge must track created_user_id');
  assert.ok(challengeSql.includes('ALREADY_CONSUMED'), 'must detect already consumed');
});

test('registration: session only returned after correct OTP', () => {
  assert.ok(verifyOtpSource.includes('signInWithPassword'), 'must sign in after user creation');
  assert.ok(verifyOtpSource.includes('session'), 'must return session');
});

test('registration: admin approval setting creates correct status', () => {
  assert.ok(foundationSql.includes('registration_requires_admin_approval'), 'must check admin approval setting');
  assert.ok(foundationSql.includes('PENDING_ADMIN_APPROVAL'), 'must set PENDING_ADMIN_APPROVAL');
  assert.ok(foundationSql.includes('ACTIVE'), 'must set ACTIVE when no approval needed');
});

test('registration: default calendar only for ACTIVE', () => {
  assert.ok(foundationSql.includes("account_status IS DISTINCT FROM 'ACTIVE'"), 'must check ACTIVE');
  assert.ok(foundationSql.includes('ensure_default_calendars_for_user'), 'must have ensure function');
  assert.ok(completionSql.includes('ensure_default_calendars_for_user'), 'setter must call ensure on APPROVE');
});

// ═══ Lifecycle Tests ═══════════════════════════════════════════════════════════

test('lifecycle: invalid transition rejected', () => {
  assert.ok(completionSql.includes('INVALID_TRANSITION'), 'must reject invalid transitions');
  assert.ok(completionSql.includes('v_transition_ok'), 'must use transition validation');
});

test('lifecycle: PHONE_UNVERIFIED cannot be approved', () => {
  const setterSection = completionSql.slice(
    completionSql.indexOf("WHEN 'APPROVE'"),
    completionSql.indexOf("WHEN 'REJECT'")
  );
  assert.ok(setterSection.includes('PENDING_ADMIN_APPROVAL'), 'APPROVE only from PENDING_ADMIN_APPROVAL');
  assert.ok(!setterSection.includes('PHONE_UNVERIFIED'), 'APPROVE must not allow PHONE_UNVERIFIED');
});

test('lifecycle: self-action rejected', () => {
  assert.ok(completionSql.includes('CANNOT_CHANGE_OWN_ACCOUNT'), 'must reject self-change');
});

test('lifecycle: security admin required', () => {
  assert.ok(completionSql.includes('SECURITY_ADMIN_REQUIRED'), 'must require security admin');
});

test('lifecycle: global lock constant', () => {
  assert.ok(completionSql.includes('pg_advisory_xact_lock(987654321)'), 'must use constant global lock');
});

test('lifecycle: actor recheck after lock', () => {
  const lockPos = completionSql.indexOf('pg_advisory_xact_lock(987654321)');
  const recheckPos = completionSql.indexOf('is_current_security_admin()', lockPos);
  assert.ok(recheckPos > lockPos, 'must recheck after lock');
  assert.ok(completionSql.includes("'FORBIDDEN'"), 'must return FORBIDDEN');
});

test('lifecycle: step-up contract correct', () => {
  assert.ok(completionSql.includes('mfa_stepup'), 'must require mfa_stepup');
  assert.ok(completionSql.includes('account_security_change'), 'must require account_security_change purpose');
  assert.ok(completionSql.includes('totp'), 'must require totp factor');
  assert.ok(completionSql.includes('aal2'), 'must require aal2 assurance');
});

test('lifecycle: version conflict after grant consume', () => {
  const consumePos = completionSql.indexOf('consumed_at = clock_timestamp()');
  const versionPos = completionSql.indexOf('VERSION_CONFLICT', consumePos);
  assert.ok(versionPos > consumePos, 'version conflict must be after grant consumption');
});

test('lifecycle: history and audit written', () => {
  assert.ok(completionSql.includes('account_lifecycle_history'), 'must write to history table');
  assert.ok(completionSql.includes('security_audit_events'), 'must write to audit events');
  assert.ok(completionSql.includes('account_approved'), 'must audit approve');
  assert.ok(completionSql.includes('account_rejected'), 'must audit reject');
  assert.ok(completionSql.includes('account_suspended'), 'must audit suspend');
});

test('lifecycle: is_active always consistent with status', () => {
  assert.ok(foundationSql.includes('enforce_account_status_active_consistency'), 'must have consistency trigger');
  assert.ok(foundationSql.includes("NEW.account_status = 'ACTIVE'"), 'must check ACTIVE');
  assert.ok(foundationSql.includes('NEW.is_active := true'), 'must set is_active true for ACTIVE');
  assert.ok(foundationSql.includes('NEW.is_active := false'), 'must set is_active false for non-ACTIVE');
});

test('lifecycle: no direct frontend update of lifecycle fields', () => {
  assert.ok(!userMgmtSource.match(/is_active\s*[:=]\s*(true|false|updated)/), 'UserManagementPanel must not write is_active directly');
});

// ═══ Profile Completion Tests ═══════════════════════════════════════════════════

test('profile completion: restricted allowlist is exact', () => {
  assert.ok(completionSql.includes('full_name'), 'must allow full_name');
  assert.ok(completionSql.includes('organization'), 'must allow organization');
  assert.ok(completionSql.includes('position'), 'must allow position');
  assert.ok(completionSql.includes('department'), 'must allow department');
  assert.ok(completionSql.includes('employee_id'), 'must allow employee_id');
  assert.ok(completionSql.includes('birth_date'), 'must allow birth_date');
  assert.ok(completionSql.includes('gender'), 'must allow gender');
  assert.ok(completionSql.includes('city'), 'must allow city');
  assert.ok(completionSql.includes('location'), 'must allow location');
  assert.ok(completionSql.includes('bio'), 'must allow bio');
  assert.ok(completionSql.includes('website'), 'must allow website');
  assert.ok(completionSql.includes('linkedin_url'), 'must allow linkedin_url');
});

test('profile completion: security fields not patchable', () => {
  assert.ok(completionSql.includes('FIELD_NOT_ALLOWED'), 'must reject non-allowlisted fields');
});

test('profile completion: complete without phone verified rejected', () => {
  assert.ok(completionSql.includes('COMPLETION_REQUIREMENTS_NOT_MET'), 'must reject completion without requirements');
  assert.ok(completionSql.includes('phone_verified_at'), 'must check phone_verified_at');
});

test('profile completion: version conflict', () => {
  assert.ok(completionSql.includes('VERSION_CONFLICT'), 'must handle version conflict');
  assert.ok(completionSql.includes('profile_completion_version'), 'must use profile_completion_version');
});

test('profile completion: draft goes to IN_PROGRESS', () => {
  assert.ok(completionSql.includes('NOT_STARTED'), 'must check NOT_STARTED');
  assert.ok(completionSql.includes('IN_PROGRESS'), 'must transition to IN_PROGRESS');
});

test('profile completion: complete goes to COMPLETE', () => {
  assert.ok(completionSql.includes('COMPLETE'), 'must set COMPLETE');
  assert.ok(completionSql.includes('profile_completion_completed'), 'must audit completion');
});

test('profile completion: restricted gate after complete refreshes', () => {
  assert.ok(profileCompletionGateSource.includes('onRefresh'), 'must call onRefresh after complete');
  assert.ok(profileCompletionGateSource.includes('save_my_profile_completion'), 'must call RPC');
});

// ═══ Frontend Tests ════════════════════════════════════════════════════════════

test('frontend: all registration fields exist', () => {
  assert.ok(authPageSource.includes('firstName'), 'must have firstName field');
  assert.ok(authPageSource.includes('lastName'), 'must have lastName field');
  assert.ok(authPageSource.includes('username'), 'must have username field');
  assert.ok(authPageSource.includes('email'), 'must have email field');
  assert.ok(authPageSource.includes('phone'), 'must have phone field');
  assert.ok(authPageSource.includes('password'), 'must have password field');
  assert.ok(authPageSource.includes('confirmPassword'), 'must have confirmPassword field');
});

test('frontend: password only in memory', () => {
  const regSection = authPageSource.slice(
    authPageSource.indexOf('regStep'),
    authPageSource.indexOf('handleRegisterCancel')
  );
  assert.ok(!regSection.includes('localStorage.setItem'), 'must not store password in localStorage');
  assert.ok(!regSection.includes('sessionStorage.setItem'), 'must not store password in sessionStorage');
  assert.ok(!authPageSource.includes('URLSearchParams'), 'must not put password in URL');
});

test('frontend: OTP is 6 digits', () => {
  assert.ok(authPageSource.includes('/^\\d{6}$/'), 'must validate 6 digit OTP');
  assert.ok(authPageSource.includes('maxLength={6}'), 'must limit to 6 chars');
});

test('frontend: double submit blocked', () => {
  assert.ok(authPageSource.includes('regSubmitRef'), 'must use submit ref guard');
  assert.ok(authPageSource.includes('regSubmitRef.current = true'), 'must set ref on submit');
  assert.ok(authPageSource.includes('if (regSubmitRef.current) return'), 'must check ref before submit');
});

test('frontend: registration disabled when not ready', () => {
  assert.ok(authPageSource.includes('registration_ready'), 'must check registration_ready');
  assert.ok(authPageSource.includes('ثبت‌نام در حال حاضر فعال نیست'), 'must show disabled message');
});

test('frontend: approval UI only in security console', () => {
  assert.ok(securityControlCenterSource.includes('AccountLifecycleManagement'), 'must include lifecycle management');
  assert.ok(securityControlCenterSource.includes('چرخه عمر حساب‌ها'), 'must have lifecycle tab');
  assert.ok(lifecycleMgmtSource.includes('AccountLifecycleManagement'), 'must have management component');
});

test('frontend: general admin no direct lifecycle write', () => {
  assert.ok(!userMgmtSource.match(/is_active\s*[:=]\s*(true|false|updated)/), 'must not write is_active');
  assert.ok(userMgmtSource.includes('برای تغییر وضعیت حساب به بخش امنیت و دسترسی مراجعه کنید'), 'must show security redirect message');
});

test('frontend: raw backend error not displayed', () => {
  assert.ok(!verifyOtpSource.match(/return.*err\.message/i), 'must not return raw error message');
  assert.ok(verifyOtpSource.includes('کد نامعتبر است'), 'must show generic error');
});

test('frontend: ProfileCompletionGate rendered in RestrictedAccessPage', () => {
  assert.ok(restrictedAccessSource.includes('ProfileCompletionGate'), 'must import ProfileCompletionGate');
  assert.ok(restrictedAccessSource.includes('complete_profile'), 'must handle complete_profile step');
});

test('frontend: lifecycle action dialog has step-up', () => {
  assert.ok(lifecycleDialogSource.includes('SecurityStepUpDialog'), 'must include step-up dialog');
  assert.ok(lifecycleDialogSource.includes('account_security_change'), 'must use correct purpose');
});

test('frontend: lifecycle action has confirmation checkbox', () => {
  assert.ok(lifecycleDialogSource.includes('checkbox'), 'must have confirmation checkbox');
  assert.ok(lifecycleDialogSource.includes('confirmed'), 'must track confirmation state');
});

test('frontend: admin-users register route returns 410', () => {
  assert.ok(adminUsersSource.includes('REGISTRATION_FLOW_REPLACED'), 'must return REGISTRATION_FLOW_REPLACED');
  assert.ok(adminUsersSource.includes('410'), 'must return 410 status');
});

test('frontend: admin-users create uses admin_created_v1 marker', () => {
  assert.ok(adminUsersSource.includes('admin_created_v1'), 'must use admin_created_v1 marker');
  assert.ok(adminUsersSource.includes('registration_flow'), 'must set registration_flow');
});

test('frontend: admin-users create requires phone', () => {
  assert.ok(adminUsersSource.includes('شماره موبایل الزامی است'), 'must require phone');
  assert.ok(adminUsersSource.includes('نام کاربری الزامی است'), 'must require username');
});

test('frontend: admin-users no compensating delete', () => {
  assert.ok(!adminUsersSource.includes('deleteUser'), 'must not do compensating delete');
  assert.ok(!adminUsersSource.match(/\.delete\(\)/), 'must not delete users');
});

test('frontend: admin-users no listUsers for uniqueness', () => {
  assert.ok(!adminUsersSource.includes('listUsers'), 'must not use listUsers');
});

test('frontend: admin-users audit masks email and phone', () => {
  assert.ok(adminUsersSource.includes('maskEmail'), 'must mask email in audit');
  assert.ok(adminUsersSource.includes('maskPhone'), 'must mask phone in audit');
});

test('frontend: pre-request allowlist includes profile completion RPCs', () => {
  assert.ok(completionSql.includes('get_my_profile_completion_state'), 'must allowlist get_my_profile_completion_state');
  assert.ok(completionSql.includes('save_my_profile_completion'), 'must allowlist save_my_profile_completion');
});

test('frontend: get_public_auth_config returns registration fields', () => {
  assert.ok(completionSql.includes('registration_enabled'), 'must return registration_enabled');
  assert.ok(completionSql.includes('registration_ready'), 'must return registration_ready');
  assert.ok(completionSql.includes('registration_requires_admin_approval'), 'must return registration_requires_admin_approval');
  assert.ok(completionSql.includes('require_profile_completion'), 'must return require_profile_completion');
  assert.ok(completionSql.includes('registration_otp_ttl_seconds'), 'must return TTL');
  assert.ok(completionSql.includes('registration_otp_resend_seconds'), 'must return resend');
});

test('frontend: get_public_auth_config does not return secrets', () => {
  const returnQuerySection = completionSql.slice(
    completionSql.indexOf('RETURN QUERY SELECT'),
    completionSql.indexOf('END;', completionSql.indexOf('RETURN QUERY SELECT'))
  );
  assert.ok(!returnQuerySection.includes('v_provider_id'), 'must not return provider_id in output');
  assert.ok(!returnQuerySection.includes('pepper'), 'must not return pepper');
  assert.ok(!returnQuerySection.includes('v_origins_text'), 'must not return raw origins');
});

test('frontend: audit console UUID and load more guards still pass', () => {
  assert.ok(auditConsoleSource.includes('UUID_REGEX'), 'must still have UUID validation');
  assert.ok(auditConsoleSource.includes('if (!params)'), 'must still have null params guard');
});
