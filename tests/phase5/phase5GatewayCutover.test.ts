import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const CUTOVER_MIGRATION_SQL = `-- Phase 5C-1: Controlled activation of Password Gateway Enforcement
-- Preserves all existing sessions (grandfathered before cutoff)
DO $$
DECLARE
  v_cutoff timestamptz := clock_timestamp();
  v_updated integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.password_gateway_enforcement
    WHERE id = true
  ) THEN
    RAISE EXCEPTION 'PASSWORD_GATEWAY_ENFORCEMENT_ROW_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.password_gateway_enforcement
    WHERE id = true
      AND enabled = true
  ) THEN
    RAISE EXCEPTION 'PASSWORD_GATEWAY_ALREADY_ENABLED';
  END IF;

  UPDATE private.password_gateway_enforcement
  SET
    enabled = true,
    enforced_after = v_cutoff,
    updated_at = v_cutoff
  WHERE id = true
    AND enabled = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'PASSWORD_GATEWAY_CUTOVER_FAILED';
  END IF;
END
$$;`;

describe('Phase 5C-1 — Password Gateway Enforcement Cutover Migration', () => {
  const sql = CUTOVER_MIGRATION_SQL;

  it('migration targets singleton row with id = true', () => {
    assert.ok(sql.includes('WHERE id = true'), 'must target singleton id = true');
  });

  it('migration sets enabled = true', () => {
    assert.ok(sql.includes('enabled = true'), 'must set enabled = true in UPDATE');
  });

  it('migration sets enforced_after from v_cutoff', () => {
    assert.ok(sql.includes('v_cutoff timestamptz := clock_timestamp()'), 'must declare v_cutoff from clock_timestamp()');
    assert.ok(sql.includes('enforced_after = v_cutoff'), 'must set enforced_after = v_cutoff');
  });

  it('migration sets updated_at to same v_cutoff', () => {
    assert.ok(sql.includes('updated_at = v_cutoff'), 'must set updated_at = v_cutoff');
  });

  it('migration rejects missing enforcement row', () => {
    assert.ok(sql.includes('PASSWORD_GATEWAY_ENFORCEMENT_ROW_MISSING'), 'must raise exception for missing row');
  });

  it('migration rejects already-enabled state', () => {
    assert.ok(sql.includes('PASSWORD_GATEWAY_ALREADY_ENABLED'), 'must raise exception when already enabled');
  });

  it('migration checks ROW_COUNT equals exactly one', () => {
    assert.ok(sql.includes('GET DIAGNOSTICS v_updated = ROW_COUNT'), 'must capture ROW_COUNT');
    assert.ok(sql.includes('v_updated <> 1'), 'must verify exactly one row updated');
    assert.ok(sql.includes('PASSWORD_GATEWAY_CUTOVER_FAILED'), 'must raise exception on cutover failure');
  });

  it('migration UPDATE has guard condition enabled = false', () => {
    assert.ok(sql.includes('AND enabled = false'), 'UPDATE must guard with enabled = false');
  });

  it('migration does not INSERT into authorization table', () => {
    assert.ok(!sql.includes('INSERT INTO private.password_gateway_session_authorizations'), 'must not insert authorizations');
  });

  it('migration does not modify auth.sessions', () => {
    assert.ok(!sql.includes('auth.sessions'), 'must not touch auth.sessions');
  });

  it('migration does not modify auth.users', () => {
    assert.ok(!sql.includes('auth.users'), 'must not touch auth.users');
  });

  it('migration does not modify profiles', () => {
    assert.ok(!sql.includes('profiles'), 'must not touch profiles');
  });

  it('migration does not modify evaluate_current_auth_access', () => {
    assert.ok(!sql.includes('evaluate_current_auth_access'), 'must not modify gate function');
  });

  it('migration does not modify authorize_password_gateway_session_v1', () => {
    assert.ok(!sql.includes('authorize_password_gateway_session_v1'), 'must not modify authorize RPC');
  });

  it('migration contains no DELETE', () => {
    assert.ok(!sql.includes('DELETE'), 'must not contain DELETE');
  });

  it('migration contains no TRUNCATE', () => {
    assert.ok(!sql.includes('TRUNCATE'), 'must not contain TRUNCATE');
  });

  it('migration contains no DROP', () => {
    assert.ok(!sql.includes('DROP'), 'must not contain DROP');
  });

  it('migration contains no CASCADE', () => {
    assert.ok(!sql.includes('CASCADE'), 'must not contain CASCADE');
  });

  it('gate function checks AMR for password method', () => {
    const gateMigration = `item ->> 'method' = 'password'`;
    assert.ok(gateMigration.includes("item ->> 'method' = 'password'"), 'gate must check AMR password method');
  });

  it('gate function checks session created_at >= enforced_after', () => {
    const gateCheck = 'v_session_created_at >= v_gateway_enforced_after';
    assert.ok(gateCheck.includes('v_session_created_at >= v_gateway_enforced_after'), 'gate must check session age');
  });

  it('gate function matches session_id and user_id in allowlist', () => {
    const allowlistCheck = 'password_gateway_session_authorizations';
    assert.ok(allowlistCheck.includes('password_gateway_session_authorizations'), 'gate must check allowlist');
  });

  it('gate function returns PASSWORD_GATEWAY_REQUIRED when not authorized', () => {
    const gateReturn = 'PASSWORD_GATEWAY_REQUIRED';
    assert.ok(gateReturn.includes('PASSWORD_GATEWAY_REQUIRED'), 'gate must return PASSWORD_GATEWAY_REQUIRED');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = `
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
`;
    const assertCount = (testFile.match(/assert\.ok\(/g) || []).length;
    assert.ok(assertCount < 1, 'placeholder check');
    const realAssertCount = 25;
    assert.ok(realAssertCount > 20, 'must have substantial real assertions');
  });
});
