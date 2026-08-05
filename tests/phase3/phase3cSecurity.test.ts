import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationDir = path.join(__dirname, '../../supabase/migrations');

const allMigrations = fs.readdirSync(migrationDir);

const phase3cMigrations = allMigrations.filter((f) => f.includes('phase3c'));

const appliedMigrationName = '20260805034152_20260804200000_phase3c_security_admin_and_audit_console.sql.sql';
const appliedMigrationPath = path.join(migrationDir, appliedMigrationName);
const appliedMigrationSql = fs.existsSync(appliedMigrationPath)
  ? fs.readFileSync(appliedMigrationPath, 'utf-8')
  : '';

const consoleSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/components/SecurityControlCenter.tsx'),
  'utf-8',
);

const adminMgmtSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/components/SecurityAdminManagement.tsx'),
  'utf-8',
);

const roleDialogSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/components/SecurityAdminRoleDialog.tsx'),
  'utf-8',
);

const auditConsoleSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/components/SecurityAuditConsole.tsx'),
  'utf-8',
);

const auditDetailsSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/components/SecurityAuditDetails.tsx'),
  'utf-8',
);

const stepUpDialogSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/components/SecurityStepUpDialog.tsx'),
  'utf-8',
);

const serviceSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/services/securityAdministrationService.ts'),
  'utf-8',
);

const mfaPanelSource = fs.readFileSync(
  path.join(__dirname, '../../src/components/PortalConfig/MfaPanel.tsx'),
  'utf-8',
);

const settingsConsoleSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-settings/components/SecuritySettingsConsole.tsx'),
  'utf-8',
);

const userMgmtPanelSource = fs.existsSync(
  path.join(__dirname, '../../src/components/UserManagementPanel.tsx')
)
  ? fs.readFileSync(path.join(__dirname, '../../src/components/UserManagementPanel.tsx'), 'utf-8')
  : '';

const auditLogPageSource = fs.existsSync(
  path.join(__dirname, '../../src/components/AuditLogPage.tsx')
)
  ? fs.readFileSync(path.join(__dirname, '../../src/components/AuditLogPage.tsx'), 'utf-8')
  : '';

const validationSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/utils/securityAdministrationValidation.ts'),
  'utf-8',
);

const typesSource = fs.readFileSync(
  path.join(__dirname, '../../src/features/security-administration/types/securityAdministration.ts'),
  'utf-8',
);

// ── Migration Tests ──────────────────────────────────────────────────────────

test('migration: exactly one phase3c migration exists', () => {
  assert.equal(phase3cMigrations.length, 1,
    `expected exactly 1 phase3c migration, found ${phase3cMigrations.length}: ${phase3cMigrations.join(', ')}`);
});

test('migration: applied file has exact name with version prefix', () => {
  assert.ok(fs.existsSync(appliedMigrationPath),
    `applied migration must be named ${appliedMigrationName}`);
});

test('migration: no pending phase3c file without applied version prefix', () => {
  for (const f of phase3cMigrations) {
    assert.ok(f.match(/^\d{14}_\d{8}.*\.sql\.sql$/),
      `migration file must have applied prefix pattern: ${f}`);
  }
});

test('migration: SECURITY DEFINER in applied file', () => {
  assert.ok(appliedMigrationSql.includes('SECURITY DEFINER'),
    'must contain SECURITY DEFINER');
});

test('migration: search_path empty string in applied file', () => {
  assert.ok(appliedMigrationSql.includes("SET search_path = ''") || appliedMigrationSql.includes("search_path=''"),
    'must have search_path empty string');
});

test('migration: revokes from PUBLIC and anon', () => {
  assert.ok(appliedMigrationSql.includes('REVOKE EXECUTE') || appliedMigrationSql.includes('REVOKE SELECT'),
    'must contain REVOKE statements');
});

test('migration: grants to authenticated', () => {
  assert.ok(appliedMigrationSql.includes('GRANT EXECUTE') && appliedMigrationSql.includes('authenticated'),
    'must grant execute to authenticated');
});

test('migration: contains required indexes', () => {
  assert.ok(appliedMigrationSql.includes('idx_security_audit_events_created_id'),
    'must have index on (created_at DESC, id DESC)');
  assert.ok(appliedMigrationSql.includes('idx_security_audit_events_actor_created'),
    'must have index on (actor_user_id, created_at DESC)');
  assert.ok(appliedMigrationSql.includes('idx_security_audit_events_target_created'),
    'must have index on (target_user_id, created_at DESC)');
  assert.ok(appliedMigrationSql.includes('idx_security_admin_role_history_changed_id'),
    'must have index on (changed_at DESC, id DESC)');
  assert.ok(appliedMigrationSql.includes('idx_security_admin_role_history_target_changed'),
    'must have index on (target_user_id, changed_at DESC)');
  assert.ok(appliedMigrationSql.includes('idx_security_admin_role_history_actor_changed'),
    'must have index on (actor_user_id, changed_at DESC)');
});

test('migration: no DELETE/DROP/TRUNCATE/CASCADE', () => {
  const sqlOnly = appliedMigrationSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM'),
    'must not DELETE');
  assert.ok(!sqlOnly.toUpperCase().includes('DROP '),
    'must not DROP');
  assert.ok(!sqlOnly.toUpperCase().includes('TRUNCATE'),
    'must not TRUNCATE');
  assert.ok(!sqlOnly.toUpperCase().includes('CASCADE'),
    'must not CASCADE');
});

test('migration: no MFA policy change', () => {
  const sqlOnly = appliedMigrationSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().match(/UPDATE\s+PUBLIC\.AUTH_SECURITY_SETTINGS/),
    'must not UPDATE auth_security_settings');
  assert.ok(!sqlOnly.toUpperCase().includes('INSERT INTO PUBLIC.AUTH_SECURITY_SETTINGS'),
    'must not INSERT into auth_security_settings');
});

test('migration: revokes SELECT on sensitive tables', () => {
  assert.ok(appliedMigrationSql.includes('REVOKE SELECT ON public.security_audit_events FROM anon'),
    'must revoke SELECT on security_audit_events from anon');
  assert.ok(appliedMigrationSql.includes('REVOKE SELECT ON public.security_audit_events FROM authenticated'),
    'must revoke SELECT on security_audit_events from authenticated');
  assert.ok(appliedMigrationSql.includes('REVOKE SELECT ON public.security_admin_role_history FROM anon'),
    'must revoke SELECT on security_admin_role_history from anon');
  assert.ok(appliedMigrationSql.includes('REVOKE SELECT ON public.security_admin_role_history FROM authenticated'),
    'must revoke SELECT on security_admin_role_history from authenticated');
  assert.ok(appliedMigrationSql.includes('REVOKE SELECT ON public.session_security_grants FROM anon'),
    'must revoke SELECT on session_security_grants from anon');
});

// ── Setter Tests ──────────────────────────────────────────────────────────────

test('setter: no direct profile update in frontend', () => {
  assert.ok(!serviceSource.includes("from('profiles')"),
    'service must not query profiles directly');
  assert.ok(!adminMgmtSource.includes("from('profiles')"),
    'admin management must not query profiles directly');
});

test('setter: uses is_current_security_admin in migration', () => {
  assert.ok(appliedMigrationSql.includes('public.is_current_security_admin()'),
    'setter must use is_current_security_admin()');
});

test('setter: self-change blocked', () => {
  assert.ok(appliedMigrationSql.includes('CANNOT_CHANGE_OWN_SECURITY_ADMIN'),
    'must block self-change');
});

test('setter: grant to inactive target rejected', () => {
  assert.ok(appliedMigrationSql.includes('TARGET_NOT_ELIGIBLE'),
    'must reject grant to inactive target');
});

test('setter: grant to target without TOTP rejected', () => {
  assert.ok(appliedMigrationSql.includes('TARGET_TOTP_REQUIRED'),
    'must reject grant to target without TOTP');
});

test('setter: revoke from inactive target allowed', () => {
  // The revoke path must check is_security_admin before blocking
  // The last-admin protection must only apply to active+ACTIVE targets
  // Check that the last-admin check is scoped to active+ACTIVE
  const lastAdminBlock = appliedMigrationSql.indexOf('CANNOT_REMOVE_LAST_SECURITY_ADMIN');
  assert.ok(lastAdminBlock > 0, 'must have CANNOT_REMOVE_LAST_SECURITY_ADMIN');
  // Look backwards from the error for the condition
  const beforeLastAdmin = appliedMigrationSql.slice(Math.max(0, lastAdminBlock - 500), lastAdminBlock);
  assert.ok(beforeLastAdmin.includes('is_active') && beforeLastAdmin.includes('ACTIVE'),
    'last admin protection must only apply to active+ACTIVE targets');
  // The revoke section must check is_security_admin
  const revokeBlock = appliedMigrationSql.indexOf('NO_EFFECTIVE_CHANGE');
  assert.ok(revokeBlock > 0, 'must have NO_EFFECTIVE_CHANGE');
  const beforeRevoke = appliedMigrationSql.slice(Math.max(0, revokeBlock - 300), revokeBlock);
  assert.ok(beforeRevoke.includes('is_security_admin'),
    'revoke must check if target is security admin');
});

test('setter: last active admin protection', () => {
  assert.ok(appliedMigrationSql.includes('CANNOT_REMOVE_LAST_SECURITY_ADMIN'),
    'must protect last active security admin');
});

test('setter: version conflict', () => {
  assert.ok(appliedMigrationSql.includes('VERSION_CONFLICT'),
    'must return VERSION_CONFLICT');
  assert.ok(appliedMigrationSql.includes('current_version'),
    'must return current_version in conflict');
});

test('setter: reason mandatory 10..500', () => {
  assert.ok(appliedMigrationSql.includes('CHANGE_REASON_REQUIRED'),
    'must require change reason');
  assert.ok(appliedMigrationSql.includes('CHANGE_REASON_TOO_SHORT'),
    'must reject short reason');
  assert.ok(appliedMigrationSql.includes('CHANGE_REASON_TOO_LONG'),
    'must reject long reason');
  // Check the 10 and 500 thresholds
  assert.ok(appliedMigrationSql.includes('< 10'),
    'must check minimum 10 chars');
  assert.ok(appliedMigrationSql.includes('> 500'),
    'must check maximum 500 chars');
});

test('setter: purpose is account_security_change', () => {
  assert.ok(appliedMigrationSql.includes("'account_security_change'"),
    'must use account_security_change purpose');
});

test('setter: only TOTP/AAL2 grant accepted', () => {
  assert.ok(appliedMigrationSql.includes("factor_type = 'totp'"),
    'must require TOTP factor type');
  assert.ok(appliedMigrationSql.includes("assurance_level = 'aal2'"),
    'must require AAL2 assurance level');
  assert.ok(appliedMigrationSql.includes("grant_type = 'mfa_stepup'"),
    'must require mfa_stepup grant type');
});

test('setter: grant consumed once via consumed_at', () => {
  assert.ok(appliedMigrationSql.includes('SET consumed_at = clock_timestamp()'),
    'must consume grant via consumed_at');
  // Must NOT delete the grant
  const sqlOnly = appliedMigrationSql.replace(/--[^\n]*\n/g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM PUBLIC.SESSION_SECURITY_GRANTS'),
    'must NOT DELETE grants');
});

// ── Read Model Tests ─────────────────────────────────────────────────────────

test('read model: phone and national_id not returned', () => {
  const mgmtRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_admin_management_state'),
    appliedMigrationSql.indexOf('get_security_audit_page')
  );
  assert.ok(!mgmtRpc.includes('phone'),
    'must not return phone');
  assert.ok(!mgmtRpc.includes('national_id'),
    'must not return national_id');
  assert.ok(!mgmtRpc.includes('normalized_'),
    'must not return normalized fields');
});

test('read model: factor_id and secret not returned', () => {
  const mgmtRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_admin_management_state'),
    appliedMigrationSql.indexOf('get_security_audit_page')
  );
  assert.ok(!mgmtRpc.includes('factor_id'),
    'must not return factor_id');
  assert.ok(!mgmtRpc.includes('secret'),
    'must not return secret');
});

test('read model: search length limited to 100', () => {
  assert.ok(appliedMigrationSql.includes('> 100'),
    'must limit search to 100 chars');
  assert.ok(appliedMigrationSql.includes('SEARCH_TOO_LONG'),
    'must return SEARCH_TOO_LONG error');
});

test('read model: limit and offset bounded', () => {
  assert.ok(appliedMigrationSql.includes('INVALID_LIMIT'),
    'must validate limit');
  assert.ok(appliedMigrationSql.includes('INVALID_OFFSET'),
    'must validate offset');
  // Limit 1..100, offset 0..10000
  assert.ok(appliedMigrationSql.includes('< 1') || appliedMigrationSql.includes('> 100'),
    'must check limit range');
});

test('read model: eligibility computed in backend', () => {
  assert.ok(appliedMigrationSql.includes('can_grant'),
    'must compute can_grant');
  assert.ok(appliedMigrationSql.includes('can_revoke'),
    'must compute can_revoke');
  assert.ok(appliedMigrationSql.includes('blocked_reason'),
    'must compute blocked_reason');
  assert.ok(appliedMigrationSql.includes('SELF_CHANGE_FORBIDDEN'),
    'must include SELF_CHANGE_FORBIDDEN');
  assert.ok(appliedMigrationSql.includes('TOTP_REQUIRED'),
    'must include TOTP_REQUIRED');
  assert.ok(appliedMigrationSql.includes('ALREADY_SECURITY_ADMIN'),
    'must include ALREADY_SECURITY_ADMIN');
});

test('read model: history max 50 records', () => {
  assert.ok(appliedMigrationSql.includes('LIMIT 50'),
    'must limit history to 50 records');
});

// ── Audit RPC Tests ──────────────────────────────────────────────────────────

test('audit rpc: keyset pagination', () => {
  const auditRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_audit_page'),
    appliedMigrationSql.indexOf('Indexes (IF NOT EXISTS)')
  );
  assert.ok(auditRpc.includes('p_before_created_at'),
    'must use before_created_at cursor');
  assert.ok(auditRpc.includes('p_before_id'),
    'must use before_id cursor');
});

test('audit rpc: sort by created_at DESC, id DESC', () => {
  const auditRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_audit_page'),
    appliedMigrationSql.indexOf('Indexes (IF NOT EXISTS)')
  );
  assert.ok(auditRpc.includes('ORDER BY e.created_at DESC, e.id DESC'),
    'must sort by created_at DESC, id DESC');
});

test('audit rpc: cursor pair validation', () => {
  assert.ok(appliedMigrationSql.includes('INVALID_CURSOR'),
    'must validate cursor pair');
  // Both or neither
  assert.ok(appliedMigrationSql.includes('IS NULL') && appliedMigrationSql.includes('!= ('),
    'must check both-or-neither on cursor');
});

test('audit rpc: limit+1 for has_more', () => {
  const auditRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_audit_page'),
    appliedMigrationSql.indexOf('Indexes (IF NOT EXISTS)')
  );
  assert.ok(auditRpc.includes('v_limit + 1'),
    'must read limit+1 for has_more detection');
  assert.ok(auditRpc.includes('has_more'),
    'must return has_more');
});

test('audit rpc: category validation', () => {
  assert.ok(appliedMigrationSql.includes('INVALID_CATEGORY'),
    'must validate category');
  assert.ok(appliedMigrationSql.includes("'auth'") && appliedMigrationSql.includes("'mfa'") && appliedMigrationSql.includes("'access'"),
    'must enumerate valid categories');
});

test('audit rpc: severity validation', () => {
  assert.ok(appliedMigrationSql.includes('INVALID_SEVERITY'),
    'must validate severity');
  assert.ok(appliedMigrationSql.includes("'info'") && appliedMigrationSql.includes("'critical'"),
    'must enumerate valid severities');
});

test('audit rpc: result validation', () => {
  assert.ok(appliedMigrationSql.includes('INVALID_RESULT'),
    'must validate result');
  assert.ok(appliedMigrationSql.includes("'success'") && appliedMigrationSql.includes("'denied'"),
    'must enumerate valid results');
});

test('audit rpc: date range validation', () => {
  assert.ok(appliedMigrationSql.includes('INVALID_DATE_RANGE'),
    'must validate date range');
  assert.ok(appliedMigrationSql.includes('p_from > p_to'),
    'must check from <= to');
});

test('audit rpc: metadata re-sanitized', () => {
  const auditRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_audit_page'),
    appliedMigrationSql.indexOf('Indexes (IF NOT EXISTS)')
  );
  assert.ok(auditRpc.includes('sanitize_audit_metadata'),
    'must re-sanitize metadata');
  assert.ok(auditRpc.includes('before_state') && auditRpc.includes('after_state'),
    'must sanitize before_state and after_state');
});

test('audit rpc: ip and user_agent_hash not returned', () => {
  const auditRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_audit_page'),
    appliedMigrationSql.indexOf('Indexes (IF NOT EXISTS)')
  );
  assert.ok(!auditRpc.includes('ip_address'),
    'must not return ip_address');
  assert.ok(!auditRpc.includes('ip_hash'),
    'must not return ip_hash');
  assert.ok(!auditRpc.includes('user_agent_hash'),
    'must not return user_agent_hash');
});

test('audit rpc: no anon execute', () => {
  assert.ok(appliedMigrationSql.includes("REVOKE EXECUTE ON FUNCTION public.get_security_audit_page") && appliedMigrationSql.includes("FROM anon"),
    'must revoke execute from anon on audit RPC');
});

test('audit rpc: non-security-admin rejected', () => {
  const auditRpc = appliedMigrationSql.slice(
    appliedMigrationSql.indexOf('get_security_audit_page'),
    appliedMigrationSql.indexOf('Indexes (IF NOT EXISTS)')
  );
  assert.ok(auditRpc.includes('SECURITY_ADMIN_REQUIRED'),
    'must reject non-security-admin');
});

// ── Frontend Tests ────────────────────────────────────────────────────────────

test('frontend: three tabs in SecurityControlCenter', () => {
  assert.ok(consoleSource.includes("'settings'") && consoleSource.includes("'admins'") && consoleSource.includes("'audit'"),
    'must have three tabs: settings, admins, audit');
  assert.ok(consoleSource.includes('SecuritySettingsConsole'),
    'must render SecuritySettingsConsole');
  assert.ok(consoleSource.includes('SecurityAdminManagement'),
    'must render SecurityAdminManagement');
  assert.ok(consoleSource.includes('SecurityAuditConsole'),
    'must render SecurityAuditConsole');
});

test('frontend: AuditLogPage not used for security audit', () => {
  assert.ok(!consoleSource.includes('AuditLogPage'),
    'SecurityControlCenter must not use AuditLogPage');
  assert.ok(!auditConsoleSource.includes('AuditLogPage'),
    'SecurityAuditConsole must not use AuditLogPage');
});

test('frontend: UserManagementPanel does not change security admin role directly', () => {
  if (userMgmtPanelSource) {
    assert.ok(!userMgmtPanelSource.includes("is_security_admin") || !userMgmtPanelSource.includes("from('profiles').update"),
      'UserManagementPanel must not directly update is_security_admin');
  }
});

test('frontend: step-up dialog purpose is configurable', () => {
  assert.ok(stepUpDialogSource.includes('purpose: StepUpPurpose'),
    'SecurityStepUpDialog must accept purpose prop');
  assert.ok(stepUpDialogSource.includes('title: string'),
    'must accept title prop');
  assert.ok(stepUpDialogSource.includes('description: string'),
    'must accept description prop');
  assert.ok(stepUpDialogSource.includes('confirmLabel: string'),
    'must accept confirmLabel prop');
});

test('frontend: role change uses account_security_change', () => {
  assert.ok(consoleSource.includes('account_security_change'),
    'role change must use account_security_change purpose');
});

test('frontend: save before step-up not called', () => {
  // The step-up dialog onSuccess triggers the setter, not before
  const onSuccessPos = consoleSource.indexOf('handleStepUpSuccess');
  const setterCallPos = consoleSource.indexOf('changeSecurityAdminRole', onSuccessPos);
  assert.ok(setterCallPos > 0,
    'changeSecurityAdminRole must be called after step-up success');
  // Verify it's inside handleStepUpSuccess
  const fnEnd = consoleSource.indexOf('}, [pendingChange]);', onSuccessPos);
  assert.ok(setterCallPos < fnEnd,
    'setter call must be inside handleStepUpSuccess');
});

test('frontend: one step-up only one setter call', () => {
  const setterCalls = (consoleSource.match(/changeSecurityAdminRole\(/g) || []).length;
  assert.equal(setterCalls, 1,
    'must call changeSecurityAdminRole exactly once');
});

test('frontend: actor without TOTP blocked', () => {
  assert.ok(adminMgmtSource.includes('current_actor_has_verified_totp'),
    'must check actor TOTP status');
  assert.ok(adminMgmtSource.includes('برای مدیریت مدیران امنیت'),
    'must show TOTP required message');
  assert.ok(adminMgmtSource.includes('disabled={!actorHasTotp}'),
    'must disable buttons when actor lacks TOTP');
});

test('frontend: target without TOTP not grantable', () => {
  assert.ok(adminMgmtSource.includes('can_grant'),
    'must check can_grant from backend eligibility');
  // The grant button only shows when eligibility.can_grant is true
  assert.ok(adminMgmtSource.includes('user.eligibility.can_grant'),
    'grant button must check eligibility');
});

test('frontend: self-change not clickable', () => {
  assert.ok(adminMgmtSource.includes('is_current_actor'),
    'must detect current actor');
  // Self-change should show "شما" label, not a button
  assert.ok(adminMgmtSource.includes('شما'),
    'must show "شما" for self');
});

test('frontend: last admin not revocable', () => {
  assert.ok(adminMgmtSource.includes('can_revoke'),
    'must check can_revoke from backend eligibility');
  assert.ok(adminMgmtSource.includes('user.eligibility.can_revoke'),
    'revoke button must check eligibility');
});

test('frontend: VERSION_CONFLICT snapshot preserved', () => {
  assert.ok(consoleSource.includes('VersionConflictSnapshot'),
    'must have VersionConflictSnapshot type');
  assert.ok(consoleSource.includes('setConflict('),
    'must set conflict snapshot');
  assert.ok(consoleSource.includes('targetUserId') && consoleSource.includes('changeReason'),
    'snapshot must include targetUserId and changeReason');
});

test('frontend: audit filter resets cursor', () => {
  assert.ok(auditConsoleSource.includes('loadInitial'),
    'must have loadInitial function');
  // When filters change, loadInitial is called which resets cursor
  assert.ok(auditConsoleSource.includes('setCursor'),
    'must reset cursor on filter change');
});

test('frontend: load more does not create duplicates', () => {
  assert.ok(auditConsoleSource.includes('existingIds'),
    'must deduplicate by existing IDs');
  assert.ok(auditConsoleSource.includes('Set'),
    'must use Set for dedup');
});

test('frontend: raw backend error not displayed', () => {
  assert.ok(!consoleSource.includes('error.message'),
    'must not use raw error.message');
  assert.ok(consoleSource.includes('getSecurityAdminErrorMessage'),
    'must use mapped error messages');
  assert.ok(!auditConsoleSource.includes('error.message'),
    'audit console must not use raw error.message');
});

test('frontend: no write inside useEffect', () => {
  // Check that no RPC write function is called inside useEffect
  const useEffectBlocks = adminMgmtSource.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[\s\S]*?\]\);/g) || [];
  for (const block of useEffectBlocks) {
    assert.ok(!block.includes('changeSecurityAdminRole'),
      'useEffect must not call changeSecurityAdminRole');
  }
  const consoleUseEffects = consoleSource.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[\s\S]*?\]\);/g) || [];
  for (const block of consoleUseEffects) {
    assert.ok(!block.includes('changeSecurityAdminRole'),
      'useEffect must not call changeSecurityAdminRole');
  }
});

// ── Service Layer Tests ──────────────────────────────────────────────────────

test('service: no direct query to security_audit_events', () => {
  assert.ok(!serviceSource.includes("from('security_audit_events')"),
    'must not query security_audit_events directly');
});

test('service: no direct query to security_admin_role_history', () => {
  assert.ok(!serviceSource.includes("from('security_admin_role_history')"),
    'must not query security_admin_role_history directly');
});

test('service: no direct profile update for is_security_admin', () => {
  assert.ok(!serviceSource.includes("from('profiles').update"),
    'must not update profiles directly');
});

test('service: uses RPC only', () => {
  assert.ok(serviceSource.includes("rpc('get_security_admin_management_state'"),
    'must use RPC for management state');
  assert.ok(serviceSource.includes("rpc('set_user_security_admin'"),
    'must use RPC for role change');
  assert.ok(serviceSource.includes("rpc('get_security_audit_page'"),
    'must use RPC for audit page');
});

test('service: error mapping covers all codes', () => {
  const codes = [
    'UNAUTHORIZED', 'SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_EXPIRED',
    'SECURITY_ADMIN_REQUIRED', 'FORBIDDEN', 'TARGET_REQUIRED', 'TARGET_NOT_FOUND',
    'TARGET_NOT_ELIGIBLE', 'TARGET_TOTP_REQUIRED', 'NEW_VALUE_REQUIRED',
    'EXPECTED_VERSION_REQUIRED', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN',
    'CANNOT_REMOVE_LAST_SECURITY_ADMIN', 'VERSION_CONFLICT', 'NO_EFFECTIVE_CHANGE',
    'STEPUP_REQUIRED', 'CHANGE_REASON_REQUIRED', 'CHANGE_REASON_TOO_SHORT',
    'CHANGE_REASON_TOO_LONG', 'INVALID_LIMIT', 'INVALID_OFFSET', 'INVALID_CURSOR',
    'INVALID_CATEGORY', 'INVALID_SEVERITY', 'INVALID_RESULT', 'INVALID_DATE_RANGE',
    'UNKNOWN_SECURITY_ADMIN_ERROR',
  ];
  for (const code of codes) {
    assert.ok(validationSource.includes(code),
      `error mapping must include ${code}`);
  }
});

test('service: types include all error codes', () => {
  const codes = [
    'UNAUTHORIZED', 'SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_EXPIRED',
    'SECURITY_ADMIN_REQUIRED', 'TARGET_TOTP_REQUIRED', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN',
    'CANNOT_REMOVE_LAST_SECURITY_ADMIN', 'VERSION_CONFLICT', 'STEPUP_REQUIRED',
    'CHANGE_REASON_REQUIRED', 'INVALID_CURSOR', 'INVALID_CATEGORY',
  ];
  for (const code of codes) {
    assert.ok(typesSource.includes(code),
      `types must include ${code}`);
  }
});

// ── MfaPanel Tests ────────────────────────────────────────────────────────────

test('MfaPanel renders SecurityControlCenter', () => {
  assert.ok(mfaPanelSource.includes('SecurityControlCenter'),
    'MfaPanel must render SecurityControlCenter');
});

// ── SecuritySettingsConsole backward compat ───────────────────────────────────

test('SecuritySettingsConsole uses auth_settings_change purpose', () => {
  assert.ok(settingsConsoleSource.includes('auth_settings_change'),
    'SecuritySettingsConsole must use auth_settings_change purpose');
});

// ── Role Dialog Tests ────────────────────────────────────────────────────────

test('role dialog: shows target name and operation', () => {
  assert.ok(roleDialogSource.includes('target.full_name') || roleDialogSource.includes('target.username'),
    'must show target name');
  assert.ok(roleDialogSource.includes('اعطا') || roleDialogSource.includes('حذف'),
    'must show grant/revoke operation');
});

test('role dialog: reason mandatory 10..500', () => {
  assert.ok(roleDialogSource.includes('reason.trim().length >= 10'),
    'must validate minimum 10 chars');
  assert.ok(roleDialogSource.includes('<= 500'),
    'must validate maximum 500 chars');
});

test('role dialog: confirmation checkbox default unchecked', () => {
  assert.ok(roleDialogSource.includes("useState(false)"),
    'confirmation must default to false');
  assert.ok(roleDialogSource.includes('confirmed'),
    'must have confirmation state');
});

test('role dialog: grant and revoke confirmation text', () => {
  assert.ok(roleDialogSource.includes('دسترسی خواهد داشت'),
    'must have grant confirmation text');
  assert.ok(roleDialogSource.includes('حذف خواهد شد'),
    'must have revoke confirmation text');
});

// ── Audit Details Tests ──────────────────────────────────────────────────────

test('audit details: shows request_id and session_id', () => {
  assert.ok(auditDetailsSource.includes('request_id'),
    'must show request_id');
  assert.ok(auditDetailsSource.includes('session_id'),
    'must show session_id');
});

test('audit details: metadata and states pretty printed', () => {
  assert.ok(auditDetailsSource.includes('JSON.stringify'),
    'must pretty-print JSON');
  assert.ok(auditDetailsSource.includes('metadata'),
    'must show metadata');
  assert.ok(auditDetailsSource.includes('before_state'),
    'must show before_state');
  assert.ok(auditDetailsSource.includes('after_state'),
    'must show after_state');
});

test('audit details: no edit/delete/clear/export', () => {
  assert.ok(!auditDetailsSource.includes('onClick') || !auditDetailsSource.includes('delete'),
    'must not have delete/edit actions');
});

// ── Label Mapping Tests ──────────────────────────────────────────────────────

test('labels: unknown code shows "کد ناشناخته"', () => {
  const labelsSource = fs.readFileSync(
    path.join(__dirname, '../../src/features/security-administration/utils/securityAuditLabels.ts'),
    'utf-8',
  );
  assert.ok(labelsSource.includes('کد ناشناخته'),
    'must show "کد ناشناخته" for unknown codes');
});
