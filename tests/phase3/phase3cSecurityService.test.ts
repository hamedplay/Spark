import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const migrationDir = path.join(__dirname, '../../supabase/migrations');
const fixMigrationName = '20260805043822_20260805050000_phase3c_security_admin_runtime_and_pagination_fixes.sql.sql';
const driftFixMigrationName = '20260805050720_20260805060000_phase3c_read_rpc_runtime_and_artifact_drift_fix.sql.sql';
const fixMigrationPath = path.join(migrationDir, fixMigrationName);
const driftFixMigrationPath = path.join(migrationDir, driftFixMigrationName);
const fixSql = fs.existsSync(fixMigrationPath) ? fs.readFileSync(fixMigrationPath, 'utf-8') : '';
const driftFixSql = fs.existsSync(driftFixMigrationPath) ? fs.readFileSync(driftFixMigrationPath, 'utf-8') : '';
const latestSql = driftFixSql || fixSql;

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
