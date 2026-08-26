import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const phase5eMigration = migrationFiles.find((f) =>
  f.includes('phase5e_phone_otp_configuration'),
);

const phase5dResolverMigration = migrationFiles.find((f) =>
  f.includes('phase5d_phone_password_login_resolver') && !f.includes('fix'),
);

const phase5dFixMigration = migrationFiles.find((f) =>
  f.includes('phase5d_fix_phone_resolver_profile_user_id'),
);

describe('Phase 5E-A — Phone OTP Login Configuration and Safety Gate', () => {
  it('phase5e migration file exists on disk', () => {
    assert.ok(phase5eMigration, 'phase5e_phone_otp_configuration migration must exist');
  });

  it('creates phone_otp_login_backend_ready config with value false', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_backend_ready'), 'must reference phone_otp_login_backend_ready');
    assert.ok(sql.includes("'false'"), 'must set backend_ready to false');
    assert.ok(sql.includes('boolean'), 'must set value_type to boolean');
  });

  it('creates phone_otp_login_ttl_seconds config with value 120', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_ttl_seconds'), 'must reference phone_otp_login_ttl_seconds');
    assert.ok(sql.includes("'120'"), 'must set TTL to 120');
    assert.ok(sql.includes("'number'"), 'must set value_type to number');
  });

  it('creates phone_otp_login_resend_seconds config with value 60', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_resend_seconds'), 'must reference phone_otp_login_resend_seconds');
    assert.ok(sql.includes("'60'"), 'must set resend to 60');
  });

  it('creates phone_otp_login_max_attempts config with value 5', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('phone_otp_login_max_attempts'), 'must reference phone_otp_login_max_attempts');
    assert.ok(sql.includes("'5'"), 'must set max_attempts to 5');
  });

  it('does not modify old phone_login_otp_ttl_seconds key', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(!sql.includes('phone_login_otp_ttl_seconds'), 'must not reference old TTL key');
  });

  it('checks for existing config before inserting and raises on mismatch', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('RAISE EXCEPTION'), 'must raise exception on existing mismatch');
    assert.ok(/IF v_existing IS NOT NULL THEN/.test(sql), 'must check existing before insert');
  });

  it('creates or validates login_otp SMS template', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("event_type = 'login_otp'"), 'must target login_otp event');
    assert.ok(sql.includes("category = 'auth'"), 'must target auth category');
    assert.ok(sql.includes("audience = 'all'"), 'must target all audience');
  });

  it('login_otp template body must contain {{otp}}', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('{{otp}}'), 'must contain {{otp}} placeholder');
    assert.ok(sql.includes("NOT LIKE '%{{otp}}%'"), 'must validate body contains {{otp}}');
  });

  it('login_otp template must be active', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('is_active'), 'must check is_active');
    assert.ok(sql.includes('IS NOT TRUE'), 'must validate template is active');
  });

  it('does not modify registration_phone_otp template', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.doesNotMatch(
      sql,
      /(?:UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+public\.notification_templates[\s\S]{0,500}registration_phone_otp/i,
      'must not mutate the registration_phone_otp template',
    );
  });

  it('get_public_auth_config gates phone_login_ready on backend_ready', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('v_otp_login_backend_ready'), 'must read backend_ready');
    assert.ok(sql.includes('v_otp_login_gate'), 'must compute otp_login_gate');
    assert.ok(sql.includes('v_otp_login_gate'), 'phone_login_ready must depend on otp_login_gate');
  });

  it('get_public_auth_config gates phone_login_canonical_ready on backend_ready', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    const canonicalReadyIdx = sql.indexOf('phone_login_canonical_ready');
    assert.ok(canonicalReadyIdx > -1, 'must have phone_login_canonical_ready in RETURN');
    assert.ok(sql.includes('v_otp_login_gate'), 'canonical_ready must depend on otp_login_gate');
  });

  it('get_public_auth_config validates TTL between 60 and 300', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('v_otp_login_ttl_valid'), 'must compute ttl_valid');
    assert.ok(sql.includes('>= 60') && sql.includes('<= 300'), 'must validate TTL range 60-300');
  });

  it('get_public_auth_config validates resend between 30 and 300', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('v_otp_login_resend_valid'), 'must compute resend_valid');
    assert.ok(sql.includes('>= 30') && sql.includes('<= 300'), 'must validate resend range 30-300');
  });

  it('get_public_auth_config validates max_attempts between 3 and 10', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('v_otp_login_max_attempts_valid'), 'must compute max_attempts_valid');
    assert.ok(sql.includes('>= 3') && sql.includes('<= 10'), 'must validate max_attempts range 3-10');
  });

  it('get_public_auth_config preserves SECURITY DEFINER and OWNER postgres', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(/SECURITY\s+DEFINER/i.test(sql), 'must be SECURITY DEFINER');
    assert.ok(/ALTER\s+FUNCTION\s+public\.get_public_auth_config\(\)\s+OWNER\s+TO\s+postgres/i.test(sql),
      'must set owner to postgres');
  });

  it('get_public_auth_config does not change signature', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes('RETURNS TABLE('), 'must use RETURNS TABLE');
    assert.ok(sql.includes('phone_login_ready boolean'), 'must keep phone_login_ready column');
    assert.ok(sql.includes('phone_login_canonical_ready boolean'), 'must keep phone_login_canonical_ready column');
    assert.ok(sql.includes('registration_otp_ttl_seconds integer'), 'must keep registration columns');
  });

  it('get_phone_auth_admin_status adds login_backend_ready field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_backend_ready'"), 'must add login_backend_ready to JSON output');
  });

  it('get_phone_auth_admin_status adds login_ttl_seconds field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_ttl_seconds'"), 'must add login_ttl_seconds to JSON output');
  });

  it('get_phone_auth_admin_status adds login_ttl_valid field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_ttl_valid'"), 'must add login_ttl_valid to JSON output');
  });

  it('get_phone_auth_admin_status adds login_resend_seconds field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_resend_seconds'"), 'must add login_resend_seconds to JSON output');
  });

  it('get_phone_auth_admin_status adds login_resend_valid field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_resend_valid'"), 'must add login_resend_valid to JSON output');
  });

  it('get_phone_auth_admin_status adds login_max_attempts field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_max_attempts'"), 'must add login_max_attempts to JSON output');
  });

  it('get_phone_auth_admin_status adds login_max_attempts_valid field', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(sql.includes("'login_max_attempts_valid'"), 'must add login_max_attempts_valid to JSON output');
  });

  it('get_phone_auth_admin_status gates phone_login_canonical_ready on login_backend_ready', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    const canonicalReadyIdx = sql.indexOf("'phone_login_canonical_ready'");
    assert.ok(canonicalReadyIdx > -1, 'must have phone_login_canonical_ready in JSON');
    const backendReadyRef = sql.indexOf('v_otp_login_backend_ready', canonicalReadyIdx);
    assert.ok(backendReadyRef > -1, 'canonical_ready must reference v_otp_login_backend_ready');
  });

  it('get_phone_auth_admin_status preserves SECURITY DEFINER and OWNER postgres', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    const adminFnIdx = sql.indexOf('get_phone_auth_admin_status');
    const fnDef = sql.substring(adminFnIdx);
    assert.ok(/SECURITY\s+DEFINER/i.test(fnDef), 'must be SECURITY DEFINER');
    assert.ok(/ALTER\s+FUNCTION\s+public\.get_phone_auth_admin_status\(\)\s+OWNER\s+TO\s+postgres/i.test(fnDef),
      'must set owner to postgres');
  });

  it('get_phone_auth_admin_status does not change return type', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.match(
      sql,
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_phone_auth_admin_status\(\)\s*\nRETURNS\s+jsonb/i,
      'must still return jsonb',
    );
  });

  it('migration does not create new tables', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(!/CREATE\s+TABLE/i.test(sql), 'must not create new tables');
  });

  it('migration does not create challenge or login RPCs', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(!sql.includes('create_phone_login_challenge'), 'must not create challenge RPC');
    assert.ok(!sql.includes('verify_phone_login_otp'), 'must not create login verify RPC');
    assert.ok(!sql.includes('request_phone_login_otp'), 'must not create login request RPC');
  });

  it('migration does not DELETE or DROP any rows or tables', () => {
    assert.ok(phase5eMigration);
    const sql = readFileSync(join(migrationsDir, phase5eMigration!), 'utf8');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE FROM');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not contain DROP TABLE');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
  });

  it('previous phase5d resolver migration is not modified', () => {
    assert.ok(phase5dResolverMigration, 'phase5d resolver migration must still exist');
    const sql = readFileSync(join(migrationsDir, phase5dResolverMigration!), 'utf8');
    assert.ok(sql.includes('resolve_phone_password_login_v1'), 'original migration must be intact');
  });

  it('previous phase5d fix migration is not modified', () => {
    assert.ok(phase5dFixMigration, 'phase5d fix migration must still exist');
    const sql = readFileSync(join(migrationsDir, phase5dFixMigration!), 'utf8');
    assert.ok(sql.includes('p.user_id'), 'fix migration must still contain p.user_id');
  });

  it('no formal or comment-only tests exist in this file', () => {
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpConfig.test.ts'), 'utf8');
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
