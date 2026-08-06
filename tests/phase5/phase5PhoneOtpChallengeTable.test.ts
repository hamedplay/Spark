import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const challengeMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_challenge_table'),
);

const configMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_configuration'),
);

describe('Phase 5E-B1 — Phone OTP Login Challenge Table', () => {
  it('phase5e challenge table migration file exists on disk', () => {
    assert.ok(challengeMigration, 'phase5e_phone_otp_challenge_table migration must exist');
  });

  it('creates table in private schema', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(sql.includes('private.phone_otp_login_challenges_v2'), 'must create table in private schema');
    assert.ok(/CREATE\s+TABLE\s+private\.phone_otp_login_challenges_v2/i.test(sql), 'must use CREATE TABLE');
  });

  it('has all required columns', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    const required = [
      'id uuid PRIMARY KEY',
      'user_id uuid NOT NULL',
      'phone_hash text NOT NULL',
      'otp_hash text NOT NULL',
      'ip_hash text NOT NULL',
      "status text NOT NULL DEFAULT 'pending'",
      'attempt_count integer NOT NULL DEFAULT 0',
      'max_attempts integer NOT NULL',
      'expires_at timestamptz NOT NULL',
      'resend_available_at timestamptz NOT NULL',
      'request_id uuid NOT NULL UNIQUE',
      'claim_id uuid NULL',
      'claim_expires_at timestamptz NULL',
      "delivery_status text NOT NULL DEFAULT 'pending'",
      'consumed_at timestamptz NULL',
      'created_at timestamptz NOT NULL DEFAULT clock_timestamp()',
      'updated_at timestamptz NOT NULL DEFAULT clock_timestamp()',
    ];
    for (const col of required) {
      assert.ok(sql.includes(col), `must have column: ${col}`);
    }
  });

  it('does not have plaintext columns for phone, otp, email, or tokens', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!sql.includes('phone text'), 'must not have plaintext phone column');
    assert.ok(!sql.includes('otp text'), 'must not have plaintext otp column');
    assert.ok(!sql.includes('email text'), 'must not have plaintext email column');
    assert.ok(!sql.includes('access_token'), 'must not have access_token column');
    assert.ok(!sql.includes('refresh_token'), 'must not have refresh_token column');
  });

  it('FK references auth.users(id) with ON DELETE CASCADE', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/FOREIGN KEY\s*\(\s*user_id\s*\)/i.test(sql), 'must have FK on user_id');
    assert.ok(/REFERENCES\s+auth\.users\s*\(\s*id\s*\)/i.test(sql), 'must reference auth.users(id)');
    assert.ok(/ON DELETE CASCADE/i.test(sql), 'must have ON DELETE CASCADE');
  });

  it('has no other CASCADE besides user_id FK', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    const cascadeMatches = sql.match(/ON DELETE CASCADE/gi) || [];
    assert.ok(cascadeMatches.length === 1, 'must have exactly one ON DELETE CASCADE');
  });

  it('constrains status to allowed values', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(sql.includes("'pending'"), 'must allow pending');
    assert.ok(sql.includes("'processing'"), 'must allow processing');
    assert.ok(sql.includes("'consumed'"), 'must allow consumed');
    assert.ok(sql.includes("'expired'"), 'must allow expired');
    assert.ok(sql.includes("'locked'"), 'must allow locked');
    assert.ok(sql.includes("'superseded'"), 'must allow superseded');
    assert.ok(sql.includes("'delivery_failed'"), 'must allow delivery_failed');
  });

  it('constrains delivery_status to pending, sent, failed', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(sql.includes("'sent'"), 'must allow sent');
    assert.ok(sql.includes("'failed'"), 'must allow failed');
  });

  it('hash columns have 64 lowercase hex check', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/\^\[0-9a-f\]\{64\}\$/.test(sql), 'must have 64 lowercase hex regex check');
    const hexChecks = sql.match(/\^\[0-9a-f\]\{64\}\$/g) || [];
    assert.ok(hexChecks.length >= 3, 'must have hex check for phone_hash, otp_hash, and ip_hash');
  });

  it('attempt_count has non-negative constraint', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(sql.includes('attempt_count >= 0'), 'must constrain attempt_count >= 0');
  });

  it('max_attempts has range constraint between 1 and 10', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/max_attempts\s*>=\s*1/i.test(sql), 'must constrain max_attempts >= 1');
    assert.ok(/max_attempts\s*<=\s*10/i.test(sql), 'must constrain max_attempts <= 10');
  });

  it('attempt_count <= max_attempts constraint exists', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/attempt_count\s*<=\s*max_attempts/i.test(sql), 'must constrain attempt_count <= max_attempts');
  });

  it('expires_at > created_at constraint exists', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/expires_at\s*>\s*created_at/i.test(sql), 'must constrain expires_at > created_at');
  });

  it('resend_available_at >= created_at constraint exists', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/resend_available_at\s*>=\s*created_at/i.test(sql), 'must constrain resend_available_at >= created_at');
  });

  it('claim_expires_at is null or > created_at constraint exists', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/claim_expires_at\s*IS\s*NULL\s*OR\s*claim_expires_at\s*>\s*created_at/i.test(sql),
      'must constrain claim_expires_at is null or > created_at');
  });

  it('processing status requires claim_id and claim_expires_at', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/status\s*<>\s*'processing'/i.test(sql), 'must check status <> processing');
    assert.ok(/claim_id\s*IS\s*NOT\s*NULL\s*AND\s*claim_expires_at\s*IS\s*NOT\s*NULL/i.test(sql),
      'must require claim_id and claim_expires_at for processing');
  });

  it('consumed status requires consumed_at non-null', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/status\s*<>\s*'consumed'/i.test(sql), 'must check status <> consumed');
    assert.ok(/consumed_at\s*IS\s*NOT\s*NULL/i.test(sql), 'must require consumed_at for consumed status');
  });

  it('creates four required indexes', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/CREATE\s+INDEX.*phone_hash.*status.*created_at/i.test(sql),
      'must create (phone_hash, status, created_at desc) index');
    assert.ok(/CREATE\s+INDEX.*user_id.*status.*created_at/i.test(sql),
      'must create (user_id, status, created_at desc) index');
    assert.ok(/CREATE\s+INDEX.*status.*expires_at/i.test(sql),
      'must create (status, expires_at) index');
    assert.ok(/CREATE\s+INDEX.*claim_id.*WHERE\s+claim_id\s*IS\s*NOT\s*NULL/i.test(sql),
      'must create partial index on claim_id WHERE claim_id IS NOT NULL');
  });

  it('enables RLS on the table', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'must enable RLS');
  });

  it('revokes all from PUBLIC, anon, authenticated', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(/REVOKE\s+ALL/i.test(sql), 'must REVOKE ALL');
    assert.ok(/FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
  });

  it('does not create any policies', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create any policies');
  });

  it('does not grant to anon or authenticated', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('does not create views', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/CREATE\s+VIEW/i.test(sql), 'must not create views');
    assert.ok(!/CREATE\s+OR\s+REPLACE\s+VIEW/i.test(sql), 'must not create or replace views');
  });

  it('does not contain DELETE, TRUNCATE, or DROP TABLE', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not contain DROP TABLE');
  });

  it('does not create rate limit table', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/rate_limit/i.test(sql), 'must not create rate limit table');
  });

  it('does not create RPC or functions', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(sql), 'must not create functions');
    assert.ok(!/CREATE\s+PROCEDURE/i.test(sql), 'must not create procedures');
  });

  it('does not create triggers', () => {
    assert.ok(challengeMigration);
    const sql = readFileSync(join(migrationsDir, challengeMigration!), 'utf8');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
  });

  it('previous phase5e config migration is not modified', () => {
    assert.ok(configMigration, 'phase5e_phone_otp_configuration migration must still exist');
    const sql = readFileSync(join(migrationsDir, configMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_backend_ready'), 'config migration must be intact');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpChallengeTable.test.ts'), 'utf8');
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
