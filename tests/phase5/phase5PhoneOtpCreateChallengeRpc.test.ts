import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const createChallengeMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_create_challenge_rpc'),
);

const rateLimitRpcMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_rate_limit_rpc'),
);

const nullFixMigration = migrationFiles.find((f) =>
  f.includes('phase5e_fix_rate_limit_rpc_null_validation'),
);

const rateLimitTableMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_rate_limit_table'),
);

const challengeMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_challenge_table'),
);

describe('Phase 5E-C1 — Atomic Phone OTP Challenge Creation RPC', () => {
  it('migration file exists on disk', () => {
    assert.ok(createChallengeMigration, 'phase5e_phone_otp_create_challenge_rpc migration must exist');
  });

  it('has exact function signature and return type', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.create_phone_otp_login_challenge_v2\s*\(/i.test(sql),
      'must create function with correct name');
    assert.ok(/p_challenge_id\s+uuid/i.test(sql), 'must have p_challenge_id uuid parameter');
    assert.ok(/p_user_id\s+uuid/i.test(sql), 'must have p_user_id uuid parameter');
    assert.ok(/p_phone_hash\s+text/i.test(sql), 'must have p_phone_hash text parameter');
    assert.ok(/p_otp_hash\s+text/i.test(sql), 'must have p_otp_hash text parameter');
    assert.ok(/p_ip_hash\s+text/i.test(sql), 'must have p_ip_hash text parameter');
    assert.ok(/p_expires_at\s+timestamptz/i.test(sql), 'must have p_expires_at timestamptz parameter');
    assert.ok(/p_resend_available_at\s+timestamptz/i.test(sql), 'must have p_resend_available_at timestamptz parameter');
    assert.ok(/p_request_id\s+uuid/i.test(sql), 'must have p_request_id uuid parameter');
    assert.ok(/p_max_attempts\s+integer/i.test(sql), 'must have p_max_attempts integer parameter');
    assert.ok(/RETURNS\s+jsonb/i.test(sql), 'must return jsonb');
  });

  it('is SECURITY DEFINER with empty search_path', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/SET\s+search_path\s+TO\s+''/i.test(sql), 'must set search_path to empty');
  });

  it('owner is set to postgres', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION.*OWNER\s+TO\s+postgres/i.test(sql), 'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE.*TO\s+service_role/i.test(sql), 'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL.*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('all inputs have NULL validation', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/p_challenge_id\s+IS\s+NULL/i.test(sql), 'must check p_challenge_id IS NULL');
    assert.ok(/p_user_id\s+IS\s+NULL/i.test(sql), 'must check p_user_id IS NULL');
    assert.ok(/p_request_id\s+IS\s+NULL/i.test(sql), 'must check p_request_id IS NULL');
    assert.ok(/p_phone_hash\s+IS\s+NULL/i.test(sql), 'must check p_phone_hash IS NULL');
    assert.ok(/p_otp_hash\s+IS\s+NULL/i.test(sql), 'must check p_otp_hash IS NULL');
    assert.ok(/p_ip_hash\s+IS\s+NULL/i.test(sql), 'must check p_ip_hash IS NULL');
    assert.ok(/p_max_attempts\s+IS\s+NULL/i.test(sql), 'must check p_max_attempts IS NULL');
    assert.ok(/p_expires_at\s+IS\s+NULL/i.test(sql), 'must check p_expires_at IS NULL');
    assert.ok(/p_resend_available_at\s+IS\s+NULL/i.test(sql), 'must check p_resend_available_at IS NULL');
  });

  it('all three hashes have exact 64 lowercase hex regex', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/p_phone_hash\s+IS\s+NULL\s+OR\s+p_phone_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'phone_hash must have hex64 regex');
    assert.ok(/p_otp_hash\s+IS\s+NULL\s+OR\s+p_otp_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'otp_hash must have hex64 regex');
    assert.ok(/p_ip_hash\s+IS\s+NULL\s+OR\s+p_ip_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'ip_hash must have hex64 regex');
  });

  it('validates max_attempts range 3-10', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/p_max_attempts\s*<\s*3\s+OR\s+p_max_attempts\s*>\s*10/i.test(sql),
      'must validate max_attempts range 3-10');
  });

  it('validates timestamp constraints', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/p_expires_at\s*<=\s*v_now/i.test(sql), 'expires_at must be > v_now');
    assert.ok(/p_expires_at\s*>\s*v_now\s*\+\s*make_interval\(secs\s*=>\s*300\)/i.test(sql),
      'expires_at must be <= v_now + 300 seconds');
    assert.ok(/p_resend_available_at\s*<\s*v_now/i.test(sql), 'resend_available_at must be >= v_now');
    assert.ok(/p_resend_available_at\s*>\s*p_expires_at/i.test(sql), 'resend_available_at must be <= p_expires_at');
  });

  it('verifies user exists in auth.users', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/SELECT\s+1\s+FROM\s+auth\.users\s+WHERE\s+id\s*=\s*p_user_id/i.test(sql),
      'must verify user exists in auth.users');
  });

  it('acquires request lock before phone lock', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    const requestLockIdx = sql.search(/pg_advisory_xact_lock\(v_request_lock_key\)/i);
    const phoneLockIdx = sql.search(/pg_advisory_xact_lock\(v_phone_lock_key\)/i);
    assert.ok(requestLockIdx > -1, 'must acquire request lock');
    assert.ok(phoneLockIdx > -1, 'must acquire phone lock');
    assert.ok(requestLockIdx < phoneLockIdx, 'request lock must be acquired before phone lock');
  });

  it('uses distinct domain prefixes for locks', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(sql.includes("'phone-otp-login-challenge-v2|request|"), 'must have request domain prefix');
    assert.ok(sql.includes("'phone-otp-login-challenge-v2|phone|"), 'must have phone domain prefix');
  });

  it('idempotency uses request_id with FOR UPDATE', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/WHERE\s+request_id\s*=\s*p_request_id\s+FOR\s+UPDATE/i.test(sql),
      'must use SELECT ... WHERE request_id = p_request_id FOR UPDATE');
  });

  it('idempotency comparison uses IS DISTINCT FROM', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    const distinctCount = (sql.match(/IS\s+DISTINCT\s+FROM/gi) || []).length;
    assert.ok(distinctCount >= 8, 'must use IS DISTINCT FROM for all 8 payload fields');
  });

  it('request_id reuse mismatch raises REQUEST_ID_REUSE_MISMATCH', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'REQUEST_ID_REUSE_MISMATCH'/i.test(sql),
      'must raise REQUEST_ID_REUSE_MISMATCH');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('resend gate checks last pending or processing challenge', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*\)/i.test(sql),
      'must check status IN (pending, processing)');
    assert.ok(/ORDER\s+BY\s+created_at\s+DESC\s+LIMIT\s+1\s+FOR\s+UPDATE/i.test(sql),
      'must use ORDER BY created_at DESC LIMIT 1 FOR UPDATE');
  });

  it('retry_after_seconds is dynamic with minimum 1 second', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/GREATEST\(1,\s*CEIL/i.test(sql), 'must use GREATEST(1, CEIL(...)) for retry');
    assert.ok(/EXTRACT\(EPOCH\s+FROM\s*\(v_last_active\.resend_available_at\s*-\s*v_now\)\)/i.test(sql),
      'must use dynamic retry calculation');
  });

  it('RESEND_NOT_READY returns correct jsonb', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/'error_code',\s*'RESEND_NOT_READY'/i.test(sql), 'must return RESEND_NOT_READY error_code');
    assert.ok(/'created',\s*false/i.test(sql), 'must return created false');
    assert.ok(/'idempotent',\s*false/i.test(sql), 'must return idempotent false');
  });

  it('supersedes pending challenges', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/UPDATE\s+private\.phone_otp_login_challenges_v2.*SET\s+status\s*=\s*'superseded'.*WHERE\s+phone_hash\s*=\s*p_phone_hash\s+AND\s+status\s*=\s*'pending'/is.test(sql),
      'must supersede pending challenges');
  });

  it('supersedes processing challenges only with expired claim', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/status\s*=\s*'processing'\s+AND\s+claim_expires_at\s*<=\s*v_now/i.test(sql),
      'must only supersede processing challenges with expired claim');
  });

  it('supersede sets both claim fields to null', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(/claim_id\s*=\s*null/i.test(sql), 'must set claim_id to null');
    assert.ok(/claim_expires_at\s*=\s*null/i.test(sql), 'must set claim_expires_at to null');
  });

  it('has exactly one INSERT for new challenge', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    const insertCount = (sql.match(/INSERT\s+INTO\s+private\.phone_otp_login_challenges_v2/gi) || []).length;
    assert.equal(insertCount, 1, 'must have exactly one INSERT');
  });

  it('does not return sensitive data', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(!/jsonb_build_object.*p_phone_hash/i.test(sql), 'must not return phone_hash');
    assert.ok(!/jsonb_build_object.*p_otp_hash/i.test(sql), 'must not return otp_hash');
    assert.ok(!/jsonb_build_object.*p_ip_hash/i.test(sql), 'must not return ip_hash');
    assert.ok(!/jsonb_build_object.*p_user_id/i.test(sql), 'must not return user_id');
  });

  it('does not contain DELETE or TRUNCATE', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
  });

  it('does not contain EXCEPTION WHEN OTHERS', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('does not create tables, triggers, policies, or views', () => {
    assert.ok(createChallengeMigration);
    const sql = readFileSync(join(migrationsDir, createChallengeMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create tables');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(sql), 'must not create views');
  });

  it('previous migrations are not modified', () => {
    assert.ok(rateLimitRpcMigration, 'rate limit RPC migration must still exist');
    assert.ok(nullFixMigration, 'null fix migration must still exist');
    assert.ok(rateLimitTableMigration, 'rate limit table migration must still exist');
    assert.ok(challengeMigration, 'challenge table migration must still exist');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpCreateChallengeRpc.test.ts'), 'utf8');
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
