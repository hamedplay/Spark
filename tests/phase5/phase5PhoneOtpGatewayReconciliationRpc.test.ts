import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const targetMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_gateway_reconciliation_rpc'),
);

const finalizationMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_gateway_finalization_rpc'),
);

const aalFixMigration = migrationFiles.find((f) =>
  f.includes('phase5e_fix_phone_otp_gateway_aal_null_validation'),
);

const challengeTableMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_challenge_table'),
);

const releaseMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_release_claim_rpc'),
);

const gatewayMethodMigration = migrationFiles.find((f) =>
  f.includes('phase5e_add_phone_otp_gateway_login_method'),
);

const sessionAllowlistMigration = migrationFiles.find((f) =>
  f.includes('phase5b1_session_allowlist_foundation'),
);

describe('Phase 5E-D3 — Gateway Reconciliation RPC', () => {
  it('migration file exists on disk', () => {
    assert.ok(targetMigration, 'phase5e_phone_otp_gateway_reconciliation_rpc migration must exist');
  });

  it('uses CREATE FUNCTION with exact signature', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.reconcile_phone_otp_gateway_session_v1\s*\(/i.test(sql),
      'must create function with correct name');
    assert.ok(/p_session_id\s+uuid/i.test(sql), 'must have p_session_id uuid');
    assert.ok(/p_user_id\s+uuid/i.test(sql), 'must have p_user_id uuid');
    assert.ok(/p_challenge_id\s+uuid/i.test(sql), 'must have p_challenge_id uuid');
    assert.ok(/p_claim_id\s+uuid/i.test(sql), 'must have p_claim_id uuid');
    assert.ok(/p_phone_hash\s+text/i.test(sql), 'must have p_phone_hash text');
    assert.ok(/p_ip_hash\s+text/i.test(sql), 'must have p_ip_hash text');
    assert.ok(/RETURNS\s+jsonb/i.test(sql), 'must return jsonb');
  });

  it('is SECURITY DEFINER with empty search_path', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/SET\s+search_path\s+TO\s+''/i.test(sql), 'must set search_path to empty');
  });

  it('owner is set to postgres', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION[\s\S]*OWNER\s+TO\s+postgres/i.test(sql), 'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE[\s\S]*TO\s+service_role/i.test(sql), 'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL[\s\S]*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke from PUBLIC, anon, authenticated');
    assert.ok(!/GRANT.*TO\s+anon/i.test(sql), 'must not grant to anon');
    assert.ok(!/GRANT.*TO\s+authenticated/i.test(sql), 'must not grant to authenticated');
  });

  it('all six inputs have NULL validation', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/p_session_id\s+IS\s+NULL/i.test(sql), 'must check p_session_id IS NULL');
    assert.ok(/p_user_id\s+IS\s+NULL/i.test(sql), 'must check p_user_id IS NULL');
    assert.ok(/p_challenge_id\s+IS\s+NULL/i.test(sql), 'must check p_challenge_id IS NULL');
    assert.ok(/p_claim_id\s+IS\s+NULL/i.test(sql), 'must check p_claim_id IS NULL');
    assert.ok(/p_phone_hash\s+IS\s+NULL/i.test(sql), 'must check p_phone_hash IS NULL');
    assert.ok(/p_ip_hash\s+IS\s+NULL/i.test(sql), 'must check p_ip_hash IS NULL');
  });

  it('hashes have exact regex validation', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/\^\[0-9a-f\]\{64\}\$/i.test(sql), 'must have regex ^[0-9a-f]{64}$ for hashes');
  });

  it('invalid input raises 22023 with generic error', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/RAISE\s+EXCEPTION\s+'INVALID_PHONE_OTP_GATEWAY_CONFIGURATION'/i.test(sql),
      'must raise INVALID_PHONE_OTP_GATEWAY_CONFIGURATION');
    assert.ok(/USING\s+ERRCODE\s*=\s*'22023'/i.test(sql), 'must use SQLSTATE 22023');
  });

  it('does not expose UUID or hash values in error message', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/INVALID_PHONE_OTP_GATEWAY_CONFIGURATION.*%|\|.*INVALID_PHONE_OTP_GATEWAY_CONFIGURATION/i.test(sql),
      'must not format variables into error message');
  });

  it('lock order is challenge, session, gateway', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    const challengeIdx = sql.search(/FROM\s+private\.phone_otp_login_challenges_v2\s+WHERE\s+id\s*=\s*p_challenge_id\s+FOR\s+UPDATE/i);
    const sessionIdx = sql.search(/FROM\s+auth\.sessions\s+WHERE\s+id\s*=\s*p_session_id\s+AND\s+user_id\s*=\s*p_user_id\s+FOR\s+KEY\s+SHARE/i);
    const gatewayIdx = sql.search(/FROM\s+private\.password_gateway_session_authorizations\s+WHERE\s+session_id\s*=\s*p_session_id\s+FOR\s+UPDATE/i);
    assert.ok(challengeIdx >= 0, 'must have challenge FOR UPDATE');
    assert.ok(sessionIdx >= 0, 'must have session FOR KEY SHARE');
    assert.ok(gatewayIdx >= 0, 'must have gateway FOR UPDATE');
    assert.ok(challengeIdx < sessionIdx, 'challenge must be locked before session');
    assert.ok(sessionIdx < gatewayIdx, 'session must be locked before gateway');
  });

  it('challenge is locked with FOR UPDATE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/FROM\s+private\.phone_otp_login_challenges_v2\s+WHERE\s+id\s*=\s*p_challenge_id\s+FOR\s+UPDATE/i.test(sql),
      'must lock challenge with FOR UPDATE');
  });

  it('session is locked with FOR KEY SHARE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/FROM\s+auth\.sessions\s+WHERE\s+id\s*=\s*p_session_id\s+AND\s+user_id\s*=\s*p_user_id\s+FOR\s+KEY\s+SHARE/i.test(sql),
      'must lock session with FOR KEY SHARE');
  });

  it('gateway row is read with FOR UPDATE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/FROM\s+private\.password_gateway_session_authorizations\s+WHERE\s+session_id\s*=\s*p_session_id\s+FOR\s+UPDATE/i.test(sql),
      'must read gateway with FOR UPDATE');
  });

  it('authorized result requires all conditions', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_challenge_found/i.test(sql), 'must check challenge found');
    assert.ok(/v_session_found/i.test(sql), 'must check session found');
    assert.ok(/v_session_created_at\s+IS\s+NOT\s+NULL/i.test(sql), 'must check session created_at not null');
    assert.ok(/v_session_not_after.*>\s*v_now/i.test(sql), 'must check session not expired');
    assert.ok(/v_session_aal\s+IS\s+NOT\s+NULL/i.test(sql), 'must check aal not null');
    assert.ok(/v_session_aal\s+IN\s*\(\s*'aal1'\s*,\s*'aal2'\s*,\s*'aal3'\s*\)/i.test(sql), 'must check aal allowlist');
    assert.ok(/v_challenge_user_id\s*=\s*p_user_id/i.test(sql), 'must check challenge user_id');
    assert.ok(/v_challenge_phone_hash\s*=\s*p_phone_hash/i.test(sql), 'must check challenge phone_hash');
    assert.ok(/v_challenge_status\s*=\s*'consumed'/i.test(sql), 'must check challenge consumed');
    assert.ok(/v_challenge_consumed_at\s+IS\s+NOT\s+NULL/i.test(sql), 'must check consumed_at not null');
    assert.ok(/v_challenge_claim_id\s+IS\s+NULL/i.test(sql), 'must check claim_id is null');
    assert.ok(/v_challenge_claim_expires_at\s+IS\s+NULL/i.test(sql), 'must check claim_expires_at is null');
    assert.ok(/v_gateway_found/i.test(sql), 'must check gateway found');
    assert.ok(/v_gateway_user_id\s*=\s*p_user_id/i.test(sql), 'must check gateway user_id');
    assert.ok(/v_gateway_method\s*=\s*'phone_otp'/i.test(sql), 'must check gateway method');
    assert.ok(/v_gateway_identifier_hash\s*=\s*p_phone_hash/i.test(sql), 'must check gateway identifier_hash');
    assert.ok(/v_gateway_ip_hash\s*=\s*p_ip_hash/i.test(sql), 'must check gateway ip_hash');
    assert.ok(/v_gateway_session_created_at\s*=\s*v_session_created_at/i.test(sql), 'must check gateway session_created_at');
    assert.ok(/'authorized',\s*true/i.test(sql), 'must return authorized true');
    assert.ok(/'error_code',\s*null/i.test(sql), 'must return error_code null');
  });

  it('authorized result does not return session_id or UUIDs', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    const authorizedMatch = sql.match(/'authorized',\s*true[\s\S]*?END/i);
    assert.ok(authorizedMatch, 'must find authorized block');
    const block = authorizedMatch![0];
    assert.ok(!/session_id.*p_session_id/i.test(block), 'must not return session_id in authorized result');
    assert.ok(!/p_user_id/i.test(block.replace(/v_challenge_user_id\s*=\s*p_user_id/i, '').replace(/v_gateway_user_id\s*=\s*p_user_id/i, '')),
      'must not return user_id in authorized result');
  });

  it('NOT_COMMITTED result is exact', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_challenge_status\s*=\s*'processing'/i.test(sql), 'must check processing status');
    assert.ok(/v_challenge_delivery_status\s*=\s*'sent'/i.test(sql), 'must check delivery sent');
    assert.ok(/v_challenge_claim_id\s*=\s*p_claim_id/i.test(sql), 'must check claim_id matches');
    assert.ok(/v_challenge_claim_expires_at\s+IS\s+NOT\s+NULL/i.test(sql), 'must check claim_expires_at not null');
    assert.ok(/v_challenge_claim_expires_at\s*>\s*v_now/i.test(sql), 'must check claim not expired');
    assert.ok(/v_challenge_consumed_at\s+IS\s+NULL/i.test(sql), 'must check consumed_at is null');
    assert.ok(/NOT\s+v_gateway_found/i.test(sql), 'must check gateway not found');
    assert.ok(/'NOT_COMMITTED'/i.test(sql), 'must return NOT_COMMITTED');
  });

  it('INCONSISTENT_STATE is the fallback', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/'INCONSISTENT_STATE'/i.test(sql), 'must return INCONSISTENT_STATE');
  });

  it('RPC is read-only: no INSERT, UPDATE, DELETE, TRUNCATE, or UPSERT', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO/i.test(sql), 'must not have INSERT');
    assert.ok(!/UPDATE\s+/i.test(sql.replace(/FOR\s+UPDATE/gi, '').replace(/FOR\s+KEY\s+SHARE/gi, '')),
      'must not have UPDATE (excluding lock clauses)');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not have DELETE');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not have TRUNCATE');
    assert.ok(!/ON\s+CONFLICT.*DO\s+UPDATE/i.test(sql), 'must not have UPSERT');
  });

  it('does not expose sensitive data in output', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/jsonb_build_object.*p_user_id/i.test(sql), 'must not return user_id');
    assert.ok(!/jsonb_build_object.*p_phone_hash/i.test(sql), 'must not return phone_hash');
    assert.ok(!/jsonb_build_object.*p_ip_hash/i.test(sql), 'must not return ip_hash');
    assert.ok(!/jsonb_build_object.*p_claim_id/i.test(sql), 'must not return claim_id');
    assert.ok(!/jsonb_build_object.*p_challenge_id/i.test(sql), 'must not return challenge_id');
    assert.ok(!/jsonb_build_object.*p_session_id/i.test(sql), 'must not return session_id');
    assert.ok(!/access_token/i.test(sql), 'must not return access_token');
    assert.ok(!/refresh_token/i.test(sql), 'must not return refresh_token');
    assert.ok(!/otp_hash/i.test(sql), 'must not return otp_hash');
  });

  it('does not create or modify tables, columns, constraints, indexes, triggers, policies, or views', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create tables');
    assert.ok(!/ALTER\s+TABLE/i.test(sql), 'must not alter tables');
    assert.ok(!/CREATE\s+INDEX/i.test(sql), 'must not create indexes');
    assert.ok(!/DROP\s+INDEX/i.test(sql), 'must not drop indexes');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/CREATE\s+VIEW/i.test(sql), 'must not create views');
  });

  it('does not contain EXCEPTION WHEN OTHERS', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('does not call complete_phone_otp_login_challenge_v2', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/complete_phone_otp_login_challenge_v2/i.test(sql),
      'must not call complete_phone_otp_login_challenge_v2');
  });

  it('does not modify authorize_phone_otp_gateway_session_v1', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/authorize_phone_otp_gateway_session_v1/i.test(sql),
      'must not reference or modify authorize_phone_otp_gateway_session_v1');
  });

  it('previous migrations are not modified', () => {
    assert.ok(finalizationMigration, 'finalization RPC migration must still exist');
    assert.ok(aalFixMigration, 'aal fix migration must still exist');
    assert.ok(challengeTableMigration, 'challenge table migration must still exist');
    assert.ok(releaseMigration, 'release migration must still exist');
    assert.ok(gatewayMethodMigration, 'gateway method migration must still exist');
    assert.ok(sessionAllowlistMigration, 'session allowlist migration must still exist');
  });

  it('no formal assert.ok(true) assertions in this test file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpGatewayReconciliationRpc.test.ts'), 'utf8');
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
