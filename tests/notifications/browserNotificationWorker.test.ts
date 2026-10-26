import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../../public/pwa-notifications-sw.js', import.meta.url), 'utf8');
function harness(cache = new Map<string, Response>(), visible = true, failFirst = false) {
  const handlers = new Map<string, Function>();
  const shown: any[] = [], sounds: any[] = [], navigations: string[] = [];
  let attempts = 0;
  const client = { visibilityState: visible ? 'visible' : 'hidden', focused: true, postMessage: (v: any) => sounds.push(v), navigate: async (url: string) => navigations.push(url), focus: async () => {} };
  const self = { location: { origin: 'https://spark.test' }, registration: { async showNotification(title: string, options: any) { if (failFirst && attempts++ === 0) throw Error('temporary error'); shown.push({ title, ...options }); } }, clients: { matchAll: async () => [client, { ...client, focused: false }], openWindow: async () => {} }, addEventListener: (name: string, handler: Function) => handlers.set(name, handler) };
  vm.runInNewContext(source, { self, URL, Response, caches: { open: async () => ({ match: async (key: string) => cache.get(key), put: async (key: string, value: Response) => cache.set(key, value), keys: async () => [...cache.keys()], delete: async (key: string) => cache.delete(key) }) } });
  const dispatch = (type: string, payload: any) => new Promise<void>((resolve, reject) => {
    const event = type === 'push' ? { data: { json: () => payload } } : type === 'message' ? { data: { type: 'SPARK_REALTIME_NOTIFICATION', payload } } : { notification: { data: payload, close() {} } };
    handlers.get(type)!({ ...event, waitUntil: (promise: Promise<void>) => promise.then(resolve, reject) });
  });
  return { dispatch, shown, sounds, cache, navigations };
}
test('parallel Realtime/Push duplicates alert once, persist across worker restarts and sound in one visible tab', async () => {
  const h = harness(); const payload = { notificationId: 'one', actionUrl: '/?page=minutes-detail' };
  await Promise.all([h.dispatch('push', payload), h.dispatch('message', payload)]);
  assert.equal(h.shown.length, 1); assert.equal(h.sounds.length, 1); assert.equal(h.shown[0].silent, true);
  const restarted = harness(h.cache); await restarted.dispatch('push', payload); assert.equal(restarted.shown.length, 0);
});
test('background notifications leave sound to OS and reject off-origin click destinations', async () => {
  const h = harness(undefined, false);
  await h.dispatch('push', { notificationId: 'background', actionUrl: 'https://outside.test' });
  assert.equal(h.shown[0].silent, false); assert.equal(h.sounds.length, 0);
  await h.dispatch('notificationclick', { actionUrl: 'https://outside.test' });
  assert.equal(h.navigations[0], 'https://spark.test/');
});
test('failed notification display can retry and the serialized queue continues', async () => {
  const h = harness(undefined, true, true); const payload = { notificationId: 'retry' };
  await assert.rejects(h.dispatch('push', payload)); await h.dispatch('message', payload);
  assert.equal(h.shown.length, 1); assert.equal(h.sounds.length, 1);
});
test('deduplication storage stays bounded', async () => {
  const h = harness();
  for (let i = 0; i < 260; i++) await h.dispatch('push', { notificationId: String(i) });
  assert.equal(h.cache.size, 256);
});
