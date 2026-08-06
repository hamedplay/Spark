import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');

const prevMigrationPath = join(
  migrationsDir,
  '20260806222947_20260806220000_phase5e_d5a_activate_phone_otp_login_backend.sql.sql',
);

const newMigrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.includes('phase5e_revalidate_phone_otp_activation'))
  .map((f) => join(migrationsDir, f));

const newMigrationSrc = newMigrationFiles
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const prevMigrationSrc = readFileSync(prevMigrationPath, 'utf8');

describe('Phase 5E-D5A Fix — Fail-closed Activation Revalidation', () => {
  it('previous migration file is unchanged and still exists', () => {
    assert.ok(existsSync(prevMigrationPath), 'previous migration must still exist');
    assert.ok(
      prevMigrationSrc.includes('Controlled Phone OTP Backend Activation'),
      'previous migration must retain its original header',
    );
    assert.ok(
      prevMigrationSrc.includes("key = 'phone_otp_login_backend_ready'"),
      'previous migration must still reference the flag key',
    );
  });

  it('new migration file exists', () => {
    for (const f of newMigrationFiles) {
      assert.ok(existsSync(f), `migration file must exist: ${f}`);
    }
  });

  it('migration starts by setting backend to false (fail-safe shutdown)', () => {
    assert.ok(
      /UPDATE\s+public\.system_config\s+SET\s+value\s*=\s*'false'[\s\S]*?phone_otp_login_backend_ready/i.test(newMigrationSrc),
      'must set flag to false first',
    );
  });

  it('uses GET DIAGNOSTICS ROW_COUNT after the shutdown UPDATE', () => {
    assert.ok(
      /GET\s+DIAGNOSTICS\s+v_row_count\s*=\s*ROW_COUNT/i.test(newMigrationSrc),
      'must capture ROW_COUNT via GET DIAGNOSTICS',
    );
  });

  it('checks row count is exactly one', () => {
    assert.ok(
      /v_row_count\s*<>\s*1/i.test(newMigrationSrc),
      'must verify row count is exactly 1',
    );
  });

  it('does not contain any INSERT statement', () => {
    assert.ok(
      !/INSERT\s+INTO/i.test(newMigrationSrc),
      'migration must not contain INSERT',
    );
  });

  it('does not contain DELETE, TRUNCATE, DROP, or ALTER as SQL statements', () => {
    const sqlStatements = newMigrationSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    assert.ok(!/DELETE\s+FROM/i.test(sqlStatements), 'must not contain DELETE');
    assert.ok(!/TRUNCATE\s+/i.test(sqlStatements), 'must not contain TRUNCATE');
    assert.ok(!/DROP\s+/i.test(sqlStatements), 'must not contain DROP');
    assert.ok(!/ALTER\s+/i.test(sqlStatements), 'must not contain ALTER');
  });

  it('checks phone_login_canonical_enabled = true', () => {
    assert.ok(
      /phone_login_canonical_enabled/i.test(newMigrationSrc),
      'must check phone_login_canonical_enabled',
    );
  });

  it('checks TTL between 30 and 300', () => {
    assert.ok(/v_ttl\s*>=\s*30/i.test(newMigrationSrc), 'must check TTL >= 30');
    assert.ok(/v_ttl\s*<=\s*300/i.test(newMigrationSrc), 'must check TTL <= 300');
  });

  it('checks Resend between 30 and 300', () => {
    assert.ok(/v_resend\s*>=\s*30/i.test(newMigrationSrc), 'must check resend >= 30');
    assert.ok(/v_resend\s*<=\s*300/i.test(newMigrationSrc), 'must check resend <= 300');
  });

  it('checks Resend <= TTL', () => {
    assert.ok(
      /v_resend\s*>\s*v_ttl/i.test(newMigrationSrc),
      'must check resend does not exceed TTL',
    );
  });

  it('checks Max Attempts between 3 and 10', () => {
    assert.ok(/v_max_attempts\s*>=\s*3/i.test(newMigrationSrc), 'must check max_attempts >= 3');
    assert.ok(/v_max_attempts\s*<=\s*10/i.test(newMigrationSrc), 'must check max_attempts <= 10');
  });

  it('checks provider from system_config section=sms key=phone_login_sms_provider_id', () => {
    assert.ok(
      /section\s*=\s*'sms'[\s\S]*?key\s*=\s*'phone_login_sms_provider_id'/i.test(newMigrationSrc),
      'must check provider_id from sms config',
    );
  });

  it('validates provider UUID and sms_providers.is_active', () => {
    assert.ok(
      /v_provider_id_text::uuid/i.test(newMigrationSrc),
      'must cast provider_id to uuid',
    );
    assert.ok(
      /sms_providers[\s\S]*?is_active/i.test(newMigrationSrc),
      'must check sms_providers.is_active',
    );
  });

  it('uses public.sms_templates (not notification_templates)', () => {
    assert.ok(
      /public\.sms_templates/i.test(newMigrationSrc),
      'must use public.sms_templates',
    );
    assert.ok(
      !/notification_templates/i.test(newMigrationSrc),
      'must not use notification_templates for login_otp',
    );
  });

  it('checks event_type = login_otp', () => {
    assert.ok(
      /event_type\s*=\s*'login_otp'/i.test(newMigrationSrc),
      'must check event_type=login_otp',
    );
  });

  it('checks exactly one template with exactly one {{otp}}', () => {
    assert.ok(
      /v_template_count\s*=\s*1/i.test(newMigrationSrc),
      'must check template count = 1',
    );
    assert.ok(
      /v_otp_count\s*=\s*1/i.test(newMigrationSrc),
      'must check otp count = 1',
    );
  });

  it('calls get_phone_auth_config() and checks pepper length >= 32', () => {
    assert.ok(
      /get_phone_auth_config\(\)/i.test(newMigrationSrc),
      'must call get_phone_auth_config()',
    );
    assert.ok(
      /v_pepper_len\s*<\s*32/i.test(newMigrationSrc),
      'must check pepper length >= 32',
    );
  });

  it('checks allowed_origins includes https://shahrmeeting.ir', () => {
    assert.ok(
      /https:\/\/shahrmeeting\.ir/i.test(newMigrationSrc),
      'must check https://shahrmeeting.ir in allowed_origins',
    );
  });

  it('checks all seven public RPCs exist', () => {
    const rpcs = [
      'consume_phone_otp_login_rate_limit_v2',
      'create_phone_otp_login_challenge_v2',
      'set_phone_otp_login_delivery_v2',
      'claim_phone_otp_login_challenge_v2',
      'release_phone_otp_login_challenge_v2',
      'authorize_phone_otp_gateway_session_v1',
      'reconcile_phone_otp_gateway_session_v1',
    ];
    for (const rpc of rpcs) {
      assert.ok(
        newMigrationSrc.includes(rpc),
        `must reference RPC: ${rpc}`,
      );
    }
    assert.ok(
      /v_rpc_count\s*<>\s*7/i.test(newMigrationSrc),
      'must verify exactly 7 RPCs found',
    );
  });

  it('only flips to true after all preconditions pass', () => {
    assert.ok(
      /IF\s+v_preflight_ok\s+THEN/i.test(newMigrationSrc),
      'must gate activation on v_preflight_ok',
    );
    assert.ok(
      /SET\s+value\s*=\s*'true'[\s\S]*?AND\s+value\s*=\s*'false'/i.test(newMigrationSrc),
      'must only set true if currently false',
    );
  });

  it('preflight failure keeps backend false and raises WARNING', () => {
    assert.ok(
      /RAISE\s+WARNING[\s\S]*?Backend\s+stays\s+false/i.test(newMigrationSrc),
      'must RAISE WARNING on preflight failure and keep backend false',
    );
  });

  it('does not raise an exception on row count mismatch (no rollback of shutdown)', () => {
    const rowCountBlock = newMigrationSrc.match(
      /v_row_count\s*<>\s*1[\s\S]*?END\s+IF/i,
    );
    assert.ok(rowCountBlock, 'must have row count check block');
    assert.ok(
      !/RAISE\s+EXCEPTION/i.test(rowCountBlock[0]),
      'must not RAISE EXCEPTION on row count mismatch',
    );
  });

  it('does not contain assert.ok(true) formal assertions', () => {
    const lines = newMigrationSrc.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed.startsWith('*')) continue;
      if (/^assert\.ok\(\s*true\s*\)\s*;?\s*$/.test(trimmed)) {
        assert.fail('must not contain formal assert.ok(true) test');
      }
    }
  });
});
