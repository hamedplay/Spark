import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

async function load(name: string, context: Record<string, unknown>) {
  const source = readFileSync(`supabase/functions/_shared/${name}.ts`, 'utf8').replace(/^import .*;\n/gm, '');
  const { code } = await transform(source, { loader: 'ts', format: 'cjs', target: 'es2022' });
  const module = { exports: {} as Record<string, (...args: any[]) => Promise<any>> };
  vm.runInNewContext(code, { module, exports: module.exports, URL, Request, AbortSignal,
    Deno: { env: { get: () => 'test-only' } }, console, ...context });
  return module.exports;
}

test('server writer accepts only verified actor argument and excludes URL secrets/body', async () => {
  const calls: unknown[] = [];
  const api = await load('accessDenialAudit', { createClient: () => ({ rpc: (name: string, payload: unknown) => {
    calls.push({ name, payload }); return { abortSignal: async () => ({ error: null }) };
  } }) });
  const req = new Request('https://example.test/functions/v1/admin-users/create?token=secret', {
    method: 'POST', headers: { Authorization: 'Bearer not-a-real-token' }, body: '{"password":"secret"}',
  });
  await api.recordAccessDenial(req, null, 'ADMIN_REQUIRED');
  assert.equal(calls.length, 0);
  await api.recordAccessDenial(req, 'verified-actor', 'ADMIN_REQUIRED');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name: 'record_access_denial_service_v1', payload: {
    p_actor: 'verified-actor', p_resource: 'admin-users', p_code: 'ADMIN_REQUIRED',
  } }]);
});

test('audit writer failure never grants access or throws into authorization', async () => {
  let failures = 0;
  const api = await load('accessDenialAudit', { createClient: () => { throw new Error('unavailable'); }, console: { error: () => failures++ } });
  await api.recordAccessDenial(new Request('https://example.test/admin-users'), 'verified-actor', 'ADMIN_REQUIRED');
  assert.equal(failures, 1);
});

test('restricted session audit uses verified Auth identity, never state payload identity', async () => {
  const calls: unknown[][] = [];
  const api = await load('requireFullAuthAccess', {
    createClient: () => ({ rpc: async () => ({ data: { access_level: 'MFA_REQUIRED', user_id: 'untrusted-state-id' } }),
      auth: { getUser: async () => ({ data: { user: { id: 'verified-auth-id' } } }) } }),
    recordAccessDenial: async (...args: unknown[]) => calls.push(args),
  });
  const result = await api.requireFullAuthAccess(new Request('https://example.test/admin-users', { headers: { Authorization: 'Bearer test' } }));
  assert.equal(result.ok, false);
  assert.equal(result.userClient, null);
  assert.equal(calls[0][1], 'verified-auth-id');
});

test('missing credentials never create a false actor attribution', async () => {
  let writes = 0;
  const api = await load('requireFullAuthAccess', {
    createClient: () => { throw new Error('must not initialize'); }, recordAccessDenial: async () => { writes++; },
  });
  assert.equal((await api.requireFullAuthAccess(new Request('https://example.test/admin-users'))).ok, false);
  assert.equal(writes, 0);
});
