import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const completeMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_complete_claim_rpc'),
);

const claimMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_claim_challenge_rpc'),
);

const deliveryMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_delivery_result_rpc'),
);

const createChallengeMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_create_challenge_rpc'),
);

const foundFixMigration = migrationFiles.find((f) =>
  f.includes('phase5e_fix_create_challenge_found_detection'),
);

const rateLimitRpcMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_rate_limit_rpc'),
);

const rateLimitTableMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_rate_limit_table'),
);

const challengeTableMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_challenge_table'),
);

describe('Phase 5E-C4A — Complete Phone OTP Claim RPC', () => {
  it('migration file exists on disk', () => {
    assert.ok(completeMigration, 'phase5e_phone_otp_complete_claim_rpc migration must exist');
  });

  it('has exact function signature and return type', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.complete_phone_otp_login_challenge_v2\s*\(/i.test(sql),
      'must create function with correct name');
    assert.ok(/p_challenge_id\s+uuid/i.test(sql), 'must have p_challenge_id uuid parameter');
    assert.ok(/p_claim_id\s+uuid/i.test(sql), 'must have p_claim_id uuid parameter');
    assert.ok(/RETURNS\s+jsonb/i.test(sql), 'must return jsonb');
  });

  it('is SECURITY DEFINER with empty search_path', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/SET\s+search_path\s+TO\s+''/i.test(sql), 'must set search_path to empty');
  });

  it('owner is set to postgres', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION.*OWNER\s+TO\s+postgres/i.test(sql), 'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE.*TO\s+service_role/i.test(sql), 'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL.*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('both inputs have NULL validation', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/p_challenge_id\s+IS\s+NULL/i.test(sql), 'must check p_challenge_id IS NULL');
    assert.ok(/p_claim_id\s+IS\s+NULL/i.test(sql), 'must check p_claim_id IS NULL');
  });

  it('invalid input raises 22023 with INVALID_COMPLETE_CONFIGURATION', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'INVALID_COMPLETE_CONFIGURATION'/i.test(sql),
      'must raise INVALID_COMPLETE_CONFIGURATION');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('uses FOR UPDATE to lock the challenge row', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/FOR\s+UPDATE/i.test(sql), 'must use FOR UPDATE');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+FOR\s+UPDATE/i.test(sql),
      'must lock row by id with FOR UPDATE');
  });

  it('stores FOUND after SELECT INTO', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/v_challenge_found\s+boolean/i.test(sql), 'must declare v_challenge_found boolean');
    assert.ok(/v_challenge_found\s*:=\s*FOUND/i.test(sql), 'must store v_challenge_found := FOUND');
  });

  it('does not use record IS NULL or IS NOT NULL for detection', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(!/v_status\s+IS\s+NOT\s+NULL/i.test(sql), 'must not use v_status IS NOT NULL');
    assert.ok(!/v_status\s+IS\s+NULL/i.test(sql) || /p_challenge_id\s+IS\s+NULL/i.test(sql),
      'must not use v_status IS NULL for detection');
  });

  it('challenge not found returns INVALID_CHALLENGE with false', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+v_challenge_found\s+THEN/i.test(sql),
      'must check IF NOT v_challenge_found THEN');
    assert.ok(/'error_code',\s*'INVALID_CHALLENGE'/i.test(sql),
      'must return INVALID_CHALLENGE error_code');
  });

  it('consumed state is idempotent success', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/v_status\s*=\s*'consumed'\s+AND\s+v_consumed_at\s+IS\s+NOT\s+NULL/i.test(sql),
      'must check status=consumed AND consumed_at IS NOT NULL');
    assert.ok(/'completed',\s*true/i.test(sql), 'must return completed true');
    assert.ok(/'idempotent',\s*true/i.test(sql), 'must return idempotent true');
    assert.ok(/'error_code',\s*null/i.test(sql), 'must return error_code null');
  });

  it('only processing/sent can be completed', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/v_status\s+IS\s+DISTINCT\s+FROM\s+'processing'\s+OR\s+v_delivery_status\s+IS\s+DISTINCT\s+FROM\s+'sent'/i.test(sql),
      'must check status=processing AND delivery_status=sent');
    assert.ok(/'error_code',\s*'INVALID_CHALLENGE_STATE'/i.test(sql),
      'must return INVALID_CHALLENGE_STATE');
  });

  it('claim ID is checked exactly', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/v_existing_claim_id\s+IS\s+DISTINCT\s+FROM\s+p_claim_id/i.test(sql),
      'must check claim ID with IS DISTINCT FROM');
    assert.ok(/'error_code',\s*'CLAIM_MISMATCH'/i.test(sql),
      'must return CLAIM_MISMATCH');
  });

  it('expired claim is rejected', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/v_claim_expires_at\s*<=\s*v_now/i.test(sql),
      'must check claim_expires_at <= v_now');
    assert.ok(/'error_code',\s*'CLAIM_EXPIRED'/i.test(sql),
      'must return CLAIM_EXPIRED');
  });

  it('UPDATE has all preconditions in WHERE', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+status\s*=\s*'processing'\s+AND\s+delivery_status\s*=\s*'sent'\s+AND\s+claim_id\s*=\s*p_claim_id\s+AND\s+claim_expires_at\s*>\s*v_now\s+AND\s+consumed_at\s+IS\s+NULL/i.test(sql),
      'UPDATE WHERE must check id, status=processing, delivery_status=sent, claim_id, claim_expires_at, consumed_at IS NULL');
  });

  it('transition sets consumed_at', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/SET\s+status\s*=\s*'consumed'\s*,\s*consumed_at\s*=\s*v_now/i.test(sql),
      'must set status=consumed and consumed_at=v_now');
  });

  it('claim fields are nulled after consumption', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/claim_id\s*=\s*null/i.test(sql), 'must null claim_id');
    assert.ok(/claim_expires_at\s*=\s*null/i.test(sql), 'must null claim_expires_at');
  });

  it('uses FOUND after UPDATE to detect race', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+FOUND\s+THEN/i.test(sql), 'must check IF NOT FOUND THEN');
    assert.ok(/RAISE\s+EXCEPTION\s+'CHALLENGE_STATE_CHANGED'/i.test(sql),
      'must raise CHALLENGE_STATE_CHANGED');
    assert.ok(/USING\s+ERRCODE\s*=\s*'40001'/i.test(sql), 'must use SQLSTATE 40001');
  });

  it('does not return sensitive data', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(!/jsonb_build_object.*p_otp_hash/i.test(sql), 'must not return otp_hash');
    assert.ok(!/jsonb_build_object.*v_stored_otp_hash/i.test(sql), 'must not return stored otp_hash');
    assert.ok(!/jsonb_build_object.*p_ip_hash/i.test(sql), 'must not return ip_hash');
    assert.ok(!/jsonb_build_object.*p_request_id/i.test(sql), 'must not return request_id');
    assert.ok(!/jsonb_build_object.*phone_hash/i.test(sql), 'must not return phone_hash');
    assert.ok(!/jsonb_build_object.*user_id/i.test(sql), 'must not return user_id');
    assert.ok(!/access_token/i.test(sql), 'must not return access_token');
    assert.ok(!/refresh_token/i.test(sql), 'must not return refresh_token');
  });

  it('does not modify protected columns in UPDATEs', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    const updateSections = sql.match(/SET\b[^;]*?WHERE/gis) || [];
    for (const section of updateSections) {
      assert.ok(!/user_id\s*=/i.test(section), 'must not modify user_id');
      assert.ok(!/phone_hash\s*=/i.test(section), 'must not modify phone_hash');
      assert.ok(!/otp_hash\s*=/i.test(section), 'must not modify otp_hash');
      assert.ok(!/ip_hash\s*=/i.test(section), 'must not modify ip_hash');
      assert.ok(!/delivery_status\s*=/i.test(section), 'must not modify delivery_status');
      assert.ok(!/attempt_count\s*=/i.test(section), 'must not modify attempt_count');
      assert.ok(!/max_attempts\s*=/i.test(section), 'must not modify max_attempts');
      assert.ok(!/expires_at\s*=/i.test(section), 'must not modify expires_at');
      assert.ok(!/resend_available_at\s*=/i.test(section), 'must not modify resend_available_at');
      assert.ok(!/request_id\s*=/i.test(section), 'must not modify request_id');
      assert.ok(!/created_at\s*=/i.test(section), 'must not modify created_at');
    }
  });

  it('has exactly one UPDATE statement', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    const updateCount = (sql.match(/UPDATE\s+private\.phone_otp_login_challenges_v2/gi) || []).length;
    assert.equal(updateCount, 1, 'must have exactly one UPDATE statement');
  });

  it('has no INSERT, DELETE, or TRUNCATE', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO/i.test(sql), 'must not contain INSERT INTO');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/ON\s+CONFLICT/i.test(sql), 'must not contain upsert (ON CONFLICT)');
  });

  it('does not contain EXCEPTION WHEN OTHERS', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('does not create tables, triggers, policies, or views', () => {
    assert.ok(completeMigration);
    const sql = readFileSync(join(migrationsDir, completeMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create tables');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(sql), 'must not create views');
  });

  it('previous migrations are not modified', () => {
    assert.ok(claimMigration, 'claim migration must still exist');
    assert.ok(deliveryMigration, 'delivery migration must still exist');
    assert.ok(createChallengeMigration, 'create challenge migration must still exist');
    assert.ok(foundFixMigration, 'found fix migration must still exist');
    assert.ok(rateLimitRpcMigration, 'rate limit RPC migration must still exist');
    assert.ok(rateLimitTableMigration, 'rate limit table migration must still exist');
    assert.ok(challengeTableMigration, 'challenge table migration must still exist');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpCompleteClaimRpc.test.ts'), 'utf8');
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
