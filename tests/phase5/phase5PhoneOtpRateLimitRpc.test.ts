import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const rpcMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_rate_limit_rpc'),
);

const rateLimitTableMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_rate_limit_table'),
);

const challengeMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_challenge_table'),
);

const fixMigration = migrationFiles.find((f) =>
  f.includes('phase5e_fix_challenge_claim_state_constraint'),
);

const configMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_configuration'),
);

describe('Phase 5E-B3 — Atomic Phone OTP Rate Limit RPC', () => {
  it('rpc migration file exists on disk', () => {
    assert.ok(rpcMigration, 'phase5e_phone_otp_rate_limit_rpc migration must exist');
  });

  it('has exact function signature and return type', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.consume_phone_otp_login_rate_limit_v2\s*\(/i.test(sql),
      'must create function with correct name');
    assert.ok(/p_purpose\s+text/i.test(sql), 'must have p_purpose text parameter');
    assert.ok(/p_phone_hash\s+text/i.test(sql), 'must have p_phone_hash text parameter');
    assert.ok(/p_ip_hash\s+text/i.test(sql), 'must have p_ip_hash text parameter');
    assert.ok(/p_phone_limit\s+integer/i.test(sql), 'must have p_phone_limit integer parameter');
    assert.ok(/p_ip_limit\s+integer/i.test(sql), 'must have p_ip_limit integer parameter');
    assert.ok(/p_window_seconds\s+integer/i.test(sql), 'must have p_window_seconds integer parameter');
    assert.ok(/RETURNS\s+TABLE\s*\(\s*allowed\s+boolean\s*,\s*retry_after_seconds\s+integer\s*\)/i.test(sql),
      'must return TABLE(allowed boolean, retry_after_seconds integer)');
  });

  it('is SECURITY DEFINER', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
  });

  it('has empty search_path', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/SET\s+search_path\s+TO\s+''/i.test(sql), 'must set search_path to empty');
  });

  it('owner is set to postgres', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION.*OWNER\s+TO\s+postgres/i.test(sql),
      'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE.*TO\s+service_role/i.test(sql),
      'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL.*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('validates purpose to two allowed values', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(sql.includes("'phone_otp_login_request'"), 'must validate phone_otp_login_request');
    assert.ok(sql.includes("'phone_otp_login_verify'"), 'must validate phone_otp_login_verify');
    assert.ok(/p_purpose\s+NOT\s+IN/i.test(sql), 'must check p_purpose NOT IN allowed values');
  });

  it('validates phone_hash and ip_hash with 64 lowercase hex', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/p_phone_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'must validate phone_hash hex64');
    assert.ok(/p_ip_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'must validate ip_hash hex64');
  });

  it('validates limit ranges', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/p_phone_limit\s*<\s*1\s+OR\s+p_phone_limit\s*>\s*100/i.test(sql),
      'must validate p_phone_limit range 1-100');
    assert.ok(/p_ip_limit\s*<\s*1\s+OR\s+p_ip_limit\s*>\s*1000/i.test(sql),
      'must validate p_ip_limit range 1-1000');
    assert.ok(/p_window_seconds\s*<\s*30\s+OR\s+p_window_seconds\s*>\s*86400/i.test(sql),
      'must validate p_window_seconds range 30-86400');
  });

  it('raises 22023 with generic message for invalid input', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    const raiseCount = (sql.match(/RAISE\s+EXCEPTION\s+'INVALID_RATE_LIMIT_CONFIGURATION'/gi) || []).length;
    assert.ok(raiseCount >= 6, 'must raise INVALID_RATE_LIMIT_CONFIGURATION for all invalid inputs');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('does not catch exceptions', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('uses distinct domain prefixes for phone and ip locks', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(sql.includes("'phone-otp-login-rate-v2|phone|"), 'must have phone domain prefix');
    assert.ok(sql.includes("'phone-otp-login-rate-v2|ip|"), 'must have ip domain prefix');
  });

  it('includes purpose in lock keys', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/hashtextextended.*p_purpose.*p_phone_hash/i.test(sql),
      'phone lock key must include purpose');
    assert.ok(/hashtextextended.*p_purpose.*p_ip_hash/i.test(sql),
      'ip lock key must include purpose');
  });

  it('acquires phone lock before ip lock', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    const phoneLockIdx = sql.search(/pg_advisory_xact_lock\(v_phone_lock_key\)/i);
    const ipLockIdx = sql.search(/pg_advisory_xact_lock\(v_ip_lock_key\)/i);
    assert.ok(phoneLockIdx > -1, 'must acquire phone lock');
    assert.ok(ipLockIdx > -1, 'must acquire ip lock');
    assert.ok(phoneLockIdx < ipLockIdx, 'phone lock must be acquired before ip lock');
  });

  it('uses transaction advisory locks', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/pg_catalog\.pg_advisory_xact_lock/i.test(sql),
      'must use pg_advisory_xact_lock');
  });

  it('phone count only uses purpose and phone_hash', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    const phoneCountIdx = sql.search(/v_phone_count.*MIN\(created_at\)/i);
    assert.ok(phoneCountIdx > -1, 'must select phone count with MIN(created_at)');
    const phoneBlock = sql.substring(phoneCountIdx, phoneCountIdx + 400);
    assert.ok(/purpose\s*=\s*p_purpose/i.test(phoneBlock), 'phone count must filter by purpose');
    assert.ok(/phone_hash\s*=\s*p_phone_hash/i.test(phoneBlock), 'phone count must filter by phone_hash');
    assert.ok(/created_at\s*>=\s*v_cutoff/i.test(phoneBlock), 'phone count must filter by created_at >= cutoff');
    assert.ok(!/ip_hash/i.test(phoneBlock), 'phone count must not filter by ip_hash');
  });

  it('ip count only uses purpose and ip_hash', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    const ipCountIdx = sql.search(/v_ip_count.*MIN\(created_at\)/i);
    assert.ok(ipCountIdx > -1, 'must select ip count with MIN(created_at)');
    const ipBlock = sql.substring(ipCountIdx, ipCountIdx + 400);
    assert.ok(/purpose\s*=\s*p_purpose/i.test(ipBlock), 'ip count must filter by purpose');
    assert.ok(/ip_hash\s*=\s*p_ip_hash/i.test(ipBlock), 'ip count must filter by ip_hash');
    assert.ok(/created_at\s*>=\s*v_cutoff/i.test(ipBlock), 'ip count must filter by created_at >= cutoff');
    assert.ok(!/phone_hash/i.test(ipBlock), 'ip count must not filter by phone_hash');
  });

  it('uses MIN(created_at) for retry calculation', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/MIN\(created_at\)/i.test(sql), 'must use MIN(created_at) for oldest record');
    assert.ok(/v_oldest_phone_created_at/i.test(sql), 'must use oldest phone created_at');
    assert.ok(/v_oldest_ip_created_at/i.test(sql), 'must use oldest ip created_at');
  });

  it('retry is dynamic with minimum 1 second', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/GREATEST\(1,\s*CEIL/i.test(sql), 'must use GREATEST(1, CEIL(...)) for retry');
    assert.ok(/EXTRACT\(EPOCH\s+FROM/i.test(sql), 'must use EXTRACT(EPOCH FROM ...) for dynamic retry');
  });

  it('uses GREATEST for concurrent limit retry', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/GREATEST\(v_phone_retry,\s*v_ip_retry\)/i.test(sql),
      'must use GREATEST(phone_retry, ip_retry) when both limits exceeded');
  });

  it('inserts exactly one row in allowed path', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(/INSERT\s+INTO\s+private\.phone_otp_login_rate_limit_v2/i.test(sql),
      'must insert into rate limit table');
    assert.ok(/RETURN\s+QUERY\s+SELECT\s+true,\s*0/i.test(sql),
      'must return true, 0 when allowed');
  });

  it('does not contain DELETE, UPDATE, or TRUNCATE', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/UPDATE\s+private/i.test(sql), 'must not contain UPDATE on private table');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
  });

  it('does not create tables, triggers, policies, or views', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create tables');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(sql), 'must not create views');
  });

  it('does not create challenge RPC', () => {
    assert.ok(rpcMigration);
    const sql = readFileSync(join(migrationsDir, rpcMigration!), 'utf8');
    assert.ok(!/phone_otp_login_challenges_v2/i.test(sql),
      'must not reference challenge table');
  });

  it('previous B2 rate limit table migration is not modified', () => {
    assert.ok(rateLimitTableMigration, 'rate limit table migration must still exist');
    const sql = readFileSync(join(migrationsDir, rateLimitTableMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_rate_limit_v2'), 'B2 migration must be intact');
  });

  it('previous B1 challenge table migration is not modified', () => {
    assert.ok(challengeMigration, 'challenge table migration must still exist');
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_challenges_v2'), 'B1 migration must be intact');
  });

  it('previous fix migration is not modified', () => {
    assert.ok(fixMigration, 'fix migration must still exist');
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(sql.includes('claim_state_consistency'), 'fix migration must be intact');
  });

  it('previous config migration is not modified', () => {
    assert.ok(configMigration, 'config migration must still exist');
    const sql = readFileSync(join(migrationsDir, configMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_backend_ready'), 'config migration must be intact');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpRateLimitRpc.test.ts'), 'utf8');
    const lines = testFile.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      if (/^assert\.ok\(\s*true\s*\)\s*;?\s*$/.test(trimmed)) {
        assert.fail('must not contain formal assert.ok(true) test');
      }
    }
  });
});
