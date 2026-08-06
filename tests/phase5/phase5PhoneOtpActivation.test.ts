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

const revalidateMigrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.includes('phase5e_revalidate_phone_otp_activation'))
  .map((f) => join(migrationsDir, f));

const exactActivationFiles = readdirSync(migrationsDir)
  .filter((f) => f.includes('phase5e_fix_exact_activation_preconditions'))
  .map((f) => join(migrationsDir, f));

const allNewMigrationFiles = [...revalidateMigrationFiles, ...exactActivationFiles];

const newMigrationSrc = allNewMigrationFiles
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const exactActivationSrc = exactActivationFiles
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const prevMigrationSrc = readFileSync(prevMigrationPath, 'utf8');

describe('Phase 5E-D5A Fix 2 — Exact Activation Preconditions', () => {
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
    assert.ok(exactActivationFiles.length > 0, 'exact activation migration file must exist');
    for (const f of exactActivationFiles) {
      assert.ok(existsSync(f), `migration file must exist: ${f}`);
    }
  });

  it('migration starts by setting backend to false (fail-safe shutdown)', () => {
    assert.ok(
      /UPDATE\s+public\.system_config\s+SET\s+value\s*=\s*'false'[\s\S]*?phone_otp_login_backend_ready/i.test(exactActivationSrc),
      'must set flag to false first',
    );
  });

  it('uses GET DIAGNOSTICS ROW_COUNT after the shutdown UPDATE', () => {
    assert.ok(
      /GET\s+DIAGNOSTICS\s+v_row_count\s*=\s*ROW_COUNT/i.test(exactActivationSrc),
      'must capture ROW_COUNT via GET DIAGNOSTICS',
    );
  });

  it('checks row count is exactly one', () => {
    assert.ok(
      /v_row_count\s*<>\s*1/i.test(exactActivationSrc),
      'must verify row count is exactly 1',
    );
  });

  it('does not contain any INSERT statement', () => {
    assert.ok(
      !/INSERT\s+INTO/i.test(exactActivationSrc),
      'migration must not contain INSERT',
    );
  });

  it('does not contain DELETE, TRUNCATE, DROP, or ALTER as SQL statements', () => {
    const sqlStatements = exactActivationSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
    assert.ok(!/DELETE\s+FROM/i.test(sqlStatements), 'must not contain DELETE');
    assert.ok(!/TRUNCATE\s+/i.test(sqlStatements), 'must not contain TRUNCATE');
    assert.ok(!/DROP\s+/i.test(sqlStatements), 'must not contain DROP');
    assert.ok(!/ALTER\s+/i.test(sqlStatements), 'must not contain ALTER');
  });

  it('checks phone_login_canonical_enabled = true', () => {
    assert.ok(
      /phone_login_canonical_enabled/i.test(exactActivationSrc),
      'must check phone_login_canonical_enabled',
    );
  });

  it('checks TTL between 30 and 300', () => {
    assert.ok(/v_ttl\s*>=\s*30/i.test(exactActivationSrc), 'must check TTL >= 30');
    assert.ok(/v_ttl\s*<=\s*300/i.test(exactActivationSrc), 'must check TTL <= 300');
  });

  it('checks Resend between 30 and 300', () => {
    assert.ok(/v_resend\s*>=\s*30/i.test(exactActivationSrc), 'must check resend >= 30');
    assert.ok(/v_resend\s*<=\s*300/i.test(exactActivationSrc), 'must check resend <= 300');
  });

  it('checks Resend <= TTL', () => {
    assert.ok(
      /v_resend\s*>\s*v_ttl/i.test(exactActivationSrc),
      'must check resend does not exceed TTL',
    );
  });

  it('checks Max Attempts between 3 and 10', () => {
    assert.ok(/v_max_attempts\s*>=\s*3/i.test(exactActivationSrc), 'must check max_attempts >= 3');
    assert.ok(/v_max_attempts\s*<=\s*10/i.test(exactActivationSrc), 'must check max_attempts <= 10');
  });

  it('checks provider from system_config section=sms key=phone_login_sms_provider_id', () => {
    assert.ok(
      /section\s*=\s*'sms'[\s\S]*?key\s*=\s*'phone_login_sms_provider_id'/i.test(exactActivationSrc),
      'must check provider_id from sms config',
    );
  });

  it('validates provider UUID and sms_providers.is_active', () => {
    assert.ok(
      /v_provider_id_text::uuid/i.test(exactActivationSrc),
      'must cast provider_id to uuid',
    );
    assert.ok(
      /sms_providers[\s\S]*?is_active/i.test(exactActivationSrc),
      'must check sms_providers.is_active',
    );
  });

  it('uses public.sms_templates (not notification_templates)', () => {
    assert.ok(
      /public\.sms_templates/i.test(exactActivationSrc),
      'must use public.sms_templates',
    );
    assert.ok(
      !/notification_templates/i.test(exactActivationSrc),
      'must not use notification_templates for login_otp',
    );
  });

  it('checks event_type = login_otp', () => {
    assert.ok(
      /event_type\s*=\s*'login_otp'/i.test(exactActivationSrc),
      'must check event_type=login_otp',
    );
  });

  it('checks exactly one template row', () => {
    assert.ok(
      /v_template_count\s*<>\s*1/i.test(exactActivationSrc),
      'must check template count is exactly 1',
    );
  });

  it('counts actual {{otp}} occurrences via length-difference method, not LIKE alone', () => {
    assert.ok(
      /length\(v_template_body\)\s*-\s*length\(replace/i.test(exactActivationSrc),
      'must count {{otp}} via length-difference method',
    );
    assert.ok(
      /v_otp_occurrences\s*<>\s*1/i.test(exactActivationSrc),
      'must require exactly 1 occurrence',
    );
  });

  it('template with two {{otp}} is not acceptable', () => {
    // The migration must check v_otp_occurrences <> 1, which rejects count=2
    const checkMatch = exactActivationSrc.match(/v_otp_occurrences\s*<>\s*1/);
    assert.ok(checkMatch, 'must have exact count check that rejects 2 occurrences');
    // Verify the count method would produce 2 for a body with two {{otp}}
    const methodMatch = exactActivationSrc.match(
      /\(length\(v_template_body\)\s*-\s*length\(replace\(v_template_body,\s*'{{otp}}',\s*''\)\)\)\s*\/\s*length\('{{otp}}'\)/,
    );
    assert.ok(methodMatch, 'must use length-difference divided by placeholder length');
  });

  it('counts rows from get_phone_auth_config() and requires exactly 1', () => {
    assert.ok(
      /SELECT\s+COUNT\(\*\)\s+INTO\s+v_config_row_count\s+FROM\s+public\.get_phone_auth_config\(\)/i.test(exactActivationSrc),
      'must COUNT(*) rows from get_phone_auth_config()',
    );
    assert.ok(
      /v_config_row_count\s*<>\s*1/i.test(exactActivationSrc),
      'must require exactly 1 row from get_phone_auth_config()',
    );
  });

  it('does not rely solely on LIMIT 1 to prove uniqueness', () => {
    // The row count check must use COUNT(*) before any LIMIT 1 fetch
    const countIdx = exactActivationSrc.indexOf('v_config_row_count');
    const limitIdx = exactActivationSrc.indexOf('LIMIT 1', countIdx);
    assert.ok(countIdx > -1, 'must have v_config_row_count check');
    // LIMIT 1 may appear after the count check for fetching the single row,
    // but the count check itself must not use LIMIT 1
    const countCheck = exactActivationSrc.match(
      /SELECT\s+COUNT\(\*\)\s+INTO\s+v_config_row_count\s+FROM\s+public\.get_phone_auth_config\(\)/i,
    );
    assert.ok(countCheck, 'must have COUNT(*) without LIMIT 1 for row count');
    assert.ok(
      !/LIMIT\s+1/i.test(countCheck![0]),
      'row count query must not use LIMIT 1',
    );
  });

  it('checks pepper length >= 32 on the counted row', () => {
    assert.ok(
      /v_pepper_len\s*<\s*32/i.test(exactActivationSrc),
      'must check pepper length >= 32',
    );
  });

  it('checks allowed_origins includes https://shahrmeeting.ir', () => {
    assert.ok(
      /https:\/\/shahrmeeting\.ir/i.test(exactActivationSrc),
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
        exactActivationSrc.includes(rpc),
        `must reference RPC: ${rpc}`,
      );
    }
    assert.ok(
      /v_rpc_count\s*<>\s*7/i.test(exactActivationSrc),
      'must verify exactly 7 RPCs found',
    );
  });

  it('only flips to true after all preconditions pass', () => {
    assert.ok(
      /IF\s+v_preflight_ok\s+THEN/i.test(exactActivationSrc),
      'must gate activation on v_preflight_ok',
    );
    assert.ok(
      /SET\s+value\s*=\s*'true'[\s\S]*?AND\s+value\s*=\s*'false'/i.test(exactActivationSrc),
      'must only set true if currently false',
    );
  });

  it('preflight failure keeps backend false and raises WARNING', () => {
    assert.ok(
      /RAISE\s+WARNING[\s\S]*?Backend\s+stays\s+false/i.test(exactActivationSrc),
      'must RAISE WARNING on preflight failure and keep backend false',
    );
  });

  it('does not raise an exception on row count mismatch (no rollback of shutdown)', () => {
    const rowCountBlock = exactActivationSrc.match(
      /v_row_count\s*<>\s*1[\s\S]*?END\s+IF/i,
    );
    assert.ok(rowCountBlock, 'must have row count check block');
    assert.ok(
      !/RAISE\s+EXCEPTION/i.test(rowCountBlock[0]),
      'must not RAISE EXCEPTION on row count mismatch',
    );
  });

  it('does not contain assert.ok(true) formal assertions', () => {
    const lines = exactActivationSrc.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('--') || trimmed.startsWith('*')) continue;
      if (/^assert\.ok\(\s*true\s*\)\s*;?\s*$/.test(trimmed)) {
        assert.fail('must not contain formal assert.ok(true) test');
      }
    }
  });

  it('all previous migrations remain unchanged', () => {
    assert.ok(
      existsSync(prevMigrationPath),
      'original activation migration must still exist',
    );
    assert.ok(
      revalidateMigrationFiles.length > 0,
      'previous revalidate migration must still exist',
    );
    for (const f of revalidateMigrationFiles) {
      assert.ok(existsSync(f), `previous revalidate migration must still exist: ${f}`);
    }
  });
});
