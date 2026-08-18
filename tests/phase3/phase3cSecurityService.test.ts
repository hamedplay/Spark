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
