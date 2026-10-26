import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChatRealtimeSync } from '../../src/components/Chat/chatRealtimeSync';

function environment() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 0;
  const env = { window: win, document: doc,
    setInterval(fn: () => void, ms: number) { timers.set(++next, { fn, ms }); return next; },
    clearInterval(id: number) { timers.delete(id); },
  } as any;
  return { env, win, doc, timers };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('reconnect, focus, online and visible-tab resume reconcile data without page reload', async () => {
  const e = environment(); let calls = 0;
  const sync = createChatRealtimeSync(async () => { calls++; }, e.env);
  sync.onStatus('SUBSCRIBED'); await tick(); assert.equal(calls, 1);
  sync.onStatus('SUBSCRIBED'); await tick(); assert.equal(calls, 2);
  for (const name of ['focus', 'online']) { e.win.dispatchEvent(new Event(name)); await tick(); }
  assert.equal(calls, 4);
  e.doc.visibilityState = 'hidden';
  e.doc.dispatchEvent(new Event('visibilitychange'));
  [...e.timers.values()][0].fn(); await tick(); assert.equal(calls, 4);
  e.doc.visibilityState = 'visible'; e.doc.dispatchEvent(new Event('visibilitychange'));
  await tick(); assert.equal(calls, 5);
  sync.dispose(); assert.equal(e.timers.size, 0);
  e.win.dispatchEvent(new Event('focus')); await sync.request(); assert.equal(calls, 5);
});

test('dropped-event safety refresh and faster fallback recover from socket failures', async () => {
  const e = environment(); let calls = 0;
  const sync = createChatRealtimeSync(async () => { calls++; }, e.env);
  assert.equal([...e.timers.values()][0].ms, 60_000);
  for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED']) {
    sync.onStatus(status); assert.equal(e.timers.size, 1);
    assert.equal([...e.timers.values()][0].ms, 15_000);
    [...e.timers.values()][0].fn(); await tick();
  }
  assert.equal(calls, 3);
  sync.onStatus('SUBSCRIBED'); await tick();
  assert.equal([...e.timers.values()][0].ms, 60_000);
  sync.dispose();
});

test('bursts are serialized, coalesced and stopped on unmount', async () => {
  const e = environment(); const finish: (() => void)[] = []; let calls = 0;
  const sync = createChatRealtimeSync(async () => { calls++; await new Promise<void>(r => finish.push(r)); }, e.env);
  const first = sync.request();
  for (let i=0;i<20;i++) void sync.request();
  assert.equal(calls, 1);
  finish.shift()!(); await tick(); assert.equal(calls, 2);
  void sync.request(); sync.dispose(); finish.shift()!(); await first;
  assert.equal(calls, 2); assert.equal(e.timers.size, 0);
});

test('failed fetches do not break subsequent realtime recovery', async () => {
  const e = environment(); let calls = 0;
  const sync = createChatRealtimeSync(async () => { if (++calls === 1) throw new Error('offline'); }, e.env);
  await sync.request(); await sync.request(); assert.equal(calls, 2); sync.dispose();
});


test('an invalidation at promise completion is not lost', async () => {
  const e = environment(); let calls = 0;
  const sync = createChatRealtimeSync(async () => { calls++; }, e.env);
  const first = sync.request();
  await Promise.resolve();
  void sync.request();
  await first; await tick();
  assert.equal(calls, 2); sync.dispose();
});
