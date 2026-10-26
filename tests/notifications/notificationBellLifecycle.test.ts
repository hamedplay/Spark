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


test('initial snapshot cannot overwrite a newer insert or read update', async () => {
  const h = createHarness();
  const read = {...makeNotification('old'),read:true};
  h.capturedHandlers!.onInsert(makeNotification('new'));
  h.capturedHandlers!.onUpdate(read);
  h.loadDeferred.resolve([makeNotification('old')]);
  await flush();
  assert.deepEqual(new Set(h.loadedNotifications[0].map(n=>n.id)),new Set(['old','new']));
  assert.equal(h.loadedNotifications[0].find(n=>n.id==='old')!.read,true);
  h.cleanup();
});

test('deletion is forwarded and never resurrected by an in-flight snapshot', async () => {
  const h=createHarness();const deleted:string[]=[];
  h.input.onNotificationDeleted=id=>deleted.push(id);
  h.capturedHandlers!.onDelete?.('gone');
  h.loadDeferred.resolve([makeNotification('gone'),makeNotification('keep')]);
  await flush();
  assert.deepEqual(deleted,['gone']);
  assert.ok(h.loadedNotifications.every(rows=>!rows.some(n=>n.id==='gone')));
  h.cleanup();h.capturedHandlers!.onDelete?.('late');assert.deepEqual(deleted,['gone']);
});

test('reconnect reloads server truth even when unread count has not changed', async () => {
  const h=createHarness();h.loadDeferred.resolve([{...makeNotification('read-row'),read:true}]);await flush();
  h.input.loadNotifications=async()=>[];
  h.capturedHandlers!.onSubscribed?.(true);await flush();
  assert.deepEqual(h.loadedNotifications.at(-1),[]);h.cleanup();
});

test('resume and periodic safety checks reconcile visible tabs without manual refresh', async t => {
  t.mock.timers.enable({apis:['setInterval']});
  const win=new EventTarget();const doc=Object.assign(new EventTarget(),{visibilityState:'visible'});
  Object.assign(globalThis,{window:win,document:doc});
  const h=createHarness();
  try {
    h.loadDeferred.resolve([]);await flush();
    let reloads=0;h.input.loadNotifications=async()=>{reloads++;return []};
    for(const event of ['focus','online']) {win.dispatchEvent(new Event(event));await flush();}
    assert.equal(reloads,2);
    doc.visibilityState='hidden';t.mock.timers.tick(60_000);await flush();assert.equal(reloads,2);
    doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await flush();assert.equal(reloads,3);
    t.mock.timers.tick(60_000);await flush();assert.equal(reloads,4);
    h.cleanup();win.dispatchEvent(new Event('online'));await flush();assert.equal(reloads,4);
  } finally {h.cleanup();delete (globalThis as any).window;delete (globalThis as any).document;}
});

test('broadcast invalidation discovers missed inserts immediately, alerts once and preserves read/delete changes', async () => {
  const h=createHarness();
  const old={...makeNotification('old'),created_at:'2026-10-26T10:00:00Z'};
  const fresh={...makeNotification('fresh'),created_at:'2026-10-26T11:00:00Z'};
  h.loadDeferred.resolve([old]);await flush();assert.equal(h.insertedNotifications.length,0);
  h.input.loadNotifications=async()=>[fresh,{...old,read:true}];
  await h.capturedHandlers!.onInvalidated?.();await flush();
  assert.equal(h.loadedNotifications.at(-1)![0].id,'fresh');
  assert.deepEqual(h.insertedNotifications.map(n=>n.id),['fresh']);
  await h.capturedHandlers!.onInvalidated?.();
  h.capturedHandlers!.onInsert(fresh);await flush();
  assert.equal(h.insertedNotifications.length,1);
  h.input.loadNotifications=async()=>[{...old,read:true}];
  await h.capturedHandlers!.onInvalidated?.();
  assert.deepEqual(h.loadedNotifications.at(-1)!.map(n=>n.id),['old']);h.cleanup();
});

test('catch-up does not alert read notifications or older rows entering the list', async () => {
  const h=createHarness();h.loadDeferred.resolve([{...makeNotification('baseline'),created_at:'2026-10-26T10:00:00Z'}]);await flush();
  h.input.loadNotifications=async()=>[
    {...makeNotification('older'),created_at:'2026-10-26T09:00:00Z'},
    {...makeNotification('read'),read:true,created_at:'2026-10-26T11:00:00Z'},
  ];
  await h.capturedHandlers!.onInvalidated?.();assert.equal(h.insertedNotifications.length,0);h.cleanup();
});
