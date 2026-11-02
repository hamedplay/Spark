import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function run(args, inventory = 'dbid supabase/postgres:17 supabase-db db', status = '0') {
  const temp = mkdtempSync(join(tmpdir(), 'spark-event-deploy-'));
  try {
    const docker = join(temp, 'docker');
    writeFileSync(docker, `#!/usr/bin/env bash
if [[ "$1" == ps ]]; then printf '%s\\n' "$TEST_INVENTORY"; exit 0; fi
printf '%s\\n' "$@" > "$TEST_DIR/args"
cat > "$TEST_DIR/input"
exit "$TEST_STATUS"
`);
    chmodSync(docker, 0o700);
    const result = spawnSync('bash', ['deploy/spark-cli/apply-event-center-db.sh', ...args], {
      encoding: 'utf8', env: { ...process.env, PATH: `${temp}:${process.env.PATH}`, TEST_DIR: temp, TEST_INVENTORY: inventory, TEST_STATUS: status },
    });
    const read = name => { try { return readFileSync(join(temp, name), 'utf8'); } catch { return ''; } };
    return { ...result, sql: read('input'), args: read('args') };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
test('default check is read-only and discovers exactly one Supabase DB', () => {
  const result = run([]);
  assert.equal(result.status, 0);
  assert.match(result.args, /dbid\npsql/);
  assert.match(result.sql, /rpc_present/);
  assert.doesNotMatch(result.sql, /notify|insert into|create or replace/i);
});
test('apply upgrades an existing RPC with only the new migration in one locked transaction with history/cache reload', () => {
  const result = run(['--apply', 'explicit-db']);
  assert.equal(result.status, 0);
  assert.ok(result.sql.includes(readFileSync('supabase/migrations/20261102042055_event_center_authentication_logs.sql', 'utf8')));
  assert.match(result.sql, /^begin;/);
  assert.match(result.sql, /pg_advisory_xact_lock/);
  assert.match(result.sql, /\\if :migration_applied/);
  assert.match(result.sql, /EVENT_CENTER_BASE_REQUIRED/);
  assert.match(result.sql, /notify pgrst, 'reload schema';\ncommit;/);
  assert.match(result.args, /ON_ERROR_STOP=1/);
});
test('ambiguous databases and invalid arguments fail before any SQL', () => {
  assert.equal(run(['--apply'], 'a supabase/postgres:17 db-a db\nb supabase/postgres:17 db-b db').status, 1);
  assert.equal(run(['--apply', '--unsafe']).status, 2);
  assert.equal(run(['--unknown']).status, 2);
});
test('database failure propagates without a success message', () => {
  const result = run(['--apply', 'db'], '', '1');
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stdout, /database ready/);
});

test('canonical database name is detected even when Docker reports an image ID', () => {
  const result = run(['--check'], 'dbid f371b5f3f2ac supabase-db db');
  assert.equal(result.status, 0);
  assert.match(result.args, /dbid\npsql/);
  assert.match(result.sql, /auth_source_present/);
});
test('upgrade does not depend on the removed base-migration file or invent its history', () => {
  const result = run(['--apply', 'supabase-db']);
  assert.equal(result.status, 0);
  assert.doesNotMatch(result.sql, /20261101182857|EVENT_CENTER_HISTORY_DRIFT|create trigger/i);
  assert.match(result.sql, /20261102042055/);
});
