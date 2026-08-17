import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir);

const targetMigration = migrationFiles.find((f) =>
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

describe('Phase 5E-C5A — Add phone_otp Gateway Login Method', () => {
  it('migration file exists on disk', () => {
    assert.ok(targetMigration, 'phase5e_add_phone_otp_gateway_login_method migration must exist');
  });

  it('drops only the specific constraint', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/DROP\s+CONSTRAINT\s+password_gateway_session_authorizations_login_method_check/i.test(sql),
      'must drop the specific constraint');
    const dropCount = (sql.match(/DROP\s+CONSTRAINT/gi) || []).length;
    assert.equal(dropCount, 1, 'must drop exactly one constraint');
  });

  it('recreates constraint with the same name', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/ADD\s+CONSTRAINT\s+password_gateway_session_authorizations_login_method_check/i.test(sql),
      'must add constraint with same name');
  });

  it('contains exactly five allowed login methods', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/'username'/i.test(sql), 'must include username');
    assert.ok(/'email'/i.test(sql), 'must include email');
    assert.ok(/'phone'/i.test(sql), 'must include phone');
    assert.ok(/'public_registration'/i.test(sql), 'must include public_registration');
    assert.ok(/'phone_otp'/i.test(sql), 'must include phone_otp');
  });

  it('does not allow other values', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    const checkMatch = sql.match(/CHECK\s*\(([^)]+)\)/i);
    assert.ok(checkMatch, 'must have CHECK constraint');
    const checkBody = checkMatch![1];
    const allowedValues = checkBody.match(/'[^']+'/g) || [];
    assert.equal(allowedValues.length, 5, 'must have exactly 5 allowed values');
    assert.deepEqual(
      allowedValues.sort(),
      ["'email'", "'phone'", "'phone_otp'", "'public_registration'", "'username'"].sort(),
      'allowed values must be exactly the five expected ones',
    );
  });

  it('fails fast if constraint does not exist', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(/password_gateway_session_authorizations_login_method_check.*not found/i.test(sql) ||
      /NOT EXISTS.*password_gateway_session_authorizations_login_method_check/i.test(sql),
      'must check for constraint existence before proceeding');
  });

  it('does not modify any function or RPC', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/CREATE\s+FUNCTION/i.test(sql), 'must not create functions');
    assert.ok(!/DROP\s+FUNCTION/i.test(sql), 'must not drop functions');
    assert.ok(!/ALTER\s+FUNCTION/i.test(sql), 'must not alter functions');
    assert.ok(!/CREATE\s+OR\s+REPLACE\s+FUNCTION/i.test(sql), 'must not replace functions');
  });

  it('does not create or modify columns, indexes, FKs, triggers, or policies', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/ADD\s+COLUMN/i.test(sql), 'must not add columns');
    assert.ok(!/DROP\s+COLUMN/i.test(sql), 'must not drop columns');
    assert.ok(!/ALTER\s+COLUMN/i.test(sql), 'must not alter columns');
    assert.ok(!/CREATE\s+INDEX/i.test(sql), 'must not create indexes');
    assert.ok(!/DROP\s+INDEX/i.test(sql), 'must not drop indexes');
    assert.ok(!/ADD\s+FOREIGN\s+KEY/i.test(sql), 'must not add foreign keys');
    assert.ok(!/DROP\s+CONSTRAINT.*fkey/i.test(sql), 'must not drop foreign keys');
    assert.ok(!/CREATE\s+TRIGGER/i.test(sql), 'must not create triggers');
    assert.ok(!/CREATE\s+POLICY/i.test(sql), 'must not create policies');
    assert.ok(!/DROP\s+POLICY/i.test(sql), 'must not drop policies');
  });

  it('has no DML statements', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/INSERT\s+INTO/i.test(sql), 'must not contain INSERT');
    assert.ok(!/UPDATE\s+\w+\s+SET/i.test(sql), 'must not contain UPDATE');
    assert.ok(!/DELETE\s+FROM/i.test(sql), 'must not contain DELETE');
    assert.ok(!/TRUNCATE/i.test(sql), 'must not contain TRUNCATE');
  });

  it('has no CASCADE', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/CASCADE/i.test(sql), 'must not contain CASCADE');
  });

  it('does not drop tables or functions', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/DROP\s+TABLE/i.test(sql), 'must not drop tables');
    assert.ok(!/DROP\s+FUNCTION/i.test(sql), 'must not drop functions');
  });

  it('does not modify RLS or ACL', () => {
    assert.ok(targetMigration);
    const sql = readFileSync(join(migrationsDir, targetMigration!), 'utf8');
    assert.ok(!/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'must not enable RLS');
    assert.ok(!/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i.test(sql), 'must not disable RLS');
    assert.ok(!/GRANT/i.test(sql), 'must not grant');
    assert.ok(!/REVOKE/i.test(sql), 'must not revoke');
  });

  it('previous migrations are not modified', () => {
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
    const testFile = readFileSync(join(root, 'tests', 'phase5', 'phase5PhoneOtpGatewayMethod.test.ts'), 'utf8');
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
