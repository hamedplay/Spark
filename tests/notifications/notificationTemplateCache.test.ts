import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createNotificationTemplateCache,
  NOTIFICATION_TEMPLATE_CACHE_TTL_MS,
} from '../../src/features/notifications/services/notificationTemplateCache';
import type {
  NotificationTemplateCacheDependencies,
} from '../../src/features/notifications/services/notificationTemplateCache';
import type {
  NotificationTemplateRow,
  SmsTemplateRow,
} from '../../src/features/notifications/types/notificationProducer';interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(
    (res) => {
      resolve = res;
    }
  );
  return { promise, resolve };
}

interface MutableCounter {
  value: number;
}

interface FetchTracker {
  notificationCalls: MutableCounter;
  smsCalls: MutableCounter;
  notificationDeferred: Deferred<NotificationTemplateRow[]>;
  smsDeferred: Deferred<SmsTemplateRow[]>;
}

function createFetchTracker(): FetchTracker {
  const notificationCalls: MutableCounter =
    { value: 0 };
  const smsCalls: MutableCounter = {
    value: 0,
  };
  const notificationDeferred =
    createDeferred<NotificationTemplateRow[]>();
  const smsDeferred =
    createDeferred<SmsTemplateRow[]>();

  return {
    notificationCalls,
    smsCalls,
    notificationDeferred,
    smsDeferred,
  };
}

function createDependencies(
  tracker: FetchTracker,
  nowMs: number
): NotificationTemplateCacheDependencies {
  return {
    fetchNotificationRows: () => {
      tracker.notificationCalls.value++;
      return tracker.notificationDeferred.promise;
    },
    fetchSmsRows: () => {
      tracker.smsCalls.value++;
      return tracker.smsDeferred.promise;
    },
    now: () => nowMs,
  };
}

function makeNotificationRow(
  id: string,
  title: string
): NotificationTemplateRow {
  return {
    id,
    category: 'meeting',
    event_type: 'invite',
    audience: 'all',
    title,
    body: `body-${id}`,
    updated_at:
      '2024-01-01T00:00:00Z',
  };
}

function makeSmsRow(
  body: string
): SmsTemplateRow {
  return {
    category: 'meeting',
    event_type: 'invite',
    audience: 'all',
    body,
  };
}

function flush(): Promise<void> {
  return new Promise((r) =>
    setImmediate(r)
  );
}

test('reuses the Notification template map before the five-minute TTL', async () => {
  const tracker =
    createFetchTracker();
  const deps = createDependencies(
    tracker,
    1000
  );
  const cache =
    createNotificationTemplateCache(
      deps
    );

  tracker.notificationDeferred.resolve(
    [makeNotificationRow('t1', 'First')]
  );

  const first =
    await cache.getNotificationTemplates();
  const second =
    await cache.getNotificationTemplates();

  assert.equal(
    tracker.notificationCalls.value,
    1
  );
  assert.equal(first, second);
});

test('reloads Notification templates at the exact TTL boundary', async () => {
  const tracker =
    createFetchTracker();
  let nowMs = 1000;
  const deps: NotificationTemplateCacheDependencies =
    {
      fetchNotificationRows: () => {
        tracker.notificationCalls.value++;
        return tracker.notificationDeferred.promise;
      },
      fetchSmsRows: () => {
        tracker.smsCalls.value++;
        return tracker.smsDeferred.promise;
      },
      now: () => nowMs,
    };
  const cache =
    createNotificationTemplateCache(
      deps
    );

  tracker.notificationDeferred.resolve(
    [makeNotificationRow('t1', 'First')]
  );

  const first =
    await cache.getNotificationTemplates();

  nowMs =
    1000 +
    NOTIFICATION_TEMPLATE_CACHE_TTL_MS;

  const secondDeferred =
    createDeferred<NotificationTemplateRow[]>();
  tracker.notificationDeferred =
    secondDeferred;
  secondDeferred.resolve([
    makeNotificationRow(
      't2',
      'Second'
    ),
  ]);

  const second =
    await cache.getNotificationTemplates();

  assert.equal(
    tracker.notificationCalls.value,
    2
  );
  assert.notEqual(first, second);
});

test('keeps Notification and SMS caches independent', async () => {
  const tracker =
    createFetchTracker();
  const deps = createDependencies(
    tracker,
    1000
  );
  const cache =
    createNotificationTemplateCache(
      deps
    );

  tracker.notificationDeferred.resolve(
    [makeNotificationRow('t1', 'First')]
  );

  await cache.getNotificationTemplates();

  assert.equal(
    tracker.notificationCalls.value,
    1
  );
  assert.equal(
    tracker.smsCalls.value,
    0
  );

  tracker.smsDeferred.resolve([
    makeSmsRow('SMS1'),
  ]);

  await cache.getSmsTemplates();

  assert.equal(
    tracker.notificationCalls.value,
    1
  );
  assert.equal(
    tracker.smsCalls.value,
    1
  );
});

test('invalidates both caches without changing their mapping rules', async () => {
  const tracker =
    createFetchTracker();
  const deps = createDependencies(
    tracker,
    1000
  );
  const cache =
    createNotificationTemplateCache(
      deps
    );

  tracker.notificationDeferred.resolve([
    makeNotificationRow('t1', 'First'),
    makeNotificationRow('t2', 'Second'),
  ]);
  tracker.smsDeferred.resolve([
    makeSmsRow('SMS1'),
    makeSmsRow('SMS2'),
  ]);

  const notif1 =
    await cache.getNotificationTemplates();
  const sms1 =
    await cache.getSmsTemplates();

  assert.equal(
    notif1.get('meeting:invite:all')
      ?.title,
    'First'
  );
  assert.equal(
    sms1.get('meeting:invite:all'),
    'SMS2'
  );

  cache.invalidate();

  const notifDeferred2 =
    createDeferred<NotificationTemplateRow[]>();
  const smsDeferred2 =
    createDeferred<SmsTemplateRow[]>();
  tracker.notificationDeferred =
    notifDeferred2;
  tracker.smsDeferred = smsDeferred2;
  notifDeferred2.resolve([
    makeNotificationRow('t3', 'Third'),
    makeNotificationRow(
      't4',
      'Fourth'
    ),
  ]);
  smsDeferred2.resolve([
    makeSmsRow('SMS3'),
    makeSmsRow('SMS4'),
  ]);

  const notif2 =
    await cache.getNotificationTemplates();
  const sms2 =
    await cache.getSmsTemplates();

  assert.equal(
    notif2.get('meeting:invite:all')
      ?.title,
    'Third'
  );
  assert.equal(
    sms2.get('meeting:invite:all'),
    'SMS4'
  );
});

test('does not deduplicate concurrent cache misses', async () => {
  const tracker =
    createFetchTracker();
  const deps = createDependencies(
    tracker,
    1000
  );
  const cache =
    createNotificationTemplateCache(
      deps
    );

  const promise1 =
    cache.getNotificationTemplates();
  const promise2 =
    cache.getNotificationTemplates();

  assert.equal(
    tracker.notificationCalls.value,
    2
  );

  tracker.notificationDeferred.resolve([
    makeNotificationRow('t1', 'First'),
  ]);

  await Promise.all([
    promise1,
    promise2,
  ]);

  await flush();
});
