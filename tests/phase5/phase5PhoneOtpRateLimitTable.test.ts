import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const rateLimitMigration = migrationFiles.find((f) =>
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

describe('Phase 5E-B2 — Phone OTP Login Rate Limit Table', () => {
  it('phase5e rate limit migration file exists on disk', () => {
    assert.ok(rateLimitMigration, 'phase5e_phone_otp_rate_limit_table migration must exist');
  });

  it('creates table in private schema', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/CREATE\s+TABLE\s+private\.phone_otp_login_rate_limit_v2/i.test(sql),
      'must create table in private schema');
  });

  it('has exactly five required columns', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/id\s+bigint\s+GENERATED\s+ALWAYS\s+AS\s+IDENTITY\s+PRIMARY\s+KEY/i.test(sql),
      'must have id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    assert.ok(sql.includes('purpose text NOT NULL'), 'must have purpose text NOT NULL');
    assert.ok(sql.includes('phone_hash text NOT NULL'), 'must have phone_hash text NOT NULL');
    assert.ok(sql.includes('ip_hash text NOT NULL'), 'must have ip_hash text NOT NULL');
    assert.ok(/created_at\s+timestamptz\s+NOT\s+NULL\s+DEFAULT\s+clock_timestamp\(\)/i.test(sql),
      'must have created_at timestamptz NOT NULL DEFAULT clock_timestamp()');
  });

  it('does not have plaintext columns for phone, otp, email, or tokens', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!sql.includes('phone text'), 'must not have plaintext phone column');
    assert.ok(!sql.includes('otp text'), 'must not have plaintext otp column');
    assert.ok(!sql.includes('email text'), 'must not have plaintext email column');
    assert.ok(!sql.includes('access_token'), 'must not have access_token column');
    assert.ok(!sql.includes('refresh_token'), 'must not have refresh_token column');
  });

  it('constrains purpose to two allowed values', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(sql.includes("'phone_otp_login_request'"), 'must allow phone_otp_login_request');
    assert.ok(sql.includes("'phone_otp_login_verify'"), 'must allow phone_otp_login_verify');
  });

  it('phone_hash has 64 lowercase hex check', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/\^\[0-9a-f\]\{64\}\$/.test(sql), 'must have 64 lowercase hex regex');
    assert.ok(/phone_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'phone_hash must have hex64 check');
  });

  it('ip_hash has 64 lowercase hex check', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/ip_hash\s*~\s*'\^\[0-9a-f\]\{64\}\$'/i.test(sql),
      'ip_hash must have hex64 check');
  });

  it('creates two required indexes', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/CREATE\s+INDEX.*purpose.*phone_hash.*created_at/i.test(sql),
      'must create (purpose, phone_hash, created_at DESC) index');
    assert.ok(/CREATE\s+INDEX.*purpose.*ip_hash.*created_at/i.test(sql),
      'must create (purpose, ip_hash, created_at DESC) index');
  });

  it('enables RLS on the table', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'must enable RLS');
  });

  it('does not create any policies', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create any policies');
  });

  it('revokes all on table from PUBLIC, anon, authenticated', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/REVOKE\s+ALL\s+ON\s+private\.phone_otp_login_rate_limit_v2\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke all on table from PUBLIC, anon, authenticated');
  });

  it('revokes all on sequence from PUBLIC, anon, authenticated', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(/REVOKE\s+ALL\s+ON\s+SEQUENCE\s+private\.phone_otp_login_rate_limit_v2_id_seq\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke all on sequence from PUBLIC, anon, authenticated');
  });

  it('does not grant to anon or authenticated', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('does not have foreign keys or CASCADE', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!/FOREIGN\s+KEY/i.test(sql), 'must not have foreign keys');
    assert.ok(!/CASCADE/i.test(sql), 'must not have CASCADE');
  });

  it('does not create functions, RPCs, triggers, or views', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), 'must not create functions');
    assert.ok(!/CREATE\s+PROCEDURE/i.test(sql), 'must not create procedures');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?VIEW/i.test(sql), 'must not create views');
  });

  it('does not contain DELETE, UPDATE, INSERT, TRUNCATE, or DROP', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/UPDATE\s+private/i.test(sql), 'must not contain UPDATE on private table');
    assert.ok(!/INSERT\s+INTO\s+private/i.test(sql), 'must not contain INSERT INTO private table');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not contain DROP TABLE');
  });

  it('does not create challenge table or modify it', () => {
    assert.ok(rateLimitMigration);
    const sql = readFileSync(join(migrationsDir, rateLimitMigration!), 'utf8');
    assert.ok(!/phone_otp_login_challenges_v2/i.test(sql),
      'must not reference challenge table');
  });

  it('previous challenge table migration is not modified', () => {
    assert.ok(challengeMigration, 'challenge table migration must still exist');
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_challenges_v2'), 'challenge migration must be intact');
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
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpRateLimitTable.test.ts'), 'utf8');
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
