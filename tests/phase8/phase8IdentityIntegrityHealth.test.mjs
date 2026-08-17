import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../supabase/migrations/20260811154000_phase8_auth_identity_integrity_health.sql', import.meta.url),
  'utf8',
);
const edge = readFileSync(
  new URL('../../supabase/functions/auth-health-check/index.ts', import.meta.url),
  'utf8',
);

test('identity health RPC is aggregate-only and service-role restricted', () => {
  assert.match(migration, /returns jsonb/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all .* public, anon, authenticated/i);
  assert.match(migration, /grant execute .* service_role/i);
  assert.doesNotMatch(migration, /select\s+.*email|select\s+.*raw_user_meta_data/i);
});

test('health endpoint uses canonical lifecycle status and an origin allowlist', () => {
  assert.match(edge, /account_status/);
  assert.doesNotMatch(edge, /profile\?\.is_active/);
  assert.match(edge, /PHONE_LOGIN_ALLOWED_ORIGINS/);
  assert.doesNotMatch(edge, /"Access-Control-Allow-Origin": "\*"/);
  assert.match(edge, /get_auth_identity_integrity_v1/);
});
