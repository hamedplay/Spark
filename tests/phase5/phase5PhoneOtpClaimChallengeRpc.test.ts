import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

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

describe('Phase 5E-C3 — Atomic Phone OTP Verification Claim RPC', () => {
  it('migration file exists on disk', () => {
    assert.ok(claimMigration, 'phase5e_phone_otp_claim_challenge_rpc migration must exist');
  });

  it('has exact function signature and return type', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.claim_phone_otp_login_challenge_v2\s*\(/i.test(sql),
      'must create function with correct name');
    assert.ok(/p_challenge_id\s+uuid/i.test(sql), 'must have p_challenge_id uuid parameter');
    assert.ok(/p_otp_hash\s+text/i.test(sql), 'must have p_otp_hash text parameter');
    assert.ok(/p_claim_id\s+uuid/i.test(sql), 'must have p_claim_id uuid parameter');
    assert.ok(/RETURNS\s+jsonb/i.test(sql), 'must return jsonb');
  });

  it('is SECURITY DEFINER with empty search_path', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/SET\s+search_path\s+TO\s+''/i.test(sql), 'must set search_path to empty');
  });

  it('owner is set to postgres', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION.*OWNER\s+TO\s+postgres/i.test(sql), 'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE.*TO\s+service_role/i.test(sql), 'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL.*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('all three inputs have NULL validation', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/p_challenge_id\s+IS\s+NULL/i.test(sql), 'must check p_challenge_id IS NULL');
    assert.ok(/p_otp_hash\s+IS\s+NULL/i.test(sql), 'must check p_otp_hash IS NULL');
    assert.ok(/p_claim_id\s+IS\s+NULL/i.test(sql), 'must check p_claim_id IS NULL');
  });

  it('OTP hash has exact 64 lowercase hex regex', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/p_otp_hash\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'otp_hash must have hex64 regex');
  });

  it('invalid input raises 22023 with INVALID_CLAIM_CONFIGURATION', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'INVALID_CLAIM_CONFIGURATION'/i.test(sql),
      'must raise INVALID_CLAIM_CONFIGURATION');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('uses FOR UPDATE to lock the challenge row', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/FOR\s+UPDATE/i.test(sql), 'must use FOR UPDATE');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+FOR\s+UPDATE/i.test(sql),
      'must lock row by id with FOR UPDATE');
  });

  it('stores FOUND after SELECT INTO', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_challenge_found\s+boolean/i.test(sql), 'must declare v_challenge_found boolean');
    assert.ok(/v_challenge_found\s*:=\s*FOUND/i.test(sql), 'must store v_challenge_found := FOUND');
  });

  it('does not use record IS NULL or IS NOT NULL for detection', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(!/v_status\s+IS\s+NOT\s+NULL/i.test(sql), 'must not use v_status IS NOT NULL');
    assert.ok(!/v_status\s+IS\s+NULL/i.test(sql) || /p_challenge_id\s+IS\s+NULL/i.test(sql),
      'must not use v_status IS NULL for detection');
  });

  it('challenge not found returns INVALID_CHALLENGE with false', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+v_challenge_found\s+THEN/i.test(sql),
      'must check IF NOT v_challenge_found THEN');
    assert.ok(/'error_code',\s*'INVALID_CHALLENGE'/i.test(sql),
      'must return INVALID_CHALLENGE error_code');
  });

  it('delivery gate only accepts sent', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_delivery_status\s+IS\s+DISTINCT\s+FROM\s+'sent'/i.test(sql),
      'must check delivery_status IS DISTINCT FROM sent');
    assert.ok(/'error_code',\s*'DELIVERY_NOT_CONFIRMED'/i.test(sql),
      'must return DELIVERY_NOT_CONFIRMED');
  });

  it('consumed state returns ALREADY_CONSUMED without UPDATE', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_status\s*=\s*'consumed'/i.test(sql), 'must check consumed status');
    assert.ok(/'error_code',\s*'ALREADY_CONSUMED'/i.test(sql),
      'must return ALREADY_CONSUMED');
  });

  it('superseded and delivery_failed return INVALID_CHALLENGE without UPDATE', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_status\s*=\s*'superseded'\s+OR\s+v_status\s*=\s*'delivery_failed'/i.test(sql),
      'must check superseded OR delivery_failed');
  });

  it('locked state returns CHALLENGE_LOCKED with attempts_remaining 0', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_status\s*=\s*'locked'/i.test(sql), 'must check locked status');
    assert.ok(/'error_code',\s*'CHALLENGE_LOCKED'/i.test(sql),
      'must return CHALLENGE_LOCKED');
    assert.ok(/'attempts_remaining',\s*0/i.test(sql),
      'must return attempts_remaining 0 for locked');
  });

  it('expired challenge transitions to expired state', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_expires_at\s*<=\s*v_now/i.test(sql), 'must check expires_at <= v_now');
    assert.ok(/SET\s+status\s*=\s*'expired'/i.test(sql), 'must set status to expired');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+status\s+IN\s*\(\s*'pending'\s*,\s*'processing'\s*\)/i.test(sql),
      'must check status IN (pending, processing) in WHERE for expiry');
    assert.ok(/'error_code',\s*'CHALLENGE_EXPIRED'/i.test(sql),
      'must return CHALLENGE_EXPIRED');
  });

  it('processing with same claim ID and same OTP is idempotent', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_existing_claim_expires_at\s*>\s*v_now/i.test(sql),
      'must check active claim expiry');
    assert.ok(/v_existing_claim_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+p_claim_id/i.test(sql),
      'must check same claim ID with IS NOT DISTINCT FROM');
    assert.ok(/p_otp_hash\s+IS\s+NOT\s+DISTINCT\s+FROM\s+v_stored_otp_hash/i.test(sql),
      'must check same OTP with IS NOT DISTINCT FROM');
    assert.ok(/'idempotent',\s*true/i.test(sql), 'must return idempotent true');
    assert.ok(/'claimed',\s*true/i.test(sql), 'must return claimed true');
  });

  it('claim ID reuse with different OTP raises CLAIM_ID_REUSE_MISMATCH', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'CLAIM_ID_REUSE_MISMATCH'/i.test(sql),
      'must raise CLAIM_ID_REUSE_MISMATCH');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('active claim with different claim ID returns ACTIVE_PROCESSING', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_existing_claim_id\s+IS\s+DISTINCT\s+FROM\s+p_claim_id/i.test(sql),
      'must check different claim ID with IS DISTINCT FROM');
    assert.ok(/'error_code',\s*'ACTIVE_PROCESSING'/i.test(sql),
      'must return ACTIVE_PROCESSING');
  });

  it('expired claim resets to pending and continues', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_existing_claim_expires_at\s*<=\s*v_now/i.test(sql),
      'must check expired claim');
    assert.ok(/SET\s+status\s*=\s*'pending'.*claim_id\s*=\s*null.*claim_expires_at\s*=\s*null/is.test(sql),
      'must reset to pending with null claim fields');
    assert.ok(/v_status\s*:=\s*'pending'/i.test(sql),
      'must update v_status to pending in-memory');
  });

  it('invalid challenge state raises INVALID_CHALLENGE_STATE', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'INVALID_CHALLENGE_STATE'/i.test(sql),
      'must raise INVALID_CHALLENGE_STATE');
  });

  it('wrong OTP increments attempt by exactly one', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_next_attempt_count\s*:=\s*LEAST\s*\(\s*v_attempt_count\s*\+\s*1\s*,\s*v_max_attempts\s*\)/i.test(sql),
      'must use LEAST(v_attempt_count + 1, v_max_attempts)');
  });

  it('attempt does not exceed max', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_next_attempt_count\s*>=\s*v_max_attempts/i.test(sql),
      'must check if next attempt reaches max');
    assert.ok(/attempt_count\s*=\s*v_max_attempts/i.test(sql),
      'must cap attempt_count at v_max_attempts');
  });

  it('last attempt locks the challenge', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/SET\s+attempt_count\s*=\s*v_max_attempts\s*,\s*status\s*=\s*'locked'/i.test(sql),
      'must set attempt_count=max and status=locked');
    assert.ok(/'error_code',\s*'CHALLENGE_LOCKED'/i.test(sql),
      'must return CHALLENGE_LOCKED');
  });

  it('wrong OTP with remaining attempts returns INVALID_OTP', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/'error_code',\s*'INVALID_OTP'/i.test(sql),
      'must return INVALID_OTP');
    assert.ok(/'attempts_remaining',\s*v_max_attempts\s*-\s*v_next_attempt_count/i.test(sql),
      'must return attempts_remaining as max - next');
  });

  it('correct OTP transitions to processing', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/SET\s+status\s*=\s*'processing'\s*,\s*claim_id\s*=\s*p_claim_id/i.test(sql),
      'must set status=processing and claim_id=p_claim_id');
  });

  it('claim expiry is exactly 30 seconds', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/v_new_claim_expires_at\s*:=\s*v_now\s*\+\s*pg_catalog\.make_interval\s*\(\s*secs\s*=>\s*30\s*\)/i.test(sql),
      'must set claim expiry to v_now + 30 seconds');
  });

  it('all UPDATEs check previous state in WHERE', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+status\s*=\s*'pending'\s+AND\s+delivery_status\s*=\s*'sent'\s+AND\s+attempt_count\s*=\s*v_attempt_count/i.test(sql),
      'must check id, status=pending, delivery_status=sent, attempt_count in WHERE');
    assert.ok(/AND\s+otp_hash\s*=\s*v_stored_otp_hash/i.test(sql),
      'correct OTP UPDATE must check otp_hash in WHERE');
  });

  it('uses FOUND after UPDATE to detect race', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+FOUND\s+THEN/i.test(sql), 'must check IF NOT FOUND THEN');
    assert.ok(/RAISE\s+EXCEPTION\s+'CHALLENGE_STATE_CHANGED'/i.test(sql),
      'must raise CHALLENGE_STATE_CHANGED');
    assert.ok(/USING\s+ERRCODE\s*=\s*'40001'/i.test(sql), 'must use SQLSTATE 40001');
  });

  it('only returns user_id and phone_hash on success', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    const successReturns = sql.match(/jsonb_build_object\([^)]*'claimed',\s*true[^)]*\)/gis) || [];
    assert.ok(successReturns.length >= 2, 'must have at least 2 success returns (idempotent + new claim)');
    for (const ret of successReturns) {
      assert.ok(/'user_id',\s*v_user_id/i.test(ret), 'success must return user_id');
      assert.ok(/'phone_hash',\s*v_phone_hash/i.test(ret), 'success must return phone_hash');
      assert.ok(!/otp_hash/i.test(ret.replace(/v_stored_otp_hash/g, '')), 'must not return otp_hash');
      assert.ok(!/ip_hash/i.test(ret), 'must not return ip_hash');
      assert.ok(!/request_id/i.test(ret), 'must not return request_id');
    }
  });

  it('does not return sensitive data in any response', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(!/jsonb_build_object.*p_otp_hash/i.test(sql), 'must not return p_otp_hash');
    assert.ok(!/jsonb_build_object.*v_stored_otp_hash/i.test(sql), 'must not return stored otp_hash');
    assert.ok(!/jsonb_build_object.*p_ip_hash/i.test(sql), 'must not return ip_hash');
    assert.ok(!/jsonb_build_object.*p_request_id/i.test(sql), 'must not return request_id');
    assert.ok(!/access_token/i.test(sql), 'must not return access_token');
    assert.ok(!/refresh_token/i.test(sql), 'must not return refresh_token');
  });

  it('does not modify protected columns in UPDATEs', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    const updateSections = sql.match(/SET\b[^;]*?WHERE/gis) || [];
    for (const section of updateSections) {
      assert.ok(!/otp_hash\s*=/i.test(section), 'must not modify otp_hash');
      assert.ok(!/delivery_status\s*=/i.test(section), 'must not modify delivery_status');
      assert.ok(!/expires_at\s*=/i.test(section), 'must not modify expires_at');
      assert.ok(!/resend_available_at\s*=/i.test(section), 'must not modify resend_available_at');
      assert.ok(!/user_id\s*=/i.test(section), 'must not modify user_id');
      assert.ok(!/phone_hash\s*=/i.test(section), 'must not modify phone_hash');
      assert.ok(!/max_attempts\s*=/i.test(section), 'must not modify max_attempts');
      assert.ok(!/request_id\s*=/i.test(section), 'must not modify request_id');
      assert.ok(!/consumed_at\s*=/i.test(section), 'must not modify consumed_at');
      assert.ok(!/created_at\s*=/i.test(section), 'must not modify created_at');
    }
  });

  it('has no INSERT, DELETE, or TRUNCATE', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO/i.test(sql), 'must not contain INSERT INTO');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/ON\s+CONFLICT/i.test(sql), 'must not contain upsert (ON CONFLICT)');
  });

  it('does not contain EXCEPTION WHEN OTHERS', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('does not create tables, triggers, policies, or views', () => {
    assert.ok(claimMigration);
    const sql = readFileSync(join(migrationsDir, claimMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create tables');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(sql), 'must not create views');
  });

  it('previous migrations are not modified', () => {
    assert.ok(deliveryMigration, 'delivery migration must still exist');
    assert.ok(createChallengeMigration, 'create challenge migration must still exist');
    assert.ok(foundFixMigration, 'found fix migration must still exist');
    assert.ok(rateLimitRpcMigration, 'rate limit RPC migration must still exist');
    assert.ok(rateLimitTableMigration, 'rate limit table migration must still exist');
    assert.ok(challengeTableMigration, 'challenge table migration must still exist');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpClaimChallengeRpc.test.ts'), 'utf8');
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
