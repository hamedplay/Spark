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

const originalMigrationName = '20260805034152_20260804200000_phase3c_security_admin_and_audit_console.sql.sql';
const fixMigrationName = '20260805043822_20260805050000_phase3c_security_admin_runtime_and_pagination_fixes.sql.sql';

const originalMigrationPath = path.join(migrationDir, originalMigrationName);
const fixMigrationPath = path.join(migrationDir, fixMigrationName);
const originalSql = fs.existsSync(originalMigrationPath) ? fs.readFileSync(originalMigrationPath, 'utf-8') : '';
const fixSql = fs.existsSync(fixMigrationPath) ? fs.readFileSync(fixMigrationPath, 'utf-8') : '';
const combinedSql = originalSql + '\n' + fixSql;

const consoleSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/components/SecurityControlCenter.tsx'), 'utf-8');
const adminMgmtSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/components/SecurityAdminManagement.tsx'), 'utf-8');
const roleDialogSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/components/SecurityAdminRoleDialog.tsx'), 'utf-8');
const auditConsoleSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/components/SecurityAuditConsole.tsx'), 'utf-8');
const auditDetailsSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/components/SecurityAuditDetails.tsx'), 'utf-8');
const stepUpDialogSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-settings/components/SecurityStepUpDialog.tsx'), 'utf-8');
const serviceSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/services/securityAdministrationService.ts'), 'utf-8');
const mfaPanelSource = fs.readFileSync(path.join(__dirname, '../../src/components/PortalConfig/MfaPanel.tsx'), 'utf-8');
const settingsConsoleSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-settings/components/SecuritySettingsConsole.tsx'), 'utf-8');
const userMgmtPanelSource = fs.existsSync(path.join(__dirname, '../../src/components/UserManagementPanel.tsx')) ? fs.readFileSync(path.join(__dirname, '../../src/components/UserManagementPanel.tsx'), 'utf-8') : '';
const validationSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/utils/securityAdministrationValidation.ts'), 'utf-8');
const typesSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/types/securityAdministration.ts'), 'utf-8');
const labelsSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-administration/utils/securityAuditLabels.ts'), 'utf-8');

// ═══ Migration Tests ═════════════════════════════════════════════════════════

test('migration: exactly two phase3c migrations exist', () => {
  assert.equal(phase3cMigrations.length, 2,
    `expected exactly 2 phase3c migrations, found ${phase3cMigrations.length}: ${phase3cMigrations.join(', ')}`);
});

test('migration: original applied file has exact name', () => {
  assert.ok(fs.existsSync(originalMigrationPath), `original migration must be named ${originalMigrationName}`);
});

test('migration: fix applied file has exact name', () => {
  assert.ok(fs.existsSync(fixMigrationPath), `fix migration must be named ${fixMigrationName}`);
});

test('migration: no pending phase3c file without applied version prefix', () => {
  for (const f of phase3cMigrations) {
    assert.ok(f.match(/^\d{14}_\d{8}.*\.sql\.sql$/), `migration file must have applied prefix pattern: ${f}`);
  }
});

test('migration: SECURITY DEFINER in fix file', () => {
  assert.ok(fixSql.includes('SECURITY DEFINER'), 'fix must contain SECURITY DEFINER');
});

test('migration: search_path empty string in fix file', () => {
  assert.ok(fixSql.includes("SET search_path = ''") || fixSql.includes("search_path=''"), 'fix must have search_path empty string');
});

test('migration: revokes from PUBLIC and anon in fix file', () => {
  assert.ok(fixSql.includes('REVOKE EXECUTE') || fixSql.includes('REVOKE SELECT'), 'must contain REVOKE statements');
});

test('migration: grants to authenticated in fix file', () => {
  assert.ok(fixSql.includes('GRANT EXECUTE') && fixSql.includes('authenticated'), 'must grant execute to authenticated');
});

test('migration: no DELETE/DROP/TRUNCATE/CASCADE in fix file', () => {
  const sqlOnly = fixSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM'), 'must not DELETE');
  assert.ok(!sqlOnly.toUpperCase().includes('DROP '), 'must not DROP');
  assert.ok(!sqlOnly.toUpperCase().includes('TRUNCATE'), 'must not TRUNCATE');
  assert.ok(!sqlOnly.toUpperCase().includes('CASCADE'), 'must not CASCADE');
});

test('migration: no MFA policy change in fix file', () => {
  const sqlOnly = fixSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().match(/UPDATE\s+PUBLIC\.AUTH_SECURITY_SETTINGS/), 'must not UPDATE auth_security_settings');
});

test('migration: original migration unchanged (Immutable)', () => {
  assert.ok(originalSql.includes('Phase 3C'), 'original must still exist unchanged');
  assert.ok(originalSql.includes('idx_security_audit_events_created_id'), 'original must still have indexes');
  assert.ok(originalSql.includes('REVOKE SELECT ON public.security_audit_events FROM anon'), 'original must still have ACL');
});

// ═══ Setter Tests ═════════════════════════════════════════════════════════════

test('setter: no direct profile update in frontend', () => {
  assert.ok(!serviceSource.includes("from('profiles')"), 'service must not query profiles directly');
  assert.ok(!adminMgmtSource.includes("from('profiles')"), 'admin management must not query profiles directly');
});

test('setter: uses is_current_security_admin in migration', () => {
  assert.ok(combinedSql.includes('public.is_current_security_admin()'), 'setter must use is_current_security_admin()');
});

test('setter: self-change blocked', () => {
  assert.ok(combinedSql.includes('CANNOT_CHANGE_OWN_SECURITY_ADMIN'), 'must block self-change');
});

test('setter: grant to inactive target rejected', () => {
  assert.ok(combinedSql.includes('TARGET_NOT_ELIGIBLE'), 'must reject grant to inactive target');
});

test('setter: grant to target without TOTP rejected', () => {
  assert.ok(combinedSql.includes('TARGET_TOTP_REQUIRED'), 'must reject grant to target without TOTP');
});

test('setter: last active admin protection', () => {
  assert.ok(combinedSql.includes('CANNOT_REMOVE_LAST_SECURITY_ADMIN'), 'must protect last active security admin');
});

test('setter: version conflict', () => {
  assert.ok(combinedSql.includes('VERSION_CONFLICT'), 'must return VERSION_CONFLICT');
  assert.ok(combinedSql.includes('current_version'), 'must return current_version in conflict');
});

test('setter: reason mandatory 10..500', () => {
  assert.ok(combinedSql.includes('CHANGE_REASON_REQUIRED'), 'must require change reason');
  assert.ok(combinedSql.includes('CHANGE_REASON_TOO_SHORT'), 'must reject short reason');
  assert.ok(combinedSql.includes('CHANGE_REASON_TOO_LONG'), 'must reject long reason');
  assert.ok(combinedSql.includes('< 10'), 'must check minimum 10 chars');
  assert.ok(combinedSql.includes('> 500'), 'must check maximum 500 chars');
});

test('setter: purpose is account_security_change', () => {
  assert.ok(combinedSql.includes("'account_security_change'"), 'must use account_security_change purpose');
});

test('setter: only TOTP/AAL2 grant accepted', () => {
  assert.ok(combinedSql.includes("factor_type = 'totp'"), 'must require TOTP factor type');
  assert.ok(combinedSql.includes("assurance_level = 'aal2'"), 'must require AAL2 assurance level');
  assert.ok(combinedSql.includes("grant_type = 'mfa_stepup'"), 'must require mfa_stepup grant type');
});

test('setter: grant consumed once via consumed_at', () => {
  assert.ok(combinedSql.includes('SET consumed_at = clock_timestamp()'), 'must consume grant via consumed_at');
  const sqlOnly = combinedSql.replace(/--[^\n]*\n/g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM PUBLIC.SESSION_SECURITY_GRANTS'), 'must NOT DELETE grants');
});

// ── NEW: Setter concurrency and order tests ─────────────────────────────────

test('setter: global advisory lock constant 987654321 used', () => {
  assert.ok(fixSql.includes('pg_advisory_xact_lock(987654321)'),
    'must use global constant advisory lock 987654321');
});

test('setter: lock is NOT target-specific (no hashtextextended on target)', () => {
  // The old migration used hashtextextended with target_user_id; the fix must NOT
  const lockSection = fixSql.slice(
    fixSql.indexOf('Global advisory lock'),
    fixSql.indexOf('Re-check actor')
  );
  assert.ok(!lockSection.includes('hashtextextended'), 'lock must not be target-specific');
  assert.ok(!lockSection.includes('p_target_user_id'), 'lock must not depend on target');
});

test('setter: actor re-checked after lock', () => {
  const lockPos = fixSql.indexOf('pg_advisory_xact_lock(987654321)');
  const recheckPos = fixSql.indexOf('is_current_security_admin()', lockPos);
  assert.ok(recheckPos > lockPos, 'must re-check actor after acquiring lock');
  // Check that FORBIDDEN is returned after the recheck
  const forbiddenPos = fixSql.indexOf("'FORBIDDEN'", recheckPos);
  assert.ok(forbiddenPos > recheckPos, 'must return FORBIDDEN if actor no longer admin');
});

test('setter: target eligibility before grant consumption', () => {
  const eligibilityPos = fixSql.indexOf('TARGET_NOT_ELIGIBLE');
  const grantConsumePos = fixSql.indexOf('Consume grant');
  assert.ok(eligibilityPos > 0 && grantConsumePos > 0, 'both sections must exist');
  assert.ok(eligibilityPos < grantConsumePos, 'eligibility must be checked before grant consumption');
});

test('setter: target TOTP before grant consumption', () => {
  const totpPos = fixSql.indexOf('TARGET_TOTP_REQUIRED');
  const grantConsumePos = fixSql.indexOf('Consume grant');
  assert.ok(totpPos < grantConsumePos, 'TOTP check must be before grant consumption');
});

test('setter: no-op check before grant consumption', () => {
  const noopPos = fixSql.indexOf('NO_EFFECTIVE_CHANGE');
  const grantConsumePos = fixSql.indexOf('Consume grant');
  assert.ok(noopPos < grantConsumePos, 'no-op check must be before grant consumption');
});

test('setter: last-admin check before grant consumption', () => {
  const lastAdminPos = fixSql.indexOf('CANNOT_REMOVE_LAST_SECURITY_ADMIN');
  const grantConsumePos = fixSql.indexOf('Consume grant');
  assert.ok(lastAdminPos < grantConsumePos, 'last-admin check must be before grant consumption');
});

test('setter: version conflict after grant consumption', () => {
  const grantConsumePos = fixSql.indexOf('Consume grant');
  const versionConflictPos = fixSql.indexOf('VERSION_CONFLICT', grantConsumePos);
  assert.ok(versionConflictPos > grantConsumePos, 'version conflict must be after grant consumption');
});

test('setter: grant freshness includes issued_at >= now - 5min', () => {
  assert.ok(fixSql.includes("issued_at >= clock_timestamp() - interval '5 minutes'"),
    'must check issued_at >= now - 5 minutes');
});

test('setter: grant UPDATE has consumed_at IS NULL guard', () => {
  const updatePos = fixSql.indexOf('UPDATE public.session_security_grants');
  const updateSection = fixSql.slice(updatePos, updatePos + 200);
  assert.ok(updateSection.includes('consumed_at IS NULL'), 'UPDATE must have consumed_at IS NULL guard');
});

test('setter: update row count checked', () => {
  assert.ok(fixSql.includes('GET DIAGNOSTICS'), 'must check row count via GET DIAGNOSTICS');
  assert.ok(fixSql.includes('ROW_COUNT'), 'must check ROW_COUNT');
  assert.ok(fixSql.includes('v_grant_consumed_count = 0'), 'must check for zero consumed');
});

test('setter: denied audit for all valid failures after session validation', () => {
  const failures = [
    'TARGET_NOT_FOUND', 'TARGET_NOT_ELIGIBLE', 'TARGET_TOTP_REQUIRED',
    'NO_EFFECTIVE_CHANGE', 'CANNOT_REMOVE_LAST_SECURITY_ADMIN',
    'VERSION_CONFLICT', 'STEPUP_REQUIRED', 'CHANGE_REASON_REQUIRED',
    'CHANGE_REASON_TOO_SHORT', 'CHANGE_REASON_TOO_LONG',
    'CANNOT_CHANGE_OWN_SECURITY_ADMIN', 'FORBIDDEN',
  ];
  for (const code of failures) {
    assert.ok(fixSql.includes(code), `must audit denied for ${code}`);
  }
});

test('setter: audit metadata does not store raw change reason', () => {
  assert.ok(fixSql.includes('change_reason_present'), 'must store change_reason_present boolean, not raw reason');
  const auditInsert = fixSql.slice(
    fixSql.indexOf('Insert audit'),
    fixSql.indexOf('Return')
  );
  assert.ok(!auditInsert.includes('v_trimmed_reason'), 'audit metadata must not include raw reason');
});

test('setter: before_state and after_state sanitized', () => {
  const auditInsert = fixSql.slice(
    fixSql.indexOf('Insert audit'),
    fixSql.indexOf('Return')
  );
  assert.ok(auditInsert.includes('sanitize_audit_metadata(v_before_state)'), 'must sanitize before_state');
  assert.ok(auditInsert.includes('sanitize_audit_metadata(v_after_state)'), 'must sanitize after_state');
});

// ═══ Management RPC Tests ═══════════════════════════════════════════════════

test('read model: phone and national_id not returned', () => {
  const mgmtRpc = fixSql.slice(fixSql.indexOf('get_security_admin_management_state'), fixSql.indexOf('get_security_audit_page'));
  assert.ok(!mgmtRpc.includes('phone'), 'must not return phone');
  assert.ok(!mgmtRpc.includes('national_id'), 'must not return national_id');
  assert.ok(!mgmtRpc.includes('normalized_'), 'must not return normalized fields');
});

test('read model: factor_id and secret not returned', () => {
  const mgmtRpc = fixSql.slice(fixSql.indexOf('get_security_admin_management_state'), fixSql.indexOf('get_security_audit_page'));
  assert.ok(!mgmtRpc.includes('factor_id'), 'must not return factor_id');
  assert.ok(!mgmtRpc.includes('secret'), 'must not return secret');
});

test('read model: search length limited to 100', () => {
  assert.ok(combinedSql.includes('> 100'), 'must limit search to 100 chars');
  assert.ok(combinedSql.includes('SEARCH_TOO_LONG'), 'must return SEARCH_TOO_LONG error');
});

test('read model: limit and offset bounded', () => {
  assert.ok(combinedSql.includes('INVALID_LIMIT'), 'must validate limit');
  assert.ok(combinedSql.includes('INVALID_OFFSET'), 'must validate offset');
});

test('read model: eligibility computed in backend', () => {
  assert.ok(combinedSql.includes('can_grant'), 'must compute can_grant');
  assert.ok(combinedSql.includes('can_revoke'), 'must compute can_revoke');
  assert.ok(combinedSql.includes('blocked_reason'), 'must compute blocked_reason');
  assert.ok(combinedSql.includes('SELF_CHANGE_FORBIDDEN'), 'must include SELF_CHANGE_FORBIDDEN');
  assert.ok(combinedSql.includes('TOTP_REQUIRED'), 'must include TOTP_REQUIRED');
});

test('read model: history max 50 records', () => {
  assert.ok(combinedSql.includes('LIMIT 50'), 'must limit history to 50 records');
});

// ── NEW: Management RPC pagination tests ───────────────────────────────────

test('mgmt rpc: population and search parenthesized', () => {
  const mgmtRpc = fixSql.slice(fixSql.indexOf('filtered_users'), fixSql.indexOf('page_plus_one'));
  assert.ok(mgmtRpc.includes('p.is_security_admin IS TRUE'), 'must have population');
  // Both population and search must be in separate parenthesized AND groups
  assert.ok(mgmtRpc.match(/WHERE\s*\(/), 'WHERE must be parenthesized');
  assert.ok(mgmtRpc.includes('v_search IS NULL'), 'must have search filter');
});

test('mgmt rpc: LIMIT/OFFSET inside subquery before aggregate', () => {
  const mgmtRpc = fixSql.slice(fixSql.indexOf('page_plus_one'), fixSql.indexOf('visible_page'));
  assert.ok(mgmtRpc.includes('LIMIT v_limit + 1'), 'must have LIMIT in subquery');
  assert.ok(mgmtRpc.includes('OFFSET v_offset'), 'must have OFFSET in subquery');
});

test('mgmt rpc: visible_page limits to v_limit', () => {
  const mgmtRpc = fixSql.slice(fixSql.indexOf('visible_page'), fixSql.indexOf('jsonb_agg'));
  assert.ok(mgmtRpc.includes('LIMIT v_limit'), 'visible_page must LIMIT v_limit');
});

test('mgmt rpc: has_more from page_plus_one count', () => {
  assert.ok(fixSql.includes('count(*) > v_limit'), 'has_more must be from count > v_limit');
});

test('mgmt rpc: total_matches computed from filtered_users', () => {
  assert.ok(fixSql.includes('v_total_matches'), 'must compute total_matches');
  // Check that total_matches is computed from filtered_users CTE
  // Find the SELECT count(*) INTO v_total_matches, not the declaration
  const assignPos = fixSql.indexOf('SELECT count(*) INTO v_total_matches');
  assert.ok(assignPos > 0, 'must have SELECT count(*) INTO v_total_matches');
  const searchSection = fixSql.slice(assignPos, assignPos + 100);
  assert.ok(searchSection.includes('filtered_users'), 'total_matches must use filtered_users CTE');
});

test('mgmt rpc: pagination object in output', () => {
  assert.ok(fixSql.includes('pagination'), 'must include pagination in output');
  assert.ok(fixSql.includes('has_more'), 'pagination must include has_more');
  assert.ok(fixSql.includes('total_matches'), 'pagination must include total_matches');
});

test('mgmt rpc: history limited before aggregate', () => {
  const historySection = fixSql.slice(fixSql.indexOf('Role history'), fixSql.indexOf('IF v_history IS NULL'));
  assert.ok(historySection.includes('LIMIT 50'), 'history must be limited to 50 before aggregate');
  // The LIMIT must be inside a subquery, not at the top level of the aggregate
  assert.ok(historySection.includes('SELECT *'), 'must use subquery');
});

test('mgmt rpc: last active admin blocked_reason is LAST_ACTIVE_SECURITY_ADMIN', () => {
  assert.ok(fixSql.includes('LAST_ACTIVE_SECURITY_ADMIN'), 'must return LAST_ACTIVE_SECURITY_ADMIN for last admin');
});

test('mgmt rpc: ALREADY_SECURITY_ADMIN not returned for revocable admin', () => {
  // The fix should NOT return ALREADY_SECURITY_ADMIN when revoke is allowed
  // Check that the blocked_reason CASE for security admins returns ELIGIBLE or LAST_ACTIVE
  const blockedReasonPos = fixSql.indexOf("'SELF_CHANGE_FORBIDDEN'");
  const eligibilitySection = fixSql.slice(blockedReasonPos, blockedReasonPos + 2000);
  assert.ok(eligibilitySection.includes('LAST_ACTIVE_SECURITY_ADMIN'), 'must check last admin for security admins');
  assert.ok(eligibilitySection.includes('ELIGIBLE'), 'must return ELIGIBLE for revocable admin');
});

// ═══ Audit RPC Tests ═════════════════════════════════════════════════════════

test('audit rpc: keyset pagination', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('p_before_created_at'), 'must use before_created_at cursor');
  assert.ok(auditRpc.includes('p_before_id'), 'must use before_id cursor');
});

test('audit rpc: sort by created_at DESC, id DESC', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('ORDER BY created_at DESC, id DESC'), 'must sort by created_at DESC, id DESC');
});

test('audit rpc: cursor pair validation', () => {
  assert.ok(combinedSql.includes('INVALID_CURSOR'), 'must validate cursor pair');
});

test('audit rpc: category validation', () => {
  assert.ok(combinedSql.includes('INVALID_CATEGORY'), 'must validate category');
});

test('audit rpc: severity validation', () => {
  assert.ok(combinedSql.includes('INVALID_SEVERITY'), 'must validate severity');
});

test('audit rpc: result validation', () => {
  assert.ok(combinedSql.includes('INVALID_RESULT'), 'must validate result');
});

test('audit rpc: date range validation', () => {
  assert.ok(combinedSql.includes('INVALID_DATE_RANGE'), 'must validate date range');
  assert.ok(combinedSql.includes('p_from > p_to'), 'must check from <= to');
});

test('audit rpc: metadata re-sanitized', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('sanitize_audit_metadata'), 'must re-sanitize metadata');
});

test('audit rpc: ip and user_agent_hash not returned', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(!auditRpc.includes('ip_address'), 'must not return ip_address');
  assert.ok(!auditRpc.includes('ip_hash'), 'must not return ip_hash');
  assert.ok(!auditRpc.includes('user_agent_hash'), 'must not return user_agent_hash');
});

test('audit rpc: no anon execute', () => {
  assert.ok(fixSql.includes('REVOKE EXECUTE ON FUNCTION public.get_security_audit_page') && fixSql.includes('FROM anon'),
    'must revoke execute from anon on audit RPC');
});

test('audit rpc: non-security-admin rejected', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('SECURITY_ADMIN_REQUIRED'), 'must reject non-security-admin');
});

// ── NEW: Audit RPC pagination tests ─────────────────────────────────────────

test('audit rpc: limit before aggregate in CTE', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('page_plus_one'), 'must use page_plus_one CTE');
  assert.ok(auditRpc.includes('LIMIT v_limit + 1'), 'must limit to v_limit + 1 in subquery');
});

test('audit rpc: array does not contain limit+1 row', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('visible_page'), 'must use visible_page CTE');
  assert.ok(auditRpc.includes('LIMIT v_limit'), 'visible_page must limit to v_limit');
});

test('audit rpc: cursor from last visible row', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('v_last_created_at'), 'must extract last created_at');
  assert.ok(auditRpc.includes('v_last_id'), 'must extract last id');
  assert.ok(auditRpc.includes('v_count - 1'), 'must use last index of visible array');
});

test('audit rpc: empty page cursor is null', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('v_count > 0'), 'must check v_count > 0 before setting cursor');
  assert.ok(auditRpc.includes('v_next_cursor := NULL'), 'must set cursor to NULL for empty page');
});

test('audit rpc: nullable states use CASE WHEN IS NULL', () => {
  const auditRpc = fixSql.slice(fixSql.indexOf('get_security_audit_page'), fixSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes("WHEN vp.metadata IS NULL THEN NULL"), 'must handle nullable metadata');
  assert.ok(auditRpc.includes("WHEN vp.before_state IS NULL THEN NULL"), 'must handle nullable before_state');
  assert.ok(auditRpc.includes("WHEN vp.after_state IS NULL THEN NULL"), 'must handle nullable after_state');
});

// ═══ Frontend Tests ═════════════════════════════════════════════════════════

test('frontend: three tabs in SecurityControlCenter', () => {
  assert.ok(consoleSource.includes("'settings'") && consoleSource.includes("'admins'") && consoleSource.includes("'audit'"), 'must have three tabs');
  assert.ok(consoleSource.includes('SecuritySettingsConsole'), 'must render SecuritySettingsConsole');
  assert.ok(consoleSource.includes('SecurityAdminManagement'), 'must render SecurityAdminManagement');
  assert.ok(consoleSource.includes('SecurityAuditConsole'), 'must render SecurityAuditConsole');
});

test('frontend: AuditLogPage not used for security audit', () => {
  assert.ok(!consoleSource.includes('AuditLogPage'), 'SecurityControlCenter must not use AuditLogPage');
  assert.ok(!auditConsoleSource.includes('AuditLogPage'), 'SecurityAuditConsole must not use AuditLogPage');
});

test('frontend: UserManagementPanel does not change security admin role directly', () => {
  if (userMgmtPanelSource) {
    assert.ok(!userMgmtPanelSource.includes("is_security_admin") || !userMgmtPanelSource.includes("from('profiles').update"),
      'UserManagementPanel must not directly update is_security_admin');
  }
});

test('frontend: step-up dialog purpose is configurable', () => {
  assert.ok(stepUpDialogSource.includes('purpose: StepUpPurpose'), 'must accept purpose prop');
  assert.ok(stepUpDialogSource.includes('title: string'), 'must accept title prop');
  assert.ok(stepUpDialogSource.includes('description: string'), 'must accept description prop');
  assert.ok(stepUpDialogSource.includes('confirmLabel: string'), 'must accept confirmLabel prop');
});

test('frontend: role change uses account_security_change', () => {
  assert.ok(consoleSource.includes('account_security_change'), 'role change must use account_security_change purpose');
});

test('frontend: one step-up only one setter call', () => {
  const setterCalls = (consoleSource.match(/changeSecurityAdminRole\(/g) || []).length;
  assert.equal(setterCalls, 1, 'must call changeSecurityAdminRole exactly once');
});

test('frontend: actor without TOTP blocked', () => {
  assert.ok(adminMgmtSource.includes('current_actor_has_verified_totp'), 'must check actor TOTP status');
  assert.ok(adminMgmtSource.includes('برای مدیریت مدیران امنیت'), 'must show TOTP required message');
  assert.ok(adminMgmtSource.includes('disabled={!actorHasTotp'), 'must disable buttons when actor lacks TOTP');
});

test('frontend: target without TOTP not grantable', () => {
  assert.ok(adminMgmtSource.includes('can_grant'), 'must check can_grant from backend eligibility');
  assert.ok(adminMgmtSource.includes('user.eligibility.can_grant'), 'grant button must check eligibility');
});

test('frontend: self-change not clickable', () => {
  assert.ok(adminMgmtSource.includes('is_current_actor'), 'must detect current actor');
  assert.ok(adminMgmtSource.includes('شما'), 'must show "شما" for self');
});

test('frontend: last admin not revocable', () => {
  assert.ok(adminMgmtSource.includes('can_revoke'), 'must check can_revoke from backend eligibility');
  assert.ok(adminMgmtSource.includes('user.eligibility.can_revoke'), 'revoke button must check eligibility');
});

test('frontend: VERSION_CONFLICT snapshot preserved', () => {
  assert.ok(consoleSource.includes('VersionConflictSnapshot'), 'must have VersionConflictSnapshot type');
  assert.ok(consoleSource.includes('setConflict('), 'must set conflict snapshot');
  assert.ok(consoleSource.includes('targetUserId') && consoleSource.includes('changeReason'), 'snapshot must include targetUserId and changeReason');
});

test('frontend: raw backend error not displayed', () => {
  assert.ok(!consoleSource.includes('error.message'), 'must not use raw error.message');
  assert.ok(consoleSource.includes('getSecurityAdminErrorMessage'), 'must use mapped error messages');
  assert.ok(!auditConsoleSource.includes('error.message'), 'audit console must not use raw error.message');
});

test('frontend: no write inside useEffect', () => {
  const useEffectBlocks = adminMgmtSource.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[\s\S]*?\]\);/g) || [];
  for (const block of useEffectBlocks) {
    assert.ok(!block.includes('changeSecurityAdminRole'), 'useEffect must not call changeSecurityAdminRole');
  }
  const consoleUseEffects = consoleSource.match(/useEffect\(\(\) => \{[\s\S]*?\}, \[[\s\S]*?\]\);/g) || [];
  for (const block of consoleUseEffects) {
    assert.ok(!block.includes('changeSecurityAdminRole'), 'useEffect must not call changeSecurityAdminRole');
  }
});

test('frontend: MfaPanel renders SecurityControlCenter', () => {
  assert.ok(mfaPanelSource.includes('SecurityControlCenter'), 'MfaPanel must render SecurityControlCenter');
});

test('frontend: SecuritySettingsConsole uses auth_settings_change purpose', () => {
  assert.ok(settingsConsoleSource.includes('auth_settings_change'), 'SecuritySettingsConsole must use auth_settings_change purpose');
});

test('frontend: role dialog shows target name and operation', () => {
  assert.ok(roleDialogSource.includes('target.full_name') || roleDialogSource.includes('target.username'), 'must show target name');
  assert.ok(roleDialogSource.includes('اعطا') || roleDialogSource.includes('حذف'), 'must show grant/revoke operation');
});

test('frontend: role dialog reason mandatory 10..500', () => {
  assert.ok(roleDialogSource.includes('reason.trim().length >= 10'), 'must validate minimum 10 chars');
  assert.ok(roleDialogSource.includes('<= 500'), 'must validate maximum 500 chars');
});

test('frontend: role dialog confirmation checkbox default unchecked', () => {
  assert.ok(roleDialogSource.includes('useState(false)'), 'confirmation must default to false');
  assert.ok(roleDialogSource.includes('confirmed'), 'must have confirmation state');
});

test('frontend: role dialog grant and revoke confirmation text', () => {
  assert.ok(roleDialogSource.includes('دسترسی خواهد داشت'), 'must have grant confirmation text');
  assert.ok(roleDialogSource.includes('حذف خواهد شد'), 'must have revoke confirmation text');
});

test('frontend: audit details shows request_id and session_id', () => {
  assert.ok(auditDetailsSource.includes('request_id'), 'must show request_id');
  assert.ok(auditDetailsSource.includes('session_id'), 'must show session_id');
});

test('frontend: audit details metadata and states pretty printed', () => {
  assert.ok(auditDetailsSource.includes('JSON.stringify'), 'must pretty-print JSON');
  assert.ok(auditDetailsSource.includes('metadata'), 'must show metadata');
  assert.ok(auditDetailsSource.includes('before_state'), 'must show before_state');
  assert.ok(auditDetailsSource.includes('after_state'), 'must show after_state');
});

test('frontend: labels unknown code shows "کد ناشناخته"', () => {
  assert.ok(labelsSource.includes('کد ناشناخته'), 'must show "کد ناشناخته" for unknown codes');
});

// ── NEW: Frontend setter/reload tests ──────────────────────────────────────

test('frontend: onSuccess in step-up dialog is awaited', () => {
  assert.ok(stepUpDialogSource.includes('await onSuccess()'), 'must await onSuccess()');
});

test('frontend: dialog stays open and busy during setter', () => {
  assert.ok(stepUpDialogSource.includes('void | Promise<void>'), 'onSuccess must accept Promise');
  // The dialog must not close before setter completes
  assert.ok(consoleSource.includes('setChangeBusy(true)'), 'must set changeBusy true during setter');
  assert.ok(consoleSource.includes('setChangeBusy(false)'), 'must set changeBusy false after setter');
});

test('frontend: simultaneous second role change not possible', () => {
  assert.ok(consoleSource.includes('changeBusy'), 'must track changeBusy state');
  assert.ok(consoleSource.includes('disabled={changeBusy}'), 'must disable tabs during change');
});

test('frontend: success causes management reload', () => {
  assert.ok(consoleSource.includes('adminRefreshVersion'), 'must have adminRefreshVersion');
  assert.ok(consoleSource.includes('setAdminRefreshVersion'), 'must call setAdminRefreshVersion');
  assert.ok(consoleSource.includes('refreshVersion={adminRefreshVersion}'), 'must pass refreshVersion to management');
});

test('frontend: success causes audit reload', () => {
  assert.ok(consoleSource.includes('auditRefreshVersion'), 'must have auditRefreshVersion');
  assert.ok(consoleSource.includes('setAuditRefreshVersion'), 'must call setAuditRefreshVersion');
  assert.ok(consoleSource.includes('refreshVersion={auditRefreshVersion}'), 'must pass refreshVersion to audit');
});

test('frontend: VERSION_CONFLICT causes reload and preserves snapshot', () => {
  const conflictSection = consoleSource.slice(
    consoleSource.indexOf('VERSION_CONFLICT'),
    consoleSource.indexOf('VERSION_CONFLICT') + 500
  );
  assert.ok(conflictSection.includes('setConflict'), 'must set conflict on VERSION_CONFLICT');
  assert.ok(conflictSection.includes('setAdminRefreshVersion'), 'must reload management on conflict');
  assert.ok(conflictSection.includes('currentVersion'), 'must preserve currentVersion in snapshot');
});

test('frontend: conflict summary shows all fields', () => {
  assert.ok(consoleSource.includes('targetDisplayName'), 'must show target');
  assert.ok(consoleSource.includes('requestedValue'), 'must show requested role');
  assert.ok(consoleSource.includes('expectedVersion'), 'must show expected version');
  assert.ok(consoleSource.includes('currentVersion'), 'must show current version');
  assert.ok(consoleSource.includes('changeReason'), 'must show change reason');
});

// ── NEW: Frontend search/pagination tests ──────────────────────────────────

test('frontend: single debounce effect for search', () => {
  // Should have setDebouncedSearch, not two effects
  assert.ok(adminMgmtSource.includes('setDebouncedSearch'), 'must use debouncedSearch state');
  assert.ok(adminMgmtSource.includes('debouncedSearch'), 'must use debouncedSearch in load effect');
  // Count debounce effects — should be exactly 1
  const debounceEffects = adminMgmtSource.match(/useEffect\(\(\) => \{[\s\S]*?setTimeout/g) || [];
  assert.equal(debounceEffects.length, 1, 'must have exactly 1 debounce effect');
});

test('frontend: single load effect', () => {
  // Should have one effect that loads on debouncedSearch, offset, refreshVersion
  const loadEffects = adminMgmtSource.match(/useEffect\(\(\) => \{[\s\S]*?loadData\([\s\S]*?\}, \[/g) || [];
  assert.ok(loadEffects.length >= 1, 'must have at least 1 load effect');
  // Check it depends on debouncedSearch, offset, refreshVersion
  const mainLoadEffect = loadEffects.find((e) => e.includes('debouncedSearch'));
  assert.ok(mainLoadEffect, 'must have a load effect depending on debouncedSearch');
});

test('frontend: next uses pagination.has_more', () => {
  assert.ok(adminMgmtSource.includes('pagination?.has_more'), 'next must use pagination.has_more');
});

test('frontend: previous uses pagination.offset', () => {
  assert.ok(adminMgmtSource.includes('pagination.offset === 0') || adminMgmtSource.includes('pagination?.offset === 0'),
    'previous must use pagination.offset');
});

// ── NEW: Frontend audit race protection tests ──────────────────────────────

test('frontend: audit console uses generation ID', () => {
  assert.ok(auditConsoleSource.includes('generationRef'), 'must use generation ref');
  assert.ok(auditConsoleSource.includes('++generationRef'), 'must increment generation');
});

test('frontend: audit filter change resets events and cursor', () => {
  assert.ok(auditConsoleSource.includes('setEvents([])'), 'must clear events on filter change');
  assert.ok(auditConsoleSource.includes('setHasMore(false)'), 'must reset hasMore');
  assert.ok(auditConsoleSource.includes('setCursor(null)'), 'must reset cursor');
  assert.ok(auditConsoleSource.includes('setSelectedEvent(null)'), 'must clear selected event');
});

test('frontend: audit load more checks generation', () => {
  assert.ok(auditConsoleSource.includes('gen !== generationRef.current'), 'load more must check generation');
});

test('frontend: audit dedup uses Set', () => {
  assert.ok(auditConsoleSource.includes('existingIds'), 'must deduplicate by existing IDs');
  assert.ok(auditConsoleSource.includes('Set'), 'must use Set for dedup');
});

// ── NEW: Audit filter tests ────────────────────────────────────────────────

test('frontend: actor filter input exists', () => {
  assert.ok(auditConsoleSource.includes('actorUserId'), 'must have actor user ID filter');
  assert.ok(auditConsoleSource.includes('Actor UUID'), 'must have actor UUID placeholder');
});

test('frontend: target filter input exists', () => {
  assert.ok(auditConsoleSource.includes('targetUserId'), 'must have target user ID filter');
  assert.ok(auditConsoleSource.includes('Target UUID'), 'must have target UUID placeholder');
});

test('frontend: from date filter exists', () => {
  assert.ok(auditConsoleSource.includes('fromDate'), 'must have from date filter');
  assert.ok(auditConsoleSource.includes('type="date"'), 'must use date input');
});

test('frontend: to date filter exists', () => {
  assert.ok(auditConsoleSource.includes('toDate'), 'must have to date filter');
});

test('frontend: UUID validation before RPC', () => {
  assert.ok(auditConsoleSource.includes('UUID_REGEX'), 'must validate UUID format');
  assert.ok(auditConsoleSource.includes('UUID نامعتبر'), 'must show UUID error message');
});

// ═══ Service Layer Tests ════════════════════════════════════════════════════

test('service: no direct query to security_audit_events', () => {
  assert.ok(!serviceSource.includes("from('security_audit_events')"), 'must not query security_audit_events directly');
});

test('service: no direct query to security_admin_role_history', () => {
  assert.ok(!serviceSource.includes("from('security_admin_role_history')"), 'must not query security_admin_role_history directly');
});

test('service: no direct profile update for is_security_admin', () => {
  assert.ok(!serviceSource.includes("from('profiles').update"), 'must not update profiles directly');
});

test('service: uses RPC only', () => {
  assert.ok(serviceSource.includes("rpc('get_security_admin_management_state'"), 'must use RPC for management state');
  assert.ok(serviceSource.includes("rpc('set_user_security_admin'"), 'must use RPC for role change');
  assert.ok(serviceSource.includes("rpc('get_security_audit_page'"), 'must use RPC for audit page');
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
    assert.ok(validationSource.includes(code), `error mapping must include ${code}`);
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
    assert.ok(typesSource.includes(code), `types must include ${code}`);
  }
});

test('service: types include pagination', () => {
  assert.ok(typesSource.includes('AdminManagementPagination'), 'must have pagination type');
  assert.ok(typesSource.includes('has_more'), 'pagination must have has_more');
  assert.ok(typesSource.includes('total_matches'), 'pagination must have total_matches');
});
