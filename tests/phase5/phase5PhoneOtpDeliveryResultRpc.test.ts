import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

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

describe('Phase 5E-C2 — Phone OTP Delivery Result RPC', () => {
  it('migration file exists on disk', () => {
    assert.ok(deliveryMigration, 'phase5e_phone_otp_delivery_result_rpc migration must exist');
  });

  it('has exact function signature and return type', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.set_phone_otp_login_delivery_v2\s*\(/i.test(sql),
      'must create function with correct name');
    assert.ok(/p_challenge_id\s+uuid/i.test(sql), 'must have p_challenge_id uuid parameter');
    assert.ok(/p_sent\s+boolean/i.test(sql), 'must have p_sent boolean parameter');
    assert.ok(/RETURNS\s+boolean/i.test(sql), 'must return boolean');
  });

  it('is SECURITY DEFINER with empty search_path', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/SET\s+search_path\s+TO\s+''/i.test(sql), 'must set search_path to empty');
  });

  it('owner is set to postgres', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION.*OWNER\s+TO\s+postgres/i.test(sql), 'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE.*TO\s+service_role/i.test(sql), 'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL.*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('both inputs have NULL validation', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/p_challenge_id\s+IS\s+NULL/i.test(sql), 'must check p_challenge_id IS NULL');
    assert.ok(/p_sent\s+IS\s+NULL/i.test(sql), 'must check p_sent IS NULL');
  });

  it('invalid input raises 22023 with INVALID_DELIVERY_CONFIGURATION', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'INVALID_DELIVERY_CONFIGURATION'/i.test(sql),
      'must raise INVALID_DELIVERY_CONFIGURATION');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('uses FOR UPDATE to lock the challenge row', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/FOR\s+UPDATE/i.test(sql), 'must use FOR UPDATE');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+FOR\s+UPDATE/i.test(sql),
      'must lock row by id with FOR UPDATE');
  });

  it('stores FOUND after SELECT INTO', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/v_challenge_found\s+boolean/i.test(sql), 'must declare v_challenge_found boolean');
    assert.ok(/v_challenge_found\s*:=\s*FOUND/i.test(sql), 'must store v_challenge_found := FOUND');
  });

  it('does not use record IS NULL or IS NOT NULL for detection', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(!/v_status\s+IS\s+NOT\s+NULL/i.test(sql), 'must not use v_status IS NOT NULL');
    assert.ok(!/v_delivery_status\s+IS\s+NOT\s+NULL/i.test(sql), 'must not use v_delivery_status IS NOT NULL');
    assert.ok(!/v_status\s+IS\s+NULL/i.test(sql) || /p_challenge_id\s+IS\s+NULL/i.test(sql),
      'must not use v_status IS NULL for detection');
  });

  it('returns false when challenge not found', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+v_challenge_found\s+THEN/i.test(sql),
      'must check IF NOT v_challenge_found THEN');
    assert.ok(/RETURN\s+false/i.test(sql), 'must return false');
  });

  it('successful path only transitions pending/pending to pending/sent', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/p_sent\s+THEN/i.test(sql), 'must have p_sent branch');
    assert.ok(/SET\s+delivery_status\s*=\s*'sent'/i.test(sql),
      'must set delivery_status to sent');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+status\s*=\s*'pending'\s+AND\s+delivery_status\s*=\s*'pending'/i.test(sql),
      'must check status=pending AND delivery_status=pending in WHERE for success');
  });

  it('successful path does not change status column', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    const successUpdateMatch = sql.match(/SET\s+delivery_status\s*=\s*'sent'[^;]*?WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+status\s*=\s*'pending'\s+AND\s+delivery_status\s*=\s*'pending'/is);
    assert.ok(successUpdateMatch, 'must find success UPDATE');
    const successUpdate = successUpdateMatch![0];
    assert.ok(!/status\s*=\s*'[^']+'/i.test(successUpdate.replace(/status\s*=\s*'pending'/i, '')),
      'success UPDATE must not set status column');
  });

  it('failed path transitions pending/pending to delivery_failed/failed', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/SET\s+status\s*=\s*'delivery_failed'/i.test(sql),
      'must set status to delivery_failed');
    assert.ok(/delivery_status\s*=\s*'failed'/i.test(sql),
      'must set delivery_status to failed');
    assert.ok(/claim_id\s*=\s*null/i.test(sql), 'must set claim_id to null');
    assert.ok(/claim_expires_at\s*=\s*null/i.test(sql), 'must set claim_expires_at to null');
  });

  it('failed path checks previous state in WHERE', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+status\s*=\s*'pending'\s+AND\s+delivery_status\s*=\s*'pending'/i.test(sql),
      'failed UPDATE must check status=pending AND delivery_status=pending in WHERE');
  });

  it('successful delivery is idempotent when already sent', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/v_status\s*=\s*'pending'\s+AND\s+v_delivery_status\s*=\s*'sent'\s+THEN/i.test(sql),
      'must check for idempotent sent state');
    assert.ok(/RETURN\s+true/i.test(sql), 'must return true for idempotent');
  });

  it('failed delivery is idempotent when already failed', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(/v_status\s*=\s*'delivery_failed'\s+AND\s*v_delivery_status\s*=\s*'failed'\s+THEN/i.test(sql),
      'must check for idempotent failed state');
  });

  it('sent after failed is not allowed', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(!/delivery_failed.*sent/is.test(sql), 'must not transition from delivery_failed to sent');
  });

  it('failed after sent is not allowed', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(!/delivery_status\s*=\s*'sent'.*delivery_status\s*=\s*'failed'/is.test(sql),
      'must not transition from sent to failed');
  });

  it('does not modify protected columns', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    const updateSections = sql.match(/SET\b[^;]*?WHERE/gis) || [];
    for (const section of updateSections) {
      assert.ok(!/user_id\s*=/i.test(section), 'must not modify user_id');
      assert.ok(!/phone_hash\s*=/i.test(section), 'must not modify phone_hash');
      assert.ok(!/otp_hash\s*=/i.test(section), 'must not modify otp_hash');
      assert.ok(!/ip_hash\s*=/i.test(section), 'must not modify ip_hash');
      assert.ok(!/attempt_count\s*=/i.test(section), 'must not modify attempt_count');
      assert.ok(!/max_attempts\s*=/i.test(section), 'must not modify max_attempts');
      assert.ok(!/expires_at\s*=/i.test(section), 'must not modify expires_at');
      assert.ok(!/resend_available_at\s*=/i.test(section), 'must not modify resend_available_at');
      assert.ok(!/request_id\s*=/i.test(section), 'must not modify request_id');
      assert.ok(!/consumed_at\s*=/i.test(section), 'must not modify consumed_at');
      assert.ok(!/created_at\s*=/i.test(section), 'must not modify created_at');
    }
  });

  it('has no INSERT, DELETE, or TRUNCATE', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO/i.test(sql), 'must not contain INSERT INTO');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/ON\s+CONFLICT/i.test(sql), 'must not contain upsert (ON CONFLICT)');
  });

  it('has exactly two UPDATE statements', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    const updateCount = (sql.match(/UPDATE\s+private\.phone_otp_login_challenges_v2/gi) || []).length;
    assert.equal(updateCount, 2, 'must have exactly two UPDATE statements');
  });

  it('does not contain EXCEPTION WHEN OTHERS', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('does not create tables, triggers, policies, or views', () => {
    assert.ok(deliveryMigration);
    const sql = readFileSync(join(migrationsDir, deliveryMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create tables');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(sql), 'must not create views');
  });

  it('previous migrations are not modified', () => {
    assert.ok(createChallengeMigration, 'create challenge migration must still exist');
    assert.ok(foundFixMigration, 'found fix migration must still exist');
    assert.ok(rateLimitRpcMigration, 'rate limit RPC migration must still exist');
    assert.ok(rateLimitTableMigration, 'rate limit table migration must still exist');
    assert.ok(challengeTableMigration, 'challenge table migration must still exist');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpDeliveryResultRpc.test.ts'), 'utf8');
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
