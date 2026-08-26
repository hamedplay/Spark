import assert from 'node:assert/strict';
import test from 'node:test';

import {
  startLayoutPresenceLifecycle,
} from '../../src/app/layout/services/layoutPresenceLifecycle';
import type {
  LayoutPresenceLifecycleEnvironment,
} from '../../src/app/layout/services/layoutPresenceLifecycle';
import type {
  UpsertLayoutPresenceInput,
} from '../../src/app/layout/repositories/layoutUserRepository';
import type {
  LayoutUserStatus,
} from '../../src/app/layout/types/layoutUser';

interface FakeEnvironment
  extends LayoutPresenceLifecycleEnvironment {
  intervalMs: number | null;
  callback: (() => void) | null;
  beforeUnloadListener:
    | (() => void)
    | null;
}

function createFakeEnvironment(): FakeEnvironment {
  const env: FakeEnvironment = {
    intervalMs: null,
    callback: null,
    beforeUnloadListener: null,
    setInterval(
      callback: () => void,
      intervalMs: number
    ): number {
      this.callback = callback;
      this.intervalMs = intervalMs;
      return 42;
    },
    clearInterval(
      _intervalId: number
    ): void {
      void _intervalId;
      this.callback = null;
      this.intervalMs = null;
    },
    addBeforeUnload(
      listener: () => void
    ): void {
      this.beforeUnloadListener = listener;
    },
    removeBeforeUnload(
      listener: () => void
    ): void {
      if (this.beforeUnloadListener === listener) {
        this.beforeUnloadListener = null;
      }
    },
  };
  return env;
}

test('starts with the stored status and an online heartbeat payload', async () => {
  const upsertCalls: UpsertLayoutPresenceInput[] = [];
  const status: LayoutUserStatus = 'busy';
  const env = createFakeEnvironment();

  await startLayoutPresenceLifecycle({
    userId: 'user-1',
    readStatus: () => status,
    now: () => '2026-01-01T00:00:00.000Z',
    upsertPresence: async (input) => {
      upsertCalls.push(input);
    },
    markOffline: async () => {},
    environment: env,
  });

  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: 'user-1',
    status: 'busy',
    isOnline: true,
    lastSeen: '2026-01-01T00:00:00.000Z',
  });
  assert.equal(env.intervalMs, 60_000);
});

test('uses the latest status for each heartbeat and skips offline status', async () => {
  const upsertCalls: UpsertLayoutPresenceInput[] = [];
  let status: LayoutUserStatus = 'online';
  const env = createFakeEnvironment();
  let tick = 0;

  await startLayoutPresenceLifecycle({
    userId: 'user-1',
    readStatus: () => status,
    now: () => `2026-01-01T00:0${tick}:00.000Z`,
    upsertPresence: async (input) => {
      upsertCalls.push(input);
    },
    markOffline: async () => {},
    environment: env,
  });

  assert.ok(env.callback);

  tick = 1;
  status = 'busy';
  env.callback!();
  assert.equal(upsertCalls.length, 2);
  assert.equal(upsertCalls[1].status, 'busy');
  assert.equal(upsertCalls[1].isOnline, true);

  tick = 2;
  status = 'offline';
  env.callback!();
  assert.equal(upsertCalls.length, 2);

  tick = 3;
  status = 'away';
  env.callback!();
  assert.equal(upsertCalls.length, 3);
  assert.equal(upsertCalls[2].status, 'away');
});

test('marks the user offline on beforeunload', async () => {
  const markOfflineCalls: string[] = [];
  const env = createFakeEnvironment();

  await startLayoutPresenceLifecycle({
    userId: 'user-1',
    readStatus: () => 'online',
    now: () => '2026-01-01T00:00:00.000Z',
    upsertPresence: async () => {},
    markOffline: async (userId) => {
      markOfflineCalls.push(userId);
    },
    environment: env,
  });

  assert.ok(env.beforeUnloadListener);
  env.beforeUnloadListener!();

  assert.equal(markOfflineCalls.length, 1);
  assert.equal(markOfflineCalls[0], 'user-1');
});

test('clears the heartbeat and removes the exact listener during cleanup', async () => {
  const env = createFakeEnvironment();

  const cleanup =
    await startLayoutPresenceLifecycle({
      userId: 'user-1',
      readStatus: () => 'online',
      now: () => '2026-01-01T00:00:00.000Z',
      upsertPresence: async () => {},
      markOffline: async () => {},
      environment: env,
    });

  assert.ok(env.callback);
  assert.ok(env.beforeUnloadListener);

  cleanup();

  assert.equal(env.callback, null);
  assert.equal(env.beforeUnloadListener, null);
});
