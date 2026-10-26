import assert from 'node:assert/strict';
import test from 'node:test';
import { readSessionHeartbeatError, sessionHeartbeatRetrySeconds } from '../../src/features/auth/hooks/sessionHeartbeatErrors';

test('reads fatal session error from a non-2xx response without consuming it', async () => {
  const response = new Response(JSON.stringify({ error: 'SESSION_IDLE_EXPIRED' }), { status: 401 });
  assert.equal(await readSessionHeartbeatError(null, { context: response }), 'SESSION_IDLE_EXPIRED');
  assert.equal((await response.json()).error, 'SESSION_IDLE_EXPIRED');
});
test('preserves directly returned errors and tolerates non-JSON network failures', async () => {
  assert.equal(await readSessionHeartbeatError({ error: 'SESSION_REVOKED' }, null), 'SESSION_REVOKED');
  assert.equal(await readSessionHeartbeatError(null, { context: new Response('bad gateway') }), null);
  assert.equal(await readSessionHeartbeatError(null, null), null);
});
test('transient error retries back off and never exceed five minutes', () => {
  assert.deepEqual([0,1,2,3,4,100].map(sessionHeartbeatRetrySeconds), [60,120,240,300,300,300]);
});
