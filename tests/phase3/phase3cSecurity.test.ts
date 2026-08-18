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
const driftFixMigrationName = '20260805050720_20260805060000_phase3c_read_rpc_runtime_and_artifact_drift_fix.sql.sql';

const originalMigrationPath = path.join(migrationDir, originalMigrationName);
const fixMigrationPath = path.join(migrationDir, fixMigrationName);
const driftFixMigrationPath = path.join(migrationDir, driftFixMigrationName);
const originalSql = fs.existsSync(originalMigrationPath) ? fs.readFileSync(originalMigrationPath, 'utf-8') : '';
const fixSql = fs.existsSync(fixMigrationPath) ? fs.readFileSync(fixMigrationPath, 'utf-8') : '';
const driftFixSql = fs.existsSync(driftFixMigrationPath) ? fs.readFileSync(driftFixMigrationPath, 'utf-8') : '';
const combinedSql = originalSql + '\n' + fixSql + '\n' + driftFixSql;
const latestSql = driftFixSql || fixSql;
const stepUpDialogSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-settings/components/SecurityStepUpDialog.tsx'), 'utf-8');
const settingsConsoleSource = fs.readFileSync(path.join(__dirname, '../../src/features/security-settings/components/SecuritySettingsConsole.tsx'), 'utf-8');
const userMgmtPanelSource = fs.existsSync(path.join(__dirname, '../../src/components/UserManagementPanel.tsx')) ? fs.readFileSync(path.join(__dirname, '../../src/components/UserManagementPanel.tsx'), 'utf-8') : '';

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

test('frontend: SecuritySettingsConsole uses auth_settings_change purpose', () => {
  assert.ok(settingsConsoleSource.includes('auth_settings_change'), 'SecuritySettingsConsole must use auth_settings_change purpose');
});

// ── NEW: Frontend setter/reload tests ──────────────────────────────────────

test('frontend: onSuccess in step-up dialog is awaited', () => {
  assert.ok(stepUpDialogSource.includes('await onSuccess()'), 'must await onSuccess()');
});
