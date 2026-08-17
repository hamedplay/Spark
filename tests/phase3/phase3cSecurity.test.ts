import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tehranDateToUtcRange } from '../../src/features/security-administration/utils/tehranDateRange';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationDir = path.join(__dirname, '../../supabase/migrations');
const allMigrations = fs.readdirSync(migrationDir);
const phase3cMigrations = allMigrations.filter((f) => f.includes('phase3c'));

const originalMigrationName = '20260805034152_20260804200000_phase3c_security_admin_and_audit_console.sql.sql';
const fixMigrationName = '20260805043822_20260805050000_phase3c_security_admin_runtime_and_pagination_fixes.sql.sql';
const driftFixMigrationName = '20260805050720_20260805060000_phase3c_read_rpc_runtime_and_artifact_drift_fix.sql.sql';

const originalMigrationPath = path.join(migrationDir, originalMigrationName);
const fixMigrationPath = path.join(migrationDir, fixMigrationName);
const driftFixMigrationPath = path.join(migrationDir, driftFixMigrationName);
const originalSql = fs.existsSync(originalMigrationPath) ? fs.readFileSync(originalMigrationPath, 'utf-8') : '';
const fixSql = fs.existsSync(fixMigrationPath) ? fs.readFileSync(fixMigrationPath, 'utf-8') : '';
const driftFixSql = fs.existsSync(driftFixMigrationPath) ? fs.readFileSync(driftFixMigrationPath, 'utf-8') : '';
const combinedSql = originalSql + '\n' + fixSql + '\n' + driftFixSql;
const latestSql = driftFixSql || fixSql;

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

test('migration: exactly three phase3c migrations exist', () => {
  assert.equal(phase3cMigrations.length, 3,
    `expected exactly 3 phase3c migrations, found ${phase3cMigrations.length}: ${phase3cMigrations.join(', ')}`);
});

test('migration: original applied file has exact name', () => {
  assert.ok(fs.existsSync(originalMigrationPath), `original migration must be named ${originalMigrationName}`);
});

test('migration: fix applied file has exact name', () => {
  assert.ok(fs.existsSync(fixMigrationPath), `fix migration must be named ${fixMigrationName}`);
});

test('migration: drift fix applied file has exact name', () => {
  assert.ok(fs.existsSync(driftFixMigrationPath), `drift fix migration must be named ${driftFixMigrationName}`);
});

test('migration: no pending phase3c file without applied version prefix', () => {
  for (const f of phase3cMigrations) {
    assert.ok(f.match(/^\d{14}_\d{8}.*\.sql\.sql$/), `migration file must have applied prefix pattern: ${f}`);
  }
});

test('migration: SECURITY DEFINER in drift fix file', () => {
  assert.ok(driftFixSql.includes('SECURITY DEFINER'), 'drift fix must contain SECURITY DEFINER');
});

test('migration: search_path empty string in drift fix file', () => {
  assert.ok(driftFixSql.includes("SET search_path = ''") || driftFixSql.includes("search_path=''"), 'drift fix must have search_path empty string');
});

test('migration: revokes from PUBLIC and anon in drift fix file', () => {
  assert.ok(driftFixSql.includes('REVOKE EXECUTE') || driftFixSql.includes('REVOKE SELECT'), 'must contain REVOKE statements');
});

test('migration: grants to authenticated in drift fix file', () => {
  assert.ok(driftFixSql.includes('GRANT EXECUTE') && driftFixSql.includes('authenticated'), 'must grant execute to authenticated');
});

test('migration: no DELETE/DROP/TRUNCATE/CASCADE in drift fix file', () => {
  const sqlOnly = driftFixSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!sqlOnly.toUpperCase().includes('DELETE FROM'), 'must not DELETE');
  assert.ok(!sqlOnly.toUpperCase().includes('DROP '), 'must not DROP');
  assert.ok(!sqlOnly.toUpperCase().includes('TRUNCATE'), 'must not TRUNCATE');
  assert.ok(!sqlOnly.toUpperCase().includes('CASCADE'), 'must not CASCADE');
});

test('migration: no MFA policy change in drift fix file', () => {
  const sqlOnly = driftFixSql.replace(/--[^\n]*\n/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
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
  assert.ok(latestSql.includes('pg_advisory_xact_lock(987654321)'),
    'must use global constant advisory lock 987654321');
});

test('setter: lock is NOT target-specific (no hashtextextended on target)', () => {
  const lockSection = latestSql.slice(
    latestSql.indexOf('Global advisory lock'),
    latestSql.indexOf('Re-check actor')
  );
  assert.ok(!lockSection.includes('hashtextextended'), 'lock must not be target-specific');
  assert.ok(!lockSection.includes('p_target_user_id'), 'lock must not depend on target');
});

test('setter: actor re-checked after lock', () => {
  const lockPos = latestSql.indexOf('pg_advisory_xact_lock(987654321)');
  const recheckPos = latestSql.indexOf('is_current_security_admin()', lockPos);
  assert.ok(recheckPos > lockPos, 'must re-check actor after acquiring lock');
  const forbiddenPos = latestSql.indexOf("'FORBIDDEN'", recheckPos);
  assert.ok(forbiddenPos > recheckPos, 'must return FORBIDDEN if actor no longer admin');
});

test('setter: target eligibility before grant consumption', () => {
  const eligibilityPos = latestSql.indexOf('TARGET_NOT_ELIGIBLE');
  const grantConsumePos = latestSql.indexOf('Consume grant');
  assert.ok(eligibilityPos > 0 && grantConsumePos > 0, 'both sections must exist');
  assert.ok(eligibilityPos < grantConsumePos, 'eligibility must be checked before grant consumption');
});

test('setter: target TOTP before grant consumption', () => {
  const totpPos = latestSql.indexOf('TARGET_TOTP_REQUIRED');
  const grantConsumePos = latestSql.indexOf('Consume grant');
  assert.ok(totpPos < grantConsumePos, 'TOTP check must be before grant consumption');
});

test('setter: no-op check before grant consumption', () => {
  const noopPos = latestSql.indexOf('NO_EFFECTIVE_CHANGE');
  const grantConsumePos = latestSql.indexOf('Consume grant');
  assert.ok(noopPos < grantConsumePos, 'no-op check must be before grant consumption');
});

test('setter: last-admin check before grant consumption', () => {
  const lastAdminPos = latestSql.indexOf('CANNOT_REMOVE_LAST_SECURITY_ADMIN');
  const grantConsumePos = latestSql.indexOf('Consume grant');
  assert.ok(lastAdminPos < grantConsumePos, 'last-admin check must be before grant consumption');
});

test('setter: version conflict after grant consumption', () => {
  const grantConsumePos = latestSql.indexOf('Consume grant');
  const versionConflictPos = latestSql.indexOf('VERSION_CONFLICT', grantConsumePos);
  assert.ok(versionConflictPos > grantConsumePos, 'version conflict must be after grant consumption');
});

test('setter: grant freshness includes issued_at >= now - 5min', () => {
  assert.ok(latestSql.includes("issued_at >= clock_timestamp() - interval '5 minutes'"),
    'must check issued_at >= now - 5 minutes');
});

test('setter: grant UPDATE has consumed_at IS NULL guard', () => {
  const updatePos = latestSql.indexOf('UPDATE public.session_security_grants');
  const updateSection = latestSql.slice(updatePos, updatePos + 200);
  assert.ok(updateSection.includes('consumed_at IS NULL'), 'UPDATE must have consumed_at IS NULL guard');
});

test('setter: update row count checked', () => {
  assert.ok(latestSql.includes('GET DIAGNOSTICS'), 'must check row count via GET DIAGNOSTICS');
  assert.ok(latestSql.includes('ROW_COUNT'), 'must check ROW_COUNT');
  assert.ok(latestSql.includes('v_grant_consumed_count = 0'), 'must check for zero consumed');
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
    assert.ok(latestSql.includes(code), `must audit denied for ${code}`);
  }
});

test('setter: audit metadata does not store raw change reason', () => {
  assert.ok(latestSql.includes('change_reason_present'), 'must store change_reason_present boolean, not raw reason');
  const auditInsert = latestSql.slice(
    latestSql.indexOf('Insert audit'),
    latestSql.indexOf('Return')
  );
  assert.ok(!auditInsert.includes('v_trimmed_reason'), 'audit metadata must not include raw reason');
});

test('setter: before_state and after_state sanitized', () => {
  const body = extractFunctionBody(latestSql, 'set_user_security_admin');
  assert.ok(body.length > 0, 'must extract setter body');
  assert.ok(body.includes('sanitize_audit_metadata(v_before_state)'), 'must sanitize before_state');
  assert.ok(body.includes('sanitize_audit_metadata(v_after_state)'), 'must sanitize after_state');
});

// ═══ Management RPC Tests ═══════════════════════════════════════════════════

test('read model: phone and national_id not returned', () => {
  const mgmtRpc = latestSql.slice(latestSql.indexOf('get_security_admin_management_state'), latestSql.indexOf('get_security_audit_page'));
  assert.ok(!mgmtRpc.includes('phone'), 'must not return phone');
  assert.ok(!mgmtRpc.includes('national_id'), 'must not return national_id');
  assert.ok(!mgmtRpc.includes('normalized_'), 'must not return normalized fields');
});

test('read model: factor_id and secret not returned', () => {
  const mgmtRpc = latestSql.slice(latestSql.indexOf('get_security_admin_management_state'), latestSql.indexOf('get_security_audit_page'));
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
  const mgmtRpc = latestSql.slice(latestSql.indexOf('filtered_users'), latestSql.indexOf('page_plus_one'));
  assert.ok(mgmtRpc.includes('p.is_security_admin IS TRUE'), 'must have population');
  assert.ok(mgmtRpc.match(/WHERE\s*\(/), 'WHERE must be parenthesized');
  assert.ok(mgmtRpc.includes('v_search IS NULL'), 'must have search filter');
});

test('mgmt rpc: LIMIT/OFFSET inside subquery before aggregate', () => {
  const mgmtRpc = latestSql.slice(latestSql.indexOf('page_plus_one'), latestSql.indexOf('visible_page'));
  assert.ok(mgmtRpc.includes('LIMIT v_limit + 1'), 'must have LIMIT in subquery');
  assert.ok(mgmtRpc.includes('OFFSET v_offset'), 'must have OFFSET in subquery');
});

test('mgmt rpc: visible_page limits to v_limit', () => {
  const mgmtRpc = latestSql.slice(latestSql.indexOf('visible_page'), latestSql.indexOf('jsonb_agg'));
  assert.ok(mgmtRpc.includes('LIMIT v_limit'), 'visible_page must LIMIT v_limit');
});

test('mgmt rpc: has_more from page_plus_one count', () => {
  assert.ok(latestSql.includes('count(*) > v_limit'), 'has_more must be from count > v_limit');
});

test('mgmt rpc: total_matches computed from filtered_users', () => {
  assert.ok(latestSql.includes('v_total_matches'), 'must compute total_matches');
  const assignPos = latestSql.indexOf('SELECT count(*) INTO v_total_matches');
  if (assignPos > 0) {
    const searchSection = latestSql.slice(assignPos, assignPos + 100);
    assert.ok(searchSection.includes('filtered_users'), 'total_matches must use filtered_users CTE');
  } else {
    assert.ok(latestSql.includes('filtered_users'), 'total_matches must reference filtered_users');
  }
});

test('mgmt rpc: pagination object in output', () => {
  assert.ok(latestSql.includes('pagination'), 'must include pagination in output');
  assert.ok(latestSql.includes('has_more'), 'pagination must include has_more');
  assert.ok(latestSql.includes('total_matches'), 'pagination must include total_matches');
});

test('mgmt rpc: history limited before aggregate', () => {
  const historySection = latestSql.slice(latestSql.indexOf('Role history'), latestSql.indexOf('IF v_history IS NULL'));
  assert.ok(historySection.includes('LIMIT 50'), 'history must be limited to 50 before aggregate');
  assert.ok(historySection.includes('SELECT *'), 'must use subquery');
});

test('mgmt rpc: last active admin blocked_reason is LAST_ACTIVE_SECURITY_ADMIN', () => {
  assert.ok(latestSql.includes('LAST_ACTIVE_SECURITY_ADMIN'), 'must return LAST_ACTIVE_SECURITY_ADMIN for last admin');
});

test('mgmt rpc: ALREADY_SECURITY_ADMIN not returned for revocable admin', () => {
  const blockedReasonPos = latestSql.indexOf("'SELF_CHANGE_FORBIDDEN'");
  const eligibilitySection = latestSql.slice(blockedReasonPos, blockedReasonPos + 2000);
  assert.ok(eligibilitySection.includes('LAST_ACTIVE_SECURITY_ADMIN'), 'must check last admin for security admins');
  assert.ok(eligibilitySection.includes('ELIGIBLE'), 'must return ELIGIBLE for revocable admin');
});

// ═══ Audit RPC Tests ═════════════════════════════════════════════════════════

test('audit rpc: keyset pagination', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('p_before_created_at'), 'must use before_created_at cursor');
  assert.ok(auditRpc.includes('p_before_id'), 'must use before_id cursor');
});

test('audit rpc: sort by created_at DESC, id DESC', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
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
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('sanitize_audit_metadata'), 'must re-sanitize metadata');
});

test('audit rpc: ip and user_agent_hash not returned', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(!auditRpc.includes('ip_address'), 'must not return ip_address');
  assert.ok(!auditRpc.includes('ip_hash'), 'must not return ip_hash');
  assert.ok(!auditRpc.includes('user_agent_hash'), 'must not return user_agent_hash');
});

test('audit rpc: no anon execute', () => {
  assert.ok(latestSql.includes('REVOKE EXECUTE ON FUNCTION public.get_security_audit_page') && latestSql.includes('FROM anon'),
    'must revoke execute from anon on audit RPC');
});

test('audit rpc: non-security-admin rejected', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('SECURITY_ADMIN_REQUIRED'), 'must reject non-security-admin');
});

// ── NEW: Audit RPC pagination tests ─────────────────────────────────────────

test('audit rpc: limit before aggregate in CTE', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('page_plus_one'), 'must use page_plus_one CTE');
  assert.ok(auditRpc.includes('LIMIT v_limit + 1'), 'must limit to v_limit + 1 in subquery');
});

test('audit rpc: array does not contain limit+1 row', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('visible_page'), 'must use visible_page CTE');
  assert.ok(auditRpc.includes('LIMIT v_limit'), 'visible_page must limit to v_limit');
});

test('audit rpc: cursor from last visible row', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('v_last_created_at'), 'must extract last created_at');
  assert.ok(auditRpc.includes('v_last_id'), 'must extract last id');
  assert.ok(auditRpc.includes('v_count - 1'), 'must use last index of visible array');
});

test('audit rpc: empty page cursor is null', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
  assert.ok(auditRpc.includes('v_count > 0'), 'must check v_count > 0 before setting cursor');
  assert.ok(auditRpc.includes('v_next_cursor := NULL'), 'must set cursor to NULL for empty page');
});

test('audit rpc: nullable states use CASE WHEN IS NULL', () => {
  const auditRpc = latestSql.slice(latestSql.indexOf('get_security_audit_page'), latestSql.indexOf('ALTER FUNCTION public.get_security_audit_page'));
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
  if (!userMgmtPanelSource) return;

  const directProfileUpdatePayloads = [...userMgmtPanelSource.matchAll(/from\(['"]profiles['"]\)\.update\(\{([\s\S]*?)\}\)\.eq\(/g)]
    .map((match) => match[1]);

  for (const payload of directProfileUpdatePayloads) {
    assert.ok(!/\bis_security_admin\s*:/.test(payload),
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

// ═══ CTE Scope Tests (Blocker 1 & 2) ════════════════════════════════════════

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

function findStatementEnd(body: string, startPos: number): number {
  let depth = 0;
  let inString = false;
  let stringChar = '';
  for (let i = startPos; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (ch === stringChar) inString = false;
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth <= 0) return i;
  }
  return body.length;
}

test('cte scope: filtered_users not referenced after WITH statement in management RPC', () => {
  const body = extractFunctionBody(latestSql, 'get_security_admin_management_state');
  assert.ok(body.length > 0, 'must extract management RPC body');

  const withStart = body.indexOf('WITH filtered_users');
  assert.ok(withStart >= 0, 'must have WITH filtered_users');

  const stmtEnd = findStatementEnd(body, withStart);
  assert.ok(stmtEnd > withStart, 'must find statement end');

  const afterStmt = body.slice(stmtEnd + 1);
  assert.ok(!afterStmt.includes('filtered_users'),
    'filtered_users must not be referenced after the WITH statement ends');
});

test('cte scope: page_plus_one not referenced after WITH statement in management RPC', () => {
  const body = extractFunctionBody(latestSql, 'get_security_admin_management_state');
  assert.ok(body.length > 0, 'must extract management RPC body');

  const withStart = body.indexOf('WITH filtered_users');
  const stmtEnd = findStatementEnd(body, withStart);
  const afterStmt = body.slice(stmtEnd + 1);
  assert.ok(!afterStmt.includes('page_plus_one'),
    'page_plus_one must not be referenced after the WITH statement ends');
});

test('cte scope: management RPC computes users, has_more, total_matches in one statement', () => {
  const body = extractFunctionBody(latestSql, 'get_security_admin_management_state');
  assert.ok(body.length > 0, 'must extract management RPC body');

  const withStart = body.indexOf('WITH filtered_users');
  const stmtEnd = findStatementEnd(body, withStart);
  const stmt = body.slice(withStart, stmtEnd);

  assert.ok(stmt.includes('INTO'), 'must have INTO clause');
  assert.ok(stmt.includes('v_users'), 'must assign v_users');
  assert.ok(stmt.includes('v_has_more'), 'must assign v_has_more');
  assert.ok(stmt.includes('v_total_matches'), 'must assign v_total_matches');
});

test('cte scope: page_plus_one not referenced independently in audit RPC', () => {
  const body = extractFunctionBody(latestSql, 'get_security_audit_page');
  assert.ok(body.length > 0, 'must extract audit RPC body');

  const withStart = body.indexOf('WITH filtered_events');
  assert.ok(withStart >= 0, 'must have WITH filtered_events');

  const stmtEnd = findStatementEnd(body, withStart);
  assert.ok(stmtEnd > withStart, 'must find statement end');

  const afterStmt = body.slice(stmtEnd + 1);
  assert.ok(!afterStmt.includes('page_plus_one'),
    'page_plus_one must not be referenced after the WITH statement ends');
});

test('cte scope: audit RPC computes events and has_more in one statement', () => {
  const body = extractFunctionBody(latestSql, 'get_security_audit_page');
  assert.ok(body.length > 0, 'must extract audit RPC body');

  const withStart = body.indexOf('WITH filtered_events');
  const stmtEnd = findStatementEnd(body, withStart);
  const stmt = body.slice(withStart, stmtEnd);

  assert.ok(stmt.includes('INTO'), 'must have INTO clause');
  assert.ok(stmt.includes('v_events'), 'must assign v_events');
  assert.ok(stmt.includes('v_has_more'), 'must assign v_has_more');
});

// ═══ Target Alias Fix Tests (Blocker 3) ═══════════════════════════════════════

test('target alias: live function does not contain p.target_user_id', () => {
  const body = extractFunctionBody(latestSql, 'get_security_audit_page');
  assert.ok(body.length > 0, 'must extract audit RPC body');
  // Check for the exact typo pattern: e.target_user_id = p.target_user_id
  // (not vp.target_user_id which is a valid column reference)
  assert.ok(!body.includes('e.target_user_id = p.target_user_id'),
    'must not contain e.target_user_id = p.target_user_id (invalid alias)');
});

test('target alias: live function contains e.target_user_id = p_target_user_id', () => {
  const body = extractFunctionBody(latestSql, 'get_security_audit_page');
  assert.ok(body.length > 0, 'must extract audit RPC body');
  assert.ok(body.includes('e.target_user_id = p_target_user_id'),
    'must contain e.target_user_id = p_target_user_id');
});

// ═══ Fast Authorization Tests (Blocker 4) ════════════════════════════════════

test('setter: fast authorization check before global lock', () => {
  const body = extractFunctionBody(latestSql, 'set_user_security_admin');
  assert.ok(body.length > 0, 'must extract setter body');

  const fastAuthPos = body.indexOf('Fast authorization');
  const lockPos = body.indexOf('pg_advisory_xact_lock(987654321)');
  assert.ok(fastAuthPos >= 0, 'must have fast authorization comment');
  assert.ok(lockPos > fastAuthPos, 'fast auth must be before global lock');

  const fastAuthSection = body.slice(fastAuthPos, lockPos);
  assert.ok(fastAuthSection.includes('is_current_security_admin()'), 'must check is_current_security_admin before lock');
  assert.ok(fastAuthSection.includes('SECURITY_ADMIN_REQUIRED'), 'must return SECURITY_ADMIN_REQUIRED before lock');
});

test('setter: authorization check also after global lock', () => {
  const body = extractFunctionBody(latestSql, 'set_user_security_admin');
  assert.ok(body.length > 0, 'must extract setter body');

  const lockPos = body.indexOf('pg_advisory_xact_lock(987654321)');
  const recheckPos = body.indexOf('is_current_security_admin()', lockPos);
  assert.ok(recheckPos > lockPos, 'must re-check after lock');

  const recheckSection = body.slice(lockPos, recheckPos + 200);
  assert.ok(recheckSection.includes('FORBIDDEN'), 'must return FORBIDDEN after lock recheck');
});

// ═══ Frontend Invalid Filter Tests ═══════════════════════════════════════════

test('frontend: buildParams is pure (no setState inside)', () => {
  assert.ok(auditConsoleSource.includes('buildParams'), 'must have buildParams');
  const buildParamsStart = auditConsoleSource.indexOf('buildParams = useCallback');
  const buildParamsEnd = auditConsoleSource.indexOf('}, [', buildParamsStart);
  const buildParamsBody = auditConsoleSource.slice(buildParamsStart, buildParamsEnd);
  assert.ok(!buildParamsBody.includes('setActorError'), 'buildParams must not call setActorError');
  assert.ok(!buildParamsBody.includes('setTargetError'), 'buildParams must not call setTargetError');
  assert.ok(!buildParamsBody.includes('setEvents'), 'buildParams must not call setEvents');
  assert.ok(!buildParamsBody.includes('setLoading'), 'buildParams must not call setLoading');
});

test('frontend: invalid actor UUID does not trigger RPC', () => {
  const loadInitialStart = auditConsoleSource.indexOf('loadInitial = useCallback');
  const loadInitialBody = auditConsoleSource.slice(loadInitialStart, loadInitialStart + 2000);
  assert.ok(loadInitialBody.includes('if (!params)'), 'loadInitial must check params null');
  assert.ok(loadInitialBody.includes('return;'), 'loadInitial must return early on null params');
});

test('frontend: invalid target UUID does not trigger RPC', () => {
  const loadInitialStart = auditConsoleSource.indexOf('loadInitial = useCallback');
  const loadInitialBody = auditConsoleSource.slice(loadInitialStart, loadInitialStart + 2000);
  assert.ok(loadInitialBody.includes('UUID_REGEX'), 'loadInitial must validate UUID');
  assert.ok(loadInitialBody.includes('UUID نامعتبر'), 'must show UUID error message');
});

test('frontend: invalid filter does not lock UI in loading state', () => {
  const loadInitialStart = auditConsoleSource.indexOf('loadInitial = useCallback');
  const loadInitialBody = auditConsoleSource.slice(loadInitialStart, loadInitialStart + 2000);
  assert.ok(loadInitialBody.includes('setLoading(false)'), 'must set loading to false on invalid params');
  assert.ok(loadInitialBody.includes('setLoadingMore(false)'), 'must set loadingMore to false on invalid params');
});

test('frontend: handleLoadMore checks buildParams null before RPC', () => {
  const loadMoreStart = auditConsoleSource.indexOf('handleLoadMore = useCallback');
  const loadMoreBody = auditConsoleSource.slice(loadMoreStart, loadMoreStart + 1500);
  assert.ok(loadMoreBody.includes('const params = buildParams()'), 'must call buildParams');
  assert.ok(loadMoreBody.includes('if (!params)'), 'must check params null');
  assert.ok(loadMoreBody.includes('setLoadingMore(false)'), 'must set loadingMore false on null');
  assert.ok(loadMoreBody.includes('return;'), 'must return early on null params');
});

test('frontend: no spread of buildParams without null check', () => {
  assert.ok(!auditConsoleSource.includes('...buildParams()'), 'must not spread buildParams() without null check');
});

test('frontend: date helper uses tehranDateToUtcRange', () => {
  assert.ok(auditConsoleSource.includes('tehranDateToUtcRange'), 'must use tehranDateToUtcRange');
  assert.ok(!auditConsoleSource.includes('dateToUtcStartOfDay'), 'must not use old dateToUtcStartOfDay');
  assert.ok(!auditConsoleSource.includes('dateToUtcEndOfDay'), 'must not use old dateToUtcEndOfDay');
  assert.ok(!auditConsoleSource.includes('Date.UTC'), 'must not use Date.UTC directly in audit console');
  assert.ok(!auditConsoleSource.includes('setHours'), 'must not use setHours (local mutation)');
});

test('frontend: date error message displayed for invalid date', () => {
  assert.ok(auditConsoleSource.includes('تاریخ واردشده معتبر نیست.'), 'must show date error message');
  assert.ok(auditConsoleSource.includes('dateError'), 'must have dateError state');
});

test('frontend: invalid date does not trigger RPC', () => {
  const buildParamsStart = auditConsoleSource.indexOf('buildParams = useCallback');
  const buildParamsEnd = auditConsoleSource.indexOf('}, [', buildParamsStart);
  const buildParamsBody = auditConsoleSource.slice(buildParamsStart, buildParamsEnd);
  assert.ok(buildParamsBody.includes('tehranDateToUtcRange'), 'buildParams must use tehranDateToUtcRange');
  assert.ok(buildParamsBody.includes('return null'), 'buildParams must return null on invalid date');
});

test('frontend: no RPC with invalid date', () => {
  const loadInitialStart = auditConsoleSource.indexOf('loadInitial = useCallback');
  const loadInitialBody = auditConsoleSource.slice(loadInitialStart, loadInitialStart + 2000);
  assert.ok(loadInitialBody.includes('if (!params)'), 'loadInitial must check params null');
  assert.ok(loadInitialBody.includes('setLoading(false)'), 'must set loading to false on invalid date');
  assert.ok(loadInitialBody.includes('setLoadingMore(false)'), 'must set loadingMore to false on invalid date');
});

// ═══ Tehran Timezone Utility Tests ═══════════════════════════════════════════

test('tehran tz: 2026-08-05 start and end UTC correct', () => {
  const range = tehranDateToUtcRange('2026-08-05');
  assert.ok(range, 'must return range for valid date');
  assert.equal(range!.startUtc, '2026-08-04T20:30:00.000Z',
    `start must be 2026-08-04T20:30:00.000Z, got ${range!.startUtc}`);
  assert.equal(range!.endUtc, '2026-08-05T20:29:59.999Z',
    `end must be 2026-08-05T20:29:59.999Z, got ${range!.endUtc}`);
});

test('tehran tz: 2026-01-01 start and end UTC correct', () => {
  const range = tehranDateToUtcRange('2026-01-01');
  assert.ok(range, 'must return range for valid date');
  // Iran standard offset is +03:30 (no DST in 2026 as Iran abolished DST in 2022)
  assert.equal(range!.startUtc, '2025-12-31T20:30:00.000Z',
    `start must be 2025-12-31T20:30:00.000Z, got ${range!.startUtc}`);
  assert.equal(range!.endUtc, '2026-01-01T20:29:59.999Z',
    `end must be 2026-01-01T20:29:59.999Z, got ${range!.endUtc}`);
});

test('tehran tz: invalid date 2026-02-30 returns null', () => {
  const range = tehranDateToUtcRange('2026-02-30');
  assert.equal(range, null, '2026-02-30 must return null');
});

test('tehran tz: invalid month 2026-13-01 returns null', () => {
  const range = tehranDateToUtcRange('2026-13-01');
  assert.equal(range, null, '2026-13-01 must return null');
});

test('tehran tz: invalid format 05/08/2026 returns null', () => {
  const range = tehranDateToUtcRange('05/08/2026');
  assert.equal(range, null, '05/08/2026 must return null');
});

test('tehran tz: empty string returns null', () => {
  const range = tehranDateToUtcRange('');
  assert.equal(range, null, 'empty string must return null');
});

test('tehran tz: consecutive days have no gap or overlap', () => {
  const day1 = tehranDateToUtcRange('2026-08-05');
  const day2 = tehranDateToUtcRange('2026-08-06');
  assert.ok(day1 && day2, 'both dates must be valid');
  const end1Ms = Date.parse(day1!.endUtc);
  const start2Ms = Date.parse(day2!.startUtc);
  assert.equal(start2Ms - end1Ms, 1, 'end day N + 1ms must equal start day N+1');
});

test('tehran tz: result independent of process.env.TZ', () => {
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const rangeNy = tehranDateToUtcRange('2026-08-05');
    process.env.TZ = 'Asia/Tehran';
    const rangeTehran = tehranDateToUtcRange('2026-08-05');
    process.env.TZ = 'UTC';
    const rangeUtc = tehranDateToUtcRange('2026-08-05');
    assert.ok(rangeNy && rangeTehran && rangeUtc, 'all must return valid ranges');
    assert.equal(rangeNy!.startUtc, rangeTehran!.startUtc, 'NY and Tehran TZ must match');
    assert.equal(rangeNy!.startUtc, rangeUtc!.startUtc, 'NY and UTC TZ must match');
    assert.equal(rangeNy!.endUtc, rangeTehran!.endUtc, 'NY and Tehran end must match');
  } finally {
    if (originalTz !== undefined) {
      process.env.TZ = originalTz;
    } else {
      delete process.env.TZ;
    }
  }
});

test('tehran tz: leap year 2024-02-29 valid', () => {
  const range = tehranDateToUtcRange('2024-02-29');
  assert.ok(range, '2024-02-29 must be valid (leap year)');
});

test('tehran tz: non-leap year 2025-02-29 returns null', () => {
  const range = tehranDateToUtcRange('2025-02-29');
  assert.equal(range, null, '2025-02-29 must return null (non-leap year)');
});

test('tehran tz: uses Intl.DateTimeFormat not hardcoded offset', () => {
  const utilSource = fs.readFileSync(
    path.join(__dirname, '../../src/features/security-administration/utils/tehranDateRange.ts'),
    'utf-8'
  );
  assert.ok(utilSource.includes('Intl.DateTimeFormat'), 'must use Intl.DateTimeFormat');
  assert.ok(utilSource.includes("'Asia/Tehran'"), 'must reference Asia/Tehran timezone');
  assert.ok(!utilSource.includes('+03:30'), 'must not hardcode +03:30 offset');
});

test('frontend: buildParams returns null on invalid UUID', () => {
  const buildParamsStart = auditConsoleSource.indexOf('buildParams = useCallback');
  const buildParamsEnd = auditConsoleSource.indexOf('}, [', buildParamsStart);
  const buildParamsBody = auditConsoleSource.slice(buildParamsStart, buildParamsEnd);
  assert.ok(buildParamsBody.includes('return null'), 'buildParams must return null on invalid UUID');
});
