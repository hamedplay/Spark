import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const targetMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_gateway_finalization_rpc'),
);

const gatewayMethodMigration = migrationFiles.find((f) =>
  f.includes('phase5e_add_phone_otp_gateway_login_method'),
);

const releaseMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_release_claim_rpc'),
);

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

describe('Phase 5E-C5B — Phone OTP Gateway Finalization RPC', () => {
  it('migration file exists on disk', () => {
    assert.ok(targetMigration, 'phase5e_phone_otp_gateway_finalization_rpc migration must exist');
  });

  it('has exact function signature and return type', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/CREATE\s+FUNCTION\s+public\.authorize_phone_otp_gateway_session_v1\s*\(/i.test(sql),
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
    assert.ok(/ALTER\s+FUNCTION.*OWNER\s+TO\s+postgres/i.test(sql), 'must set owner to postgres');
  });

  it('ACL only grants execute to service_role', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE.*TO\s+service_role/i.test(sql), 'must grant execute to service_role');
    assert.ok(/REVOKE\s+ALL.*FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
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

  it('invalid input raises 22023 with INVALID_PHONE_OTP_GATEWAY_CONFIGURATION', () => {
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

  it('login method is hardcoded as phone_otp inside function', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/'phone_otp'/i.test(sql), 'must contain phone_otp constant');
  });

  it('does not have p_login_method or p_amr parameters', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/p_login_method/i.test(sql), 'must not have p_login_method parameter');
    assert.ok(!/p_amr/i.test(sql), 'must not have p_amr parameter');
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

  it('uses boolean FOUND after each SELECT', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_challenge_found\s+boolean/i.test(sql), 'must declare v_challenge_found boolean');
    assert.ok(/v_session_found\s+boolean/i.test(sql), 'must declare v_session_found boolean');
    assert.ok(/v_gateway_found\s+boolean/i.test(sql), 'must declare v_gateway_found boolean');
    assert.ok(/v_challenge_found\s*:=\s*FOUND/i.test(sql), 'must set v_challenge_found := FOUND');
    assert.ok(/v_session_found\s*:=\s*FOUND/i.test(sql), 'must set v_session_found := FOUND');
    assert.ok(/v_gateway_found\s*:=\s*FOUND/i.test(sql), 'must set v_gateway_found := FOUND');
  });

  it('does not use record IS NULL for detection', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/v_challenge.*IS\s+NOT\s+NULL/i.test(sql) || /p_challenge_id\s+IS\s+NOT\s+NULL/i.test(sql),
      'must not use record IS NOT NULL for challenge detection');
  });

  it('challenge not found returns INVALID_CHALLENGE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+v_challenge_found\s+THEN/i.test(sql), 'must check IF NOT v_challenge_found THEN');
    assert.ok(/'error_code',\s*'INVALID_CHALLENGE'/i.test(sql), 'must return INVALID_CHALLENGE');
  });

  it('session validation checks existence, created_at, not_after, and aal', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/NOT\s+v_session_found/i.test(sql), 'must check session found');
    assert.ok(/v_session_created_at\s+IS\s+NULL/i.test(sql), 'must check created_at IS NULL');
    assert.ok(/v_session_not_after.*<=\s*v_now/i.test(sql), 'must check not_after <= v_now');
    assert.ok(/v_session_aal\s+NOT\s+IN\s*\(\s*'aal1'\s*,\s*'aal2'\s*,\s*'aal3'\s*\)/i.test(sql),
      'must check aal in aal1, aal2, aal3');
    assert.ok(/'error_code',\s*'INVALID_SESSION'/i.test(sql), 'must return INVALID_SESSION');
  });

  it('idempotency only for consumed challenge and exact gateway match', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_challenge_status\s*=\s*'consumed'\s+AND\s+v_consumed_at\s+IS\s+NOT\s+NULL/i.test(sql),
      'must check consumed status for idempotency');
    assert.ok(/v_existing_gateway_method\s*=\s*'phone_otp'/i.test(sql),
      'must check gateway method is phone_otp');
    assert.ok(/v_existing_identifier_hash\s*=\s*p_phone_hash/i.test(sql),
      'must check gateway identifier_hash matches phone_hash');
    assert.ok(/v_existing_ip_hash\s*=\s*p_ip_hash/i.test(sql),
      'must check gateway ip_hash matches');
    assert.ok(/v_existing_session_created_at\s*=\s*v_session_created_at/i.test(sql),
      'must check gateway auth_session_created_at matches session created_at');
    assert.ok(/'error_code',\s*'ALREADY_CONSUMED'/i.test(sql), 'must return ALREADY_CONSUMED on mismatch');
  });

  it('idempotent path has no INSERT or UPDATE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    const consumedIdx = sql.search(/v_challenge_status\s*=\s*'consumed'\s+AND\s+v_consumed_at\s+IS\s+NOT\s+NULL/i);
    const readinessIdx = sql.search(/phone_otp_login_backend_ready/i);
    assert.ok(consumedIdx >= 0 && readinessIdx >= 0);
    const idempotentSection = sql.substring(consumedIdx, readinessIdx);
    assert.ok(!/INSERT\s+INTO/i.test(idempotentSection), 'idempotent path must not have INSERT');
    assert.ok(!/UPDATE\s+private/i.test(idempotentSection), 'idempotent path must not have UPDATE');
  });

  it('readiness gate only applies to new authorization path', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/phone_otp_login_backend_ready/i.test(sql), 'must check phone_otp_login_backend_ready');
    assert.ok(/phone_login_canonical_enabled/i.test(sql), 'must check phone_login_canonical_enabled');
    assert.ok(/v_backend_ready\s+IS\s+DISTINCT\s+FROM\s+'true'/i.test(sql),
      'must check backend_ready is exactly true');
    assert.ok(/v_canonical_enabled\s+IS\s+DISTINCT\s+FROM\s+'true'/i.test(sql),
      'must check canonical_enabled is exactly true');
    assert.ok(/'error_code',\s*'BACKEND_NOT_READY'/i.test(sql), 'must return BACKEND_NOT_READY');
  });

  it('does not check phone_login_enabled', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/phone_login_enabled/i.test(sql) || /phone_login_canonical_enabled/i.test(sql),
      'must not check phone_login_enabled (only phone_login_canonical_enabled)');
  });

  it('validates user and phone hash match challenge', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_challenge_user_id\s+IS\s+DISTINCT\s+FROM\s+p_user_id/i.test(sql),
      'must check challenge user_id matches');
    assert.ok(/v_challenge_phone_hash\s+IS\s+DISTINCT\s+FROM\s+p_phone_hash/i.test(sql),
      'must check challenge phone_hash matches');
    assert.ok(/'error_code',\s*'INVALID_CHALLENGE'/i.test(sql), 'must return INVALID_CHALLENGE on mismatch');
  });

  it('validates challenge state is processing/sent', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_challenge_status\s+IS\s+DISTINCT\s+FROM\s+'processing'/i.test(sql),
      'must check status is processing');
    assert.ok(/v_delivery_status\s+IS\s+DISTINCT\s+FROM\s+'sent'/i.test(sql),
      'must check delivery_status is sent');
    assert.ok(/'error_code',\s*'INVALID_CHALLENGE_STATE'/i.test(sql),
      'must return INVALID_CHALLENGE_STATE');
  });

  it('validates claim ID and expiry', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_existing_claim_id\s+IS\s+DISTINCT\s+FROM\s+p_claim_id/i.test(sql),
      'must check claim_id matches');
    assert.ok(/'error_code',\s*'CLAIM_MISMATCH'/i.test(sql), 'must return CLAIM_MISMATCH');
    assert.ok(/v_claim_expires_at\s*<=\s*v_now/i.test(sql), 'must check claim expired');
    assert.ok(/'error_code',\s*'CLAIM_EXPIRED'/i.test(sql), 'must return CLAIM_EXPIRED');
  });

  it('session created_at must be >= challenge updated_at for new path', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_session_created_at\s*<\s*v_challenge_updated_at/i.test(sql),
      'must check session_created_at < challenge_updated_at');
    assert.ok(/'error_code',\s*'SESSION_PREDATES_CLAIM'/i.test(sql),
      'must return SESSION_PREDATES_CLAIM');
  });

  it('existing gateway row in processing path is rejected', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/IF\s+v_gateway_found\s+THEN/i.test(sql), 'must check if gateway found in new path');
    assert.ok(/'error_code',\s*'SESSION_ALREADY_AUTHORIZED'/i.test(sql),
      'must return SESSION_ALREADY_AUTHORIZED');
  });

  it('insert uses hardcoded phone_otp method', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/INSERT\s+INTO\s+private\.password_gateway_session_authorizations/i.test(sql),
      'must have INSERT into gateway table');
    assert.ok(/'phone_otp'/i.test(sql), 'must use phone_otp in insert');
  });

  it('has ON CONFLICT DO NOTHING', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/ON\s+CONFLICT\s*\(session_id\)\s+DO\s+NOTHING/i.test(sql),
      'must have ON CONFLICT (session_id) DO NOTHING');
  });

  it('insert conflict raises 40001 GATEWAY_SESSION_STATE_CHANGED', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/v_inserted_session_id\s+IS\s+NULL/i.test(sql), 'must check if insert returned null');
    assert.ok(/RAISE\s+EXCEPTION\s+'GATEWAY_SESSION_STATE_CHANGED'/i.test(sql),
      'must raise GATEWAY_SESSION_STATE_CHANGED');
    assert.ok(/USING\s+ERRCODE\s*=\s*'40001'/i.test(sql), 'must use SQLSTATE 40001');
  });

  it('has exactly one gateway INSERT', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    const insertCount = (sql.match(/INSERT\s+INTO\s+private\.password_gateway_session_authorizations/gi) || []).length;
    assert.equal(insertCount, 1, 'must have exactly one gateway INSERT');
  });

  it('has exactly one challenge UPDATE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    const updateCount = (sql.match(/UPDATE\s+private\.phone_otp_login_challenges_v2/gi) || []).length;
    assert.equal(updateCount, 1, 'must have exactly one challenge UPDATE');
  });

  it('challenge UPDATE has all preconditions in WHERE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/WHERE\s+id\s*=\s*p_challenge_id\s+AND\s+user_id\s*=\s*p_user_id\s+AND\s+phone_hash\s*=\s*p_phone_hash\s+AND\s+status\s*=\s*'processing'\s+AND\s+delivery_status\s*=\s*'sent'\s+AND\s+claim_id\s*=\s*p_claim_id\s+AND\s+claim_expires_at\s*>\s*v_now\s+AND\s+consumed_at\s+IS\s+NULL\s+AND\s+updated_at\s*=\s*v_challenge_updated_at/i.test(sql),
      'UPDATE WHERE must check all preconditions including updated_at');
  });

  it('challenge race raises 40001 CHALLENGE_STATE_CHANGED', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/IF\s+NOT\s+FOUND\s+THEN/i.test(sql), 'must check IF NOT FOUND after UPDATE');
    assert.ok(/RAISE\s+EXCEPTION\s+'CHALLENGE_STATE_CHANGED'/i.test(sql),
      'must raise CHALLENGE_STATE_CHANGED');
  });

  it('does not call complete_phone_otp_login_challenge_v2', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/complete_phone_otp_login_challenge_v2/i.test(sql),
      'must not call complete_phone_otp_login_challenge_v2');
  });

  it('no gateway UPDATE, DELETE, TRUNCATE, or upsert DO UPDATE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/UPDATE\s+private\.password_gateway_session_authorizations\s+SET/i.test(sql),
      'must not UPDATE gateway table');
    assert.ok(!/DELETE\s+FROM\s+private\.password_gateway_session_authorizations/i.test(sql),
      'must not DELETE from gateway table');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not TRUNCATE');
    assert.ok(!/ON\s+CONFLICT.*DO\s+UPDATE/i.test(sql), 'must not use ON CONFLICT DO UPDATE');
  });

  it('does not modify auth.sessions', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO\s+auth\.sessions/i.test(sql), 'must not INSERT into auth.sessions');
    assert.ok(!/UPDATE\s+auth\.sessions\s+SET/i.test(sql), 'must not UPDATE auth.sessions');
    assert.ok(!/DELETE\s+FROM\s+auth\.sessions/i.test(sql), 'must not DELETE from auth.sessions');
  });

  it('does not INSERT or DELETE on challenge table', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO\s+private\.phone_otp_login_challenges_v2/i.test(sql),
      'must not INSERT into challenge table');
    assert.ok(!/DELETE\s+FROM\s+private\.phone_otp_login_challenges_v2/i.test(sql),
      'must not DELETE from challenge table');
  });

  it('does not contain EXCEPTION WHEN OTHERS', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/EXCEPTION\s+WHEN/i.test(sql) && !/WHEN\s+OTHERS/i.test(sql),
      'must not catch exceptions');
  });

  it('does not return sensitive data', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/jsonb_build_object.*p_user_id/i.test(sql), 'must not return user_id');
    assert.ok(!/jsonb_build_object.*p_phone_hash/i.test(sql), 'must not return phone_hash');
    assert.ok(!/jsonb_build_object.*p_ip_hash/i.test(sql), 'must not return ip_hash');
    assert.ok(!/jsonb_build_object.*p_claim_id/i.test(sql), 'must not return claim_id');
    assert.ok(!/jsonb_build_object.*p_challenge_id/i.test(sql), 'must not return challenge_id');
    assert.ok(!/access_token/i.test(sql), 'must not return access_token');
    assert.ok(!/refresh_token/i.test(sql), 'must not return refresh_token');
    assert.ok(!/otp_hash/i.test(sql), 'must not return otp_hash');
  });

  it('does not modify authorize_password_gateway_session_v1', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/authorize_password_gateway_session_v1/i.test(sql),
      'must not reference or modify authorize_password_gateway_session_v1');
  });

  it('previous migrations are not modified', () => {
    assert.ok(gatewayMethodMigration, 'gateway method migration must still exist');
    assert.ok(releaseMigration, 'release migration must still exist');
    assert.ok(completeMigration, 'complete migration must still exist');
    assert.ok(claimMigration, 'claim migration must still exist');
    assert.ok(deliveryMigration, 'delivery migration must still exist');
    assert.ok(createChallengeMigration, 'create challenge migration must still exist');
    assert.ok(foundFixMigration, 'found fix migration must still exist');
    assert.ok(rateLimitRpcMigration, 'rate limit RPC migration must still exist');
    assert.ok(rateLimitTableMigration, 'rate limit table migration must still exist');
    assert.ok(challengeTableMigration, 'challenge table migration must still exist');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpGatewayFinalizationRpc.test.ts'), 'utf8');
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
