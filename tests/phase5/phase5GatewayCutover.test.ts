import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

const cutoverSql = readFileSync(
  join(
    root,
    'supabase',
    'migrations',
    '20260806092335_phase5c_enable_password_gateway_enforcement.sql',
  ),
  'utf8',
);

const gatewayFoundationSql = readFileSync(
  join(
    root,
    'supabase',
    'migrations',
    '20260805235045_20260806020000_phase5b1_session_allowlist_foundation.sql.sql',
  ),
  'utf8',
);

const fnStart = gatewayFoundationSql.indexOf(
  'CREATE OR REPLACE FUNCTION private.evaluate_current_auth_access()',
);
const fnEnd = gatewayFoundationSql.indexOf('$function$;', fnStart);
const gateFunctionSrc = gatewayFoundationSql.slice(fnStart, fnEnd);

describe('Phase 5C-1 — Password Gateway Enforcement Cutover Migration', () => {

  it('declares v_cutoff from clock_timestamp()', () => {
    assert.ok(cutoverSql.includes('v_cutoff timestamptz := clock_timestamp()'));
  });

  it('sets enabled = true in UPDATE', () => {
    assert.ok(cutoverSql.includes('enabled = true'));
  });

  it('sets enforced_after = v_cutoff', () => {
    assert.ok(cutoverSql.includes('enforced_after = v_cutoff'));
  });

  it('sets updated_at = v_cutoff', () => {
    assert.ok(cutoverSql.includes('updated_at = v_cutoff'));
  });

  it('targets singleton row with WHERE id = true', () => {
    assert.ok(cutoverSql.includes('WHERE id = true'));
  });

  it('rejects missing enforcement row', () => {
    assert.ok(cutoverSql.includes('PASSWORD_GATEWAY_ENFORCEMENT_ROW_MISSING'));
  });

  it('rejects already-enabled state', () => {
    assert.ok(cutoverSql.includes('PASSWORD_GATEWAY_ALREADY_ENABLED'));
  });

  it('captures ROW_COUNT via GET DIAGNOSTICS', () => {
    assert.ok(cutoverSql.includes('GET DIAGNOSTICS v_updated = ROW_COUNT'));
  });

  it('verifies exactly one row updated', () => {
    assert.ok(cutoverSql.includes('v_updated <> 1'));
  });

  it('UPDATE guards with enabled = false', () => {
    assert.ok(cutoverSql.includes('AND enabled = false'));
  });

  it('does not INSERT into authorization table', () => {
    assert.ok(!cutoverSql.includes('INSERT INTO private.password_gateway_session_authorizations'));
  });

  it('does not modify auth.sessions', () => {
    assert.ok(!cutoverSql.includes('auth.sessions'));
  });

  it('does not modify auth.users', () => {
    assert.ok(!cutoverSql.includes('auth.users'));
  });

  it('does not modify profiles', () => {
    assert.ok(!cutoverSql.includes('profiles'));
  });

  it('contains no DELETE statement', () => {
    assert.ok(!/\bDELETE\b/.test(cutoverSql));
  });

  it('contains no TRUNCATE statement', () => {
    assert.ok(!/\bTRUNCATE\b/.test(cutoverSql));
  });

  it('contains no DROP statement', () => {
    assert.ok(!/\bDROP\b/.test(cutoverSql));
  });

  it('contains no CASCADE', () => {
    assert.ok(!/\bCASCADE\b/.test(cutoverSql));
  });
});

describe('Phase 5C-1 — Gate function (evaluate_current_auth_access)', () => {

  it('checks AMR for password method via jsonb_array_elements', () => {
    assert.ok(gateFunctionSrc.includes('jsonb_array_elements'));
    assert.ok(gateFunctionSrc.includes("item ->> 'method' = 'password'"));
  });

  it('checks session created_at >= enforced_after', () => {
    assert.ok(gateFunctionSrc.includes('v_session_created_at >= v_gateway_enforced_after'));
  });

  it('matches session_id and user_id in allowlist', () => {
    assert.ok(gateFunctionSrc.includes('session_id = v_session_id'));
    assert.ok(gateFunctionSrc.includes('user_id = v_uid'));
  });

  it('returns PASSWORD_GATEWAY_REQUIRED when not authorized', () => {
    assert.ok(gateFunctionSrc.includes('PASSWORD_GATEWAY_REQUIRED'));
  });

  it('returns access_level BLOCKED with next_step login', () => {
    assert.ok(gateFunctionSrc.includes('access_level'));
    assert.ok(gateFunctionSrc.includes('BLOCKED'));
    assert.ok(gateFunctionSrc.includes('next_step'));
    assert.ok(gateFunctionSrc.includes("'login'"));
  });

  it('activates only when gateway enabled, enforced_after set, and password session', () => {
    assert.ok(gateFunctionSrc.includes('v_gateway_enabled = true'));
    assert.ok(gateFunctionSrc.includes('v_gateway_enforced_after IS NOT NULL'));
    assert.ok(gateFunctionSrc.includes('v_is_password_session = true'));
  });
});
