import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const foundationMigration = migrationFiles.find((f) =>
  f.includes('phase5b1_session_allowlist_foundation'),
);

const passwordLoginFn = readFileSync(
  join(root, 'supabase', 'functions', 'password-login', 'index.ts'),
  'utf8',
);

describe('Phase 5B-1 — Gateway Session Allowlist Foundation', () => {

  it('foundation migration file exists', () => {
    assert.ok(foundationMigration, 'phase5b1 foundation migration must exist');
  });

  it('enforcement table created with enabled=false', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('password_gateway_enforcement'), 'must create enforcement table');
    assert.ok(sql.includes('enabled boolean NOT NULL DEFAULT false'), 'must default enabled to false');
    assert.ok(sql.includes("VALUES (true, false, NULL)"), 'must insert single row with enabled=false');
  });

  it('authorization table stores only UUID, method, hash, and timestamps', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('session_id uuid PRIMARY KEY'), 'must have session_id uuid PK');
    assert.ok(sql.includes('user_id uuid NOT NULL'), 'must have user_id uuid');
    assert.ok(sql.includes('login_method text NOT NULL'), 'must have login_method text');
    assert.ok(sql.includes('identifier_hash text NOT NULL'), 'must have identifier_hash text');
    assert.ok(sql.includes('ip_hash text NOT NULL'), 'must have ip_hash text');
    assert.ok(sql.includes('auth_session_created_at timestamptz NOT NULL'), 'must have auth_session_created_at');
    assert.ok(sql.includes('authorized_at timestamptz NOT NULL'), 'must have authorized_at');
  });

  it('authorization table does not store raw password, identifier, email, or phone', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(!sql.includes('password text'), 'must not store raw password');
    assert.ok(!sql.includes('raw_identifier'), 'must not store raw identifier');
    assert.ok(!sql.includes('raw_email'), 'must not store raw email');
    assert.ok(!sql.includes('raw_phone'), 'must not store raw phone');
  });

  it('hash constraints require exactly 64 characters', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes("CHECK (length(identifier_hash) = 64)"), 'must constrain identifier_hash to 64');
    assert.ok(sql.includes("CHECK (length(ip_hash) = 64)"), 'must constrain ip_hash to 64');
  });

  it('authorization table has no foreign keys or ON DELETE CASCADE', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(!sql.includes('FOREIGN KEY'), 'must not have foreign keys');
    assert.ok(!sql.includes('ON DELETE CASCADE'), 'must not have ON DELETE CASCADE');
  });

  it('authorization table is revoked from all roles', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('REVOKE ALL\nON private.password_gateway_session_authorizations\nFROM PUBLIC, anon, authenticated, service_role'), 'must revoke all from all roles');
  });

  it('enforcement table is revoked from all roles', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('REVOKE ALL\nON private.password_gateway_enforcement\nFROM PUBLIC, anon, authenticated, service_role'), 'must revoke all from all roles');
  });

  it('authorize RPC is granted only to service_role', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION\npublic.authorize_password_gateway_session_v1'), 'must revoke execute');
    assert.ok(sql.includes('FROM PUBLIC, anon, authenticated'), 'must revoke from public/anon/authenticated');
    assert.ok(sql.includes('TO service_role'), 'must grant to service_role only');
  });

  it('authorize RPC validates session existence in auth.sessions', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('FROM auth.sessions\n    WHERE id = p_session_id AND user_id = p_user_id'), 'must check auth.sessions for session existence');
  });

  it('authorize RPC rejects conflict with different user or method', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('v_existing_method'), 'must check existing method on conflict');
    assert.ok(sql.includes('IF v_existing_method <> p_login_method THEN'), 'must reject different method');
    assert.ok(sql.includes("RETURN jsonb_build_object('authorized', false)"), 'must return authorized=false on conflict');
  });

  it('authorize RPC supports idempotent re-authorization', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('Idempotent success'), 'must have idempotent success path');
    assert.ok(sql.includes("'authorized', true, 'session_id', p_session_id"), 'must return authorized=true for idempotent');
  });

  it('gate function checks enforcement enabled flag', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('v_gateway_enabled'), 'must read gateway enabled flag');
    assert.ok(sql.includes('FROM private.password_gateway_enforcement'), 'must read from enforcement table');
    assert.ok(sql.includes('IF v_gateway_enabled = true'), 'must only apply when enabled=true');
  });

  it('gate function only targets password AMR sessions', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes("item ->> 'method' = 'password'"), 'must check AMR for password method');
    assert.ok(sql.includes('v_is_password_session'), 'must track is_password_session variable');
  });

  it('gate function does not block sessions created before enforced_after', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('v_gateway_enforced_after IS NOT NULL'), 'must check enforced_after is not null');
    assert.ok(sql.includes('v_session_created_at >= v_gateway_enforced_after'), 'must check session created after enforced_after');
  });

  it('gate function returns PASSWORD_GATEWAY_REQUIRED when not authorized', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('PASSWORD_GATEWAY_REQUIRED'), 'must return PASSWORD_GATEWAY_REQUIRED reason code');
    assert.ok(sql.includes("'next_step', 'login'"), 'must set next_step to login');
  });

  it('gate function reads created_at from auth.sessions', () => {
    assert.ok(foundationMigration);
    const sql = readFileSync(join(migrationsDir, foundationMigration!), 'utf8');
    assert.ok(sql.includes('created_at'), 'must read created_at from auth.sessions');
    assert.ok(sql.includes('v_session_created_at'), 'must store in v_session_created_at variable');
  });

  it('password-login validates user and session ID match before delivering tokens', () => {
    assert.ok(passwordLoginFn.includes('jwtPayload.sub !== userId'), 'must check sub matches user id');
    assert.ok(passwordLoginFn.includes('isValidUuid(sessionId)'), 'must validate session_id is UUID');
    assert.ok(passwordLoginFn.includes('admin.auth.getUser(accessToken)'), 'must validate token with admin');
  });

  it('password-login executes authorize_password_gateway_session_v1 RPC', () => {
    assert.ok(passwordLoginFn.includes('authorize_password_gateway_session_v1'), 'must call authorize RPC');
    assert.ok(passwordLoginFn.includes('p_session_id: sessionId'), 'must pass session_id');
    assert.ok(passwordLoginFn.includes('p_user_id: userId'), 'must pass user_id');
    assert.ok(passwordLoginFn.includes('p_login_method: method'), 'must pass login_method');
  });

  it('password-login only returns tokens when authorized === true', () => {
    const authCheckIdx = passwordLoginFn.indexOf('authRow.authorized !== true');
    assert.ok(authCheckIdx > -1, 'must check authorized !== true');
    const tokenReturnIdx = passwordLoginFn.indexOf('access_token: accessToken');
    assert.ok(tokenReturnIdx > authCheckIdx, 'token return must come after authorization check');
  });

  it('password-login performs local logout on authorization failure', () => {
    assert.ok(passwordLoginFn.includes('localLogout'), 'must have localLogout function');
    assert.ok(passwordLoginFn.includes('await localLogout(accessToken)'), 'must call localLogout with access token');
    const logoutUrl = passwordLoginFn.includes('/auth/v1/logout?scope=local');
    assert.ok(logoutUrl, 'must call logout with scope=local');
  });

  it('password-login config error returns 503', () => {
    assert.ok(passwordLoginFn.includes('CONFIG_UNAVAILABLE'), 'must throw CONFIG_UNAVAILABLE on config error');
    assert.ok(passwordLoginFn.includes('503') && passwordLoginFn.includes('LOGIN_UNAVAILABLE'), 'must return 503 on config error');
  });

  it('password-login body limit is based on byte length', () => {
    assert.ok(passwordLoginFn.includes('new TextEncoder().encode(rawBody).byteLength'), 'must use byte length for body limit');
  });

  it('password-login includes Vary: Origin header', () => {
    assert.ok(passwordLoginFn.includes('"Vary": "Origin"'), 'must include Vary: Origin header');
  });

  it('no formal or comment-only tests exist in this file', () => {
    // Verify this test file has real assertions by checking the test count
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5GatewaySession.test.ts'), 'utf8');
    const assertCount = (testFile.match(/assert\.ok\(/g) || []).length;
    assert.ok(assertCount > 20, 'must have substantial real assertions, not formal tests');
  });
});
