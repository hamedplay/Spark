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

const raceFixMigration = migrationFiles.find((f) =>
  f.includes('phase5b1_fix_authorize_race_condition'),
);

const passwordLoginFn = readFileSync(
  join(root, 'supabase', 'functions', 'password-login', 'index.ts'),
  'utf8',
);

describe('Phase 5B-1 — Gateway Session Allowlist Foundation', () => {

  it('foundation migration file exists', () => {
    assert.ok(foundationMigration, 'phase5b1 foundation migration must exist');
  });

  it('race fix migration file exists', () => {
    assert.ok(raceFixMigration, 'phase5b1 race fix migration must exist');
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
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(sql.includes('REVOKE EXECUTE ON FUNCTION\npublic.authorize_password_gateway_session_v1'), 'must revoke execute');
    assert.ok(sql.includes('FROM PUBLIC, anon, authenticated'), 'must revoke from public/anon/authenticated');
    assert.ok(sql.includes('TO service_role'), 'must grant to service_role only');
  });

  it('authorize RPC validates session existence in auth.sessions', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(sql.includes('FROM auth.sessions\n    WHERE id = p_session_id AND user_id = p_user_id'), 'must check auth.sessions for session existence');
  });

  it('authorize RPC uses INSERT with RETURNING session_id INTO v_inserted_session_id', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(sql.includes('RETURNING session_id\n  INTO v_inserted_session_id'), 'must use RETURNING session_id INTO v_inserted_session_id');
    assert.ok(sql.includes('ON CONFLICT (session_id) DO NOTHING'), 'must use ON CONFLICT DO NOTHING');
  });

  it('authorize RPC returns authorized=true when insert succeeds', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(sql.includes('IF v_inserted_session_id IS NOT NULL THEN'), 'must check v_inserted_session_id is not null');
    assert.ok(sql.includes("'authorized', true,\n      'session_id', p_session_id"), 'must return authorized=true on successful insert');
  });

  it('authorize RPC re-reads user_id and login_method after conflict', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(sql.includes('SELECT user_id, login_method\n  INTO v_existing_user_id, v_existing_method'), 'must re-read user_id and login_method after conflict');
    assert.ok(sql.includes('FROM private.password_gateway_session_authorizations\n  WHERE session_id = p_session_id'), 'must read from authorizations table on conflict');
  });

  it('authorize RPC succeeds on conflict with same user and method', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(sql.includes('IF v_existing_user_id = p_user_id AND v_existing_method = p_login_method THEN'), 'must check exact match of user_id and method');
    assert.ok(sql.includes("'authorized', true,\n      'session_id', p_session_id"), 'must return authorized=true for matching conflict');
  });

  it('authorize RPC rejects conflict with different user or method', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    // The final return after all checks must be authorized=false
    const lastAuthorizedFalse = sql.lastIndexOf("RETURN jsonb_build_object('authorized', false)");
    const lastAuthorizedTrue = sql.lastIndexOf("'authorized', true");
    assert.ok(lastAuthorizedFalse > lastAuthorizedTrue, 'final fallthrough must return authorized=false');
  });

  it('authorize RPC does not UPDATE existing authorization rows', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    assert.ok(!sql.includes('UPDATE private.password_gateway_session_authorizations'), 'must not UPDATE existing rows');
    assert.ok(!sql.includes('SET identifier_hash'), 'must not update identifier_hash');
    assert.ok(!sql.includes('SET ip_hash'), 'must not update ip_hash');
  });

  it('authorize RPC does not use pre-check before insert', () => {
    assert.ok(raceFixMigration);
    const sql = readFileSync(join(migrationsDir, raceFixMigration!), 'utf8');
    // The old pattern had SELECT login_method INTO v_existing_method before INSERT
    // The new pattern must not have a pre-check SELECT before the INSERT
    const insertIdx = sql.indexOf('INSERT INTO private.password_gateway_session_authorizations');
    const selectExistingIdx = sql.indexOf('SELECT user_id, login_method\n  INTO v_existing_user_id, v_existing_method');
    assert.ok(insertIdx > -1, 'must have INSERT');
    assert.ok(selectExistingIdx > -1, 'must have SELECT after conflict');
    assert.ok(selectExistingIdx > insertIdx, 'SELECT for conflict resolution must come AFTER insert, not before');
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
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5GatewaySession.test.ts'), 'utf8');
    const assertCount = (testFile.match(/assert\.ok\(/g) || []).length;
    assert.ok(assertCount > 20, 'must have substantial real assertions, not formal tests');
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

describe('Phase 5C-2 — Gateway Authorization Session FK Cleanup', () => {
  const fkMigration = migrationFiles.find((f) =>
    f.includes('phase5c_gateway_authorization_session_fk'),
  );

  it('phase5c FK migration file exists on disk', () => {
    assert.ok(fkMigration, 'phase5c_gateway_authorization_session_fk migration must exist');
  });

  it('targets exactly private.password_gateway_session_authorizations table', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(sql.includes('private.password_gateway_session_authorizations'),
      'must target private.password_gateway_session_authorizations');
  });

  it('defines FK on exactly session_id column', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(/FOREIGN KEY\s*\(\s*session_id\s*\)/i.test(sql),
      'must define FOREIGN KEY on session_id');
  });

  it('references exactly auth.sessions(id)', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(/REFERENCES\s+auth\.sessions\s*\(\s*id\s*\)/i.test(sql),
      'must reference auth.sessions(id)');
  });

  it('includes ON DELETE CASCADE', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(/ON DELETE CASCADE/i.test(sql), 'must include ON DELETE CASCADE');
  });

  it('uses exact constraint name', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(sql.includes('password_gateway_session_authorizations_session_id_fkey'),
      'must use exact constraint name');
  });

  it('rejects pre-existing constraint with PASSWORD_GATEWAY_SESSION_FK_ALREADY_EXISTS', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(sql.includes('PASSWORD_GATEWAY_SESSION_FK_ALREADY_EXISTS'),
      'must raise exception when constraint already exists');
  });

  it('checks pg_constraint before adding', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(sql.includes('pg_constraint'), 'must check pg_constraint');
    assert.ok(sql.includes("conname ="), 'must check conname');
  });

  it('contains no DELETE FROM statement', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
  });

  it('contains no TRUNCATE statement', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
  });

  it('contains no DROP TABLE statement', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not contain DROP TABLE');
  });

  it('contains no UPDATE statement', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!/UPDATE\s+/i.test(sql), 'must not contain UPDATE');
  });

  it('does not modify auth.users', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!sql.includes('auth.users'), 'must not touch auth.users');
  });

  it('does not modify public.profiles', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!sql.includes('profiles'), 'must not touch profiles');
  });

  it('does not modify private.password_gateway_enforcement', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!sql.includes('password_gateway_enforcement'),
      'must not touch password_gateway_enforcement');
  });

  it('does not modify private.evaluate_current_auth_access', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!sql.includes('evaluate_current_auth_access'),
      'must not touch evaluate_current_auth_access');
  });

  it('does not modify public.authorize_password_gateway_session_v1', () => {
    assert.ok(fkMigration);
    const sql = readFileSync(join(migrationsDir, fkMigration!), 'utf8');
    assert.ok(!sql.includes('authorize_password_gateway_session_v1'),
      'must not touch authorize_password_gateway_session_v1');
  });
});

describe('Phase 5D — Phone Password Login Resolver Migration', () => {
  const resolverMigration = migrationFiles.find((f) =>
    f.includes('phase5d_phone_password_login_resolver'),
  );

  it('phase5d resolver migration file exists on disk', () => {
    assert.ok(resolverMigration, 'phase5d_phone_password_login_resolver migration must exist');
  });

  it('creates resolve_phone_password_login_v1 RPC', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('resolve_phone_password_login_v1'), 'must create resolve_phone_password_login_v1');
  });

  it('RPC returns only user_id', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('RETURNS TABLE(user_id uuid)'), 'must return only user_id');
  });

  it('RPC is SECURITY DEFINER with empty search_path', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/search_path\s*TO\s*''/i.test(sql), 'must have empty search_path');
  });

  it('RPC is STABLE', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(/STABLE/i.test(sql), 'must be STABLE');
  });

  it('RPC validates canonical phone format ^989[0-9]{9}
, () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('^989[0-9]{9}
), 'must validate canonical phone format');
  });

  it('RPC resolves from public.profiles with normalize_iran_phone_sql', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('public.profiles'), 'must query public.profiles');
    assert.ok(sql.includes('public.normalize_iran_phone_sql'), 'must use normalize_iran_phone_sql');
    assert.ok(sql.includes('p.phone IS NOT NULL'), 'must check phone IS NOT NULL');
  });

  it('RPC resolves from auth.users with normalize_iran_phone_sql and email check', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('auth.users'), 'must query auth.users');
    assert.ok(sql.includes('u.phone IS NOT NULL'), 'must check phone IS NOT NULL in auth.users');
    assert.ok(sql.includes('u.email IS NOT NULL'), 'must check email IS NOT NULL');
    assert.ok(sql.includes("btrim(u.email) <> ''"), 'must check btrim(email) is not empty');
  });

  it('RPC requires exactly one profile match', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('IF NOT FOUND'), 'must check NOT FOUND');
    assert.ok(/> 1/.test(sql), 'must check count > 1 for profiles');
  });

  it('RPC requires exactly one auth.users match', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(/> 1/.test(sql), 'must check count > 1 for auth.users');
  });

  it('RPC requires profile and auth user IDs to match', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(sql.includes('IS DISTINCT FROM'), 'must check user IDs match');
  });

  it('RPC does not return email, phone, or profile data', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(!/RETURN\s+QUERY\s+SELECT.*email/i.test(sql), 'must not return email');
    assert.ok(!/RETURN\s+QUERY\s+SELECT.*phone/i.test(sql), 'must not return phone');
    assert.ok(!/RETURN\s+QUERY\s+SELECT.*\*/i.test(sql), 'must not return all columns');
  });

  it('RPC revokes execute from PUBLIC, anon, authenticated', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.resolve_phone_password_login_v1\(text\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke execute from PUBLIC, anon, authenticated');
  });

  it('RPC grants execute only to service_role', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.resolve_phone_password_login_v1\(text\)\s+TO\s+service_role/i.test(sql),
      'must grant execute to service_role');
  });

  it('RPC does not contain DELETE, TRUNCATE, DROP TABLE, or UPDATE', () => {
    assert.ok(resolverMigration);
    const sql = readFileSync(join(migrationsDir, resolverMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not contain DROP TABLE');
    assert.ok(!/UPDATE\s+/i.test(sql), 'must not contain UPDATE');
  });

  it('password-login calls resolve_phone_password_login_v1 RPC in phone branch', () => {
    assert.ok(passwordLoginFn.includes('resolve_phone_password_login_v1'),
      'must call resolve_phone_password_login_v1 RPC');
  });

  it('password-login calls admin.auth.admin.getUserById for phone resolution', () => {
    assert.ok(passwordLoginFn.includes('getUserById'),
      'must call getUserById for phone-to-email resolution');
  });

  it('password-login signs in with email for phone method, not phone field', () => {
    assert.ok(!passwordLoginFn.includes('phone: signInIdentifier'),
      'must not use phone: signInIdentifier');
    assert.ok(passwordLoginFn.includes('email: signInIdentifier'),
      'must use email: signInIdentifier for all methods');
  });

  it('password-login still returns login_method as phone for phone method', () => {
    assert.ok(passwordLoginFn.includes('login_method: method'),
      'must return login_method as the original method');
  });

  it('password-login identifier hash uses canonical phone for phone method', () => {
    const hashIdx = passwordLoginFn.indexOf('password-login|identifier|${method}|${canonicalIdentifier}');
    assert.ok(hashIdx > -1, 'must build identifier hash from method and canonicalIdentifier');
  });

  it('password-login has no OTP or SMS in phone path', () => {
    assert.ok(!passwordLoginFn.includes('request-phone-login-otp'), 'must not call OTP endpoint');
    assert.ok(!passwordLoginFn.includes('verify-phone-login-otp'), 'must not call OTP verify endpoint');
    assert.ok(!passwordLoginFn.includes('sendOtp'), 'must not send OTP');
    assert.ok(!passwordLoginFn.includes('sendSms'), 'must not send SMS');
  });

  it('password-login uses artificial invalid email for anti-enumeration', () => {
    assert.ok(passwordLoginFn.includes('invalid-${crypto.randomUUID()}@example.invalid'),
      'must use artificial invalid email for anti-enumeration');
  });

  it('password-login returns 503 LOGIN_UNAVAILABLE on RPC error for phone', () => {
    const rpcIdx = passwordLoginFn.indexOf('resolve_phone_password_login_v1');
    assert.ok(rpcIdx > -1);
    const errBlock = passwordLoginFn.indexOf('LOGIN_UNAVAILABLE', rpcIdx);
    assert.ok(errBlock > -1, 'must return LOGIN_UNAVAILABLE on RPC error');
    const status503 = passwordLoginFn.indexOf('503', errBlock);
    assert.ok(status503 > -1, 'must return 503 status on RPC error');
  });

  it('password-login returns 503 LOGIN_UNAVAILABLE on admin API error for phone', () => {
    const getUserByIdIdx = passwordLoginFn.indexOf('getUserById');
    assert.ok(getUserByIdIdx > -1);
    const errBlock = passwordLoginFn.indexOf('LOGIN_UNAVAILABLE', getUserByIdIdx);
    assert.ok(errBlock > -1, 'must return LOGIN_UNAVAILABLE on admin API error');
  });
});

describe('Phase 5D Fix — Phone Resolver Profile user_id Correction', () => {
  const fixMigration = migrationFiles.find((f) =>
    f.includes('phase5d_fix_phone_resolver_profile_user_id'),
  );

  it('fix migration file exists on disk', () => {
    assert.ok(fixMigration, 'phase5d_fix_phone_resolver_profile_user_id migration must exist');
  });

  it('uses CREATE OR REPLACE FUNCTION for the same RPC', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql), 'must use CREATE OR REPLACE FUNCTION');
    assert.ok(sql.includes('resolve_phone_password_login_v1'), 'must target resolve_phone_password_login_v1');
  });

  it('preserves same signature: (p_normalized_phone text) RETURNS TABLE(user_id uuid)', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(sql.includes('p_normalized_phone text'), 'must have same parameter');
    assert.ok(sql.includes('RETURNS TABLE(user_id uuid)'), 'must return TABLE(user_id uuid)');
  });

  it('preserves SECURITY DEFINER, STABLE, and empty search_path', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/STABLE/i.test(sql), 'must be STABLE');
    assert.ok(/search_path\s*TO\s*''/i.test(sql), 'must have empty search_path');
  });

  it('uses SELECT p.user_id instead of SELECT p.id', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(/SELECT\s+p\.user_id/i.test(sql), 'must use SELECT p.user_id');
  });

  it('does not contain SELECT p.id INTO v_profile_user_id', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(!/SELECT\s+p\.id\s+INTO\s+v_profile_user_id/i.test(sql),
      'must not contain SELECT p.id INTO v_profile_user_id');
  });

  it('uses v_profile_count <> 1 for exactly-one profile check', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(sql.includes('v_profile_count <> 1'), 'must check v_profile_count <> 1');
  });

  it('uses v_auth_count <> 1 for exactly-one auth.users check', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(sql.includes('v_auth_count <> 1'), 'must check v_auth_count <> 1');
  });

  it('compares v_profile_user_id with v_auth_user_id using IS DISTINCT FROM', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(sql.includes('v_profile_user_id IS DISTINCT FROM v_auth_user_id'),
      'must compare profile and auth user IDs');
  });

  it('returns only user_id via RETURN QUERY SELECT', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(/RETURN\s+QUERY\s+SELECT\s+v_auth_user_id/i.test(sql),
      'must return only v_auth_user_id');
    assert.ok(!/RETURN\s+QUERY\s+SELECT.*email/i.test(sql), 'must not return email');
    assert.ok(!/RETURN\s+QUERY\s+SELECT.*phone/i.test(sql), 'must not return phone');
  });

  it('re-asserts ACL: revokes from PUBLIC, anon, authenticated and grants only service_role', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.resolve_phone_password_login_v1\(text\)\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i.test(sql),
      'must revoke execute from PUBLIC, anon, authenticated');
    assert.ok(/GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.resolve_phone_password_login_v1\(text\)\s+TO\s+service_role/i.test(sql),
      'must grant execute to service_role only');
  });

  it('sets owner to postgres', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(/ALTER\s+FUNCTION\s+public\.resolve_phone_password_login_v1\(text\)\s+OWNER\s+TO\s+postgres/i.test(sql),
      'must set owner to postgres');
  });

  it('does not contain DELETE, TRUNCATE, DROP TABLE, or UPDATE', () => {
    assert.ok(fixMigration);
    const sql = readFileSync(join(migrationsDir, fixMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not contain DROP TABLE');
    assert.ok(!/UPDATE\s+/i.test(sql), 'must not contain UPDATE');
  });

  it('original resolver migration is not modified (still on disk unchanged)', () => {
    const originalMigration = migrationFiles.find((f) =>
      f.includes('phase5d_phone_password_login_resolver') && !f.includes('fix'),
    );
    assert.ok(originalMigration, 'original phase5d migration must still exist');
    const sql = readFileSync(join(migrationsDir, originalMigration!), 'utf8');
    assert.ok(/SELECT\s+p\.id\s+INTO\s+v_profile_user_id/i.test(sql),
      'original migration must still contain the old p.id pattern (immutable)');
  });
});
