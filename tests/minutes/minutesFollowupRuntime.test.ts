import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const enabled = process.env.SPARK_DATABASE_TESTS === '1';
test('Database: minutes mutations, session gates and conversation lookup', {
  skip: enabled ? false : 'Set SPARK_DATABASE_TESTS=1 and PGDATABASE or PGSERVICE to run the real SQL suite',
}, () => {
  assert.ok(process.env.PGDATABASE || process.env.PGSERVICE, 'An explicit test database target is required');
  const sqlPath = fileURLToPath(new URL('../database/minutesFollowupRuntime.sql', import.meta.url));
  const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlPath], {
    encoding: 'utf8',
    timeout: 120_000,
    env: process.env,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
