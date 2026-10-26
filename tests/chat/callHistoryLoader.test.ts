import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCallHistory, callHistoryLoadError } from '../../src/components/Chat/callHistoryLoader';

const call = { id: 'call-1', caller_id: 'me', callee_id: 'other', created_at: '2026-10-26T12:00:00Z', duration_seconds: 30 };
function client(rpcResult: any, legacyResult: any = { data: [call], error: null }) {
  const filters: unknown[] = [];
  const query: any = { then: (resolve: any) => Promise.resolve(legacyResult).then(resolve) };
  for (const key of ['select', 'or', 'in', 'order', 'limit']) query[key] = (...args: unknown[]) => { filters.push([key, ...args]); return query; };
  let reads = 0;
  return { api: { rpc: async () => rpcResult, from: (table: string) => { assert.equal(table, 'call_sessions'); reads++; return query; } }, filters, reads: () => reads };
}

test('a database without the new RPC still displays its existing call records', async () => {
  const c = client({ data: null, error: { code: 'PGRST202', message: 'function not found in schema cache' } });
  const result = await loadCallHistory(c.api, 'me');
  assert.deepEqual(result.data, [call]); assert.equal(result.error, null); assert.equal(result.canClear, false);
  assert.deepEqual(c.filters, [['select','*'], ['or','caller_id.eq.me,callee_id.eq.me'], ['in','status',['ended','declined','missed']], ['order','created_at',{ascending:false}], ['limit',100]]);
});

test('a migrated database uses the personal history RPC including intentionally empty history', async () => {
  for (const data of [[call], []]) {
    const c = client({ data, error: null });
    const result = await loadCallHistory(c.api, 'me');
    assert.deepEqual(result.data, data); assert.equal(result.canClear, true); assert.equal(c.reads(), 0);
  }
});

test('permission, network and internal SQL errors never fall back to unfiltered history', async () => {
  for (const code of ['42501', 'PGRST301', '42883', '500', '']) {
    const c = client({ data: null, error: { code, message: 'failed' } });
    const result = await loadCallHistory(c.api, 'me');
    assert.equal(result.canClear, false); assert.equal(c.reads(), 0); assert.equal(result.error?.code, code);
  }
});

test('a failing legacy read remains an error rather than an empty successful history', async () => {
  const c = client({ data: null, error: { code:'PGRST202' } }, {data:null,error:{code:'42501'}});
  const result = await loadCallHistory(c.api, 'me');
  assert.equal(result.data, null); assert.equal(result.error?.code, '42501');
  assert.match(callHistoryLoadError(result.error), /42501/);
});
