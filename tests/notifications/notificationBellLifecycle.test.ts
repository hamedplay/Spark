import assert from 'node:assert/strict';
import test from 'node:test';

import {
  startNotificationBellLifecycle,
} from '../../src/features/notifications/services/notificationBellLifecycle';
import type {
  StartNotificationBellLifecycleInput,
} from '../../src/features/notifications/services/notificationBellLifecycle';
import type {
  NotificationRealtimeHandlers,
} from '../../src/features/notifications/services/notificationRealtime';
import type {
  AppNotification,
} from '../../src/features/notifications/types/appNotification';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>(
    (res, rej) => {
      resolve = res;
      reject = rej;
    }
  );
  return { promise, resolve, reject };
}

interface MutableCounter {
  value: number;
}

interface BellHarness {
  input: StartNotificationBellLifecycleInput;
  cleanup: () => void;
  loadDeferred: Deferred<AppNotification[]>;
  capturedHandlers:
    | NotificationRealtimeHandlers
    | null;
  unsubscribeCalls: MutableCounter;
  loadingChanges: boolean[];
  loadedNotifications: AppNotification[][];
  insertedNotifications: AppNotification[];
  updatedNotifications: AppNotification[];
  realtimeSubscriptions: boolean[];
  realtimeErrors: unknown[];
  loadErrors: unknown[];
}

function makeNotification(
  id: string
): AppNotification {
  return {
    id,
    title: 'title',
    message: 'message',
    type: 'chat',
    read: false,
    created_at:
      '2024-01-15T10:00:00.000Z',
  };
}

function createHarness(): BellHarness {
  const loadDeferred =
    createDeferred<AppNotification[]>();
  let capturedHandlers:
    | NotificationRealtimeHandlers
    | null = null;
  const unsubscribeCalls: MutableCounter =
    { value: 0 };
  const loadingChanges: boolean[] = [];
  const loadedNotifications: AppNotification[][] =
    [];
  const insertedNotifications: AppNotification[] =
    [];
  const updatedNotifications: AppNotification[] =
    [];
  const realtimeSubscriptions: boolean[] =
    [];
  const realtimeErrors: unknown[] = [];
  const loadErrors: unknown[] = [];

  const input: StartNotificationBellLifecycleInput =
    {
      userId: 'user-1',
      loadNotifications: () =>
        loadDeferred.promise,
      subscribeToChanges: (
        _userId,
        handlers
      ) => {
        capturedHandlers = handlers;
        return () => {
          unsubscribeCalls.value++;
        };
      },
      onLoadingChange: (loading) =>
        loadingChanges.push(loading),
      onNotificationsLoaded: (
        notifications
      ) =>
        loadedNotifications.push(
          notifications
        ),
      onNotificationInserted: (
        notification
      ) =>
        insertedNotifications.push(
          notification
        ),
      onNotificationUpdated: (
        notification
      ) =>
        updatedNotifications.push(
          notification
        ),
      onRealtimeSubscribed: (
        reconnected
      ) =>
        realtimeSubscriptions.push(
          reconnected
        ),
      onRealtimeError: (error) =>
        realtimeErrors.push(error),
      onLoadError: (error) =>
        loadErrors.push(error),
    };

  const cleanup =
    startNotificationBellLifecycle(
      input
    );

  return {
    input,
    cleanup,
    loadDeferred,
    capturedHandlers,
    unsubscribeCalls,
    loadingChanges,
    loadedNotifications,
    insertedNotifications,
    updatedNotifications,
    realtimeSubscriptions,
    realtimeErrors,
    loadErrors,
  };
}

function flush(): Promise<void> {
  return new Promise((r) =>
    setImmediate(r)
  );
}

test('starts loading and subscribes before the initial load resolves', () => {
  const h = createHarness();

  assert.deepEqual(
    h.loadingChanges,
    [true]
  );
  assert.ok(h.capturedHandlers);

  h.cleanup();
});

test('publishes loaded notifications and finishes loading', async () => {
  const h = createHarness();

  const items = [
    makeNotification('1'),
    makeNotification('2'),
  ];
  h.loadDeferred.resolve(items);
  await flush();

  assert.equal(
    h.loadedNotifications.length,
    1
  );
  assert.equal(
    h.loadedNotifications[0].length,
    2
  );
  assert.deepEqual(
    h.loadingChanges,
    [true, false]
  );

  h.cleanup();
});

test('reports load errors and finishes loading', async () => {
  const h = createHarness();

  h.loadDeferred.reject(
    new Error('fetch failed')
  );
  await flush();

  assert.equal(
    h.loadErrors.length,
    1
  );
  assert.deepEqual(
    h.loadingChanges,
    [true, false]
  );
  assert.equal(
    h.loadedNotifications.length,
    0
  );

  h.cleanup();
});

test('forwards Realtime insert and update events', () => {
  const h = createHarness();

  assert.ok(h.capturedHandlers);

  const inserted =
    makeNotification('new-1');
  h.capturedHandlers!.onInsert(
    inserted
  );

  assert.equal(
    h.insertedNotifications.length,
    1
  );
  assert.equal(
    h.insertedNotifications[0].id,
    'new-1'
  );

  const updated =
    makeNotification('1');
  h.capturedHandlers!.onUpdate(
    updated
  );

  assert.equal(
    h.updatedNotifications.length,
    1
  );
  assert.equal(
    h.updatedNotifications[0].id,
    '1'
  );

  h.cleanup();
});

test('forwards Realtime subscription status and errors', () => {
  const h = createHarness();

  assert.ok(h.capturedHandlers);

  h.capturedHandlers!.onSubscribed?.(
    false
  );
  h.capturedHandlers!.onSubscribed?.(
    true
  );

  const error =
    new Error('channel failed');
  h.capturedHandlers!.onError?.(
    error
  );

  assert.deepEqual(
    h.realtimeSubscriptions,
    [false, true]
  );
  assert.equal(
    h.realtimeErrors.length,
    1
  );
  assert.equal(
    h.realtimeErrors[0],
    error
  );

  h.cleanup();
});

test('unsubscribes exactly once during cleanup', () => {
  const h = createHarness();

  h.cleanup();
  assert.equal(
    h.unsubscribeCalls.value,
    1
  );

  h.cleanup();
  assert.equal(
    h.unsubscribeCalls.value,
    1
  );
});

test('ignores late load and Realtime events after cleanup', async () => {
  const h = createHarness();

  h.cleanup();

  h.loadDeferred.resolve([
    makeNotification('1'),
  ]);
  await flush();

  assert.equal(
    h.loadedNotifications.length,
    0
  );

  assert.ok(h.capturedHandlers);
  h.capturedHandlers!.onInsert(
    makeNotification('2')
  );
  h.capturedHandlers!.onUpdate(
    makeNotification('3')
  );

  assert.equal(
    h.insertedNotifications.length,
    0
  );
  assert.equal(
    h.updatedNotifications.length,
    0
  );
});
