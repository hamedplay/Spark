import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNotificationTemplateKey,
  resolveNotificationAudience,
  buildNotificationTemplateMap,
  buildSmsTemplateMap,
  resolveNotificationTemplate,
  resolveSmsTemplateBody,
  resolveNotificationChannels,
  buildBaleNotificationText,
  isDuplicateNotificationRpcResult,
} from '../../src/features/notifications/models/notificationProducerModel';
import type {
  NotificationTemplateRow,
  SmsTemplateRow,
  NotifyChannels,
} from '../../src/features/notifications/types/notificationProducer';

test('builds the legacy template key and audience fallback', () => {
  assert.equal(
    buildNotificationTemplateKey(
      'meeting',
      'invite',
      'participants'
    ),
    'meeting:invite:participants'
  );

  assert.equal(
    resolveNotificationAudience(
      undefined
    ),
    'all'
  );

  assert.equal(
    resolveNotificationAudience(''),
    'all'
  );

  assert.equal(
    resolveNotificationAudience(
      'participants'
    ),
    'participants'
  );
});

test('keeps the first Notification template for a duplicate key', () => {
  const rows: NotificationTemplateRow[] = [
    {
      id: 't1',
      category: 'meeting',
      event_type: 'invite',
      audience: 'all',
      title: 'First',
      body: 'Body1',
      updated_at:
        '2024-01-02T00:00:00Z',
    },
    {
      id: 't2',
      category: 'meeting',
      event_type: 'invite',
      audience: 'all',
      title: 'Second',
      body: 'Body2',
      updated_at:
        '2024-01-01T00:00:00Z',
    },
  ];

  const map =
    buildNotificationTemplateMap(rows);

  const template = map.get(
    'meeting:invite:all'
  );

  assert.equal(
    template?.id,
    't1'
  );
  assert.equal(
    template?.title,
    'First'
  );
});

test('keeps the last SMS template for a duplicate key', () => {
  const rows: SmsTemplateRow[] = [
    {
      category: 'meeting',
      event_type: 'invite',
      audience: 'all',
      body: 'SMS1',
    },
    {
      category: 'meeting',
      event_type: 'invite',
      audience: 'all',
      body: 'SMS2',
    },
  ];

  const map =
    buildSmsTemplateMap(rows);

  assert.equal(
    map.get('meeting:invite:all'),
    'SMS2'
  );
});

test('resolves Notification templates through exact then all precedence', () => {
  const rows: NotificationTemplateRow[] = [
    {
      id: 't1',
      category: 'meeting',
      event_type: 'invite',
      audience: 'participants',
      title: 'Exact',
      body: 'ExactBody',
      updated_at:
        '2024-01-01T00:00:00Z',
    },
    {
      id: 't2',
      category: 'meeting',
      event_type: 'invite',
      audience: 'all',
      title: 'All',
      body: 'AllBody',
      updated_at:
        '2024-01-01T00:00:00Z',
    },
  ];

  const map =
    buildNotificationTemplateMap(rows);

  const exact =
    resolveNotificationTemplate(
      map,
      'meeting',
      'invite',
      'participants'
    );
  assert.equal(exact?.title, 'Exact');

  const all =
    resolveNotificationTemplate(
      map,
      'meeting',
      'invite',
      'observers'
    );
  assert.equal(all?.title, 'All');

  const unknown =
    resolveNotificationTemplate(
      map,
      'task',
      'assign',
      'all'
    );
  assert.equal(unknown, undefined);
});

test('resolves SMS templates through exact then all then message fallback', () => {
  const rows: SmsTemplateRow[] = [
    {
      category: 'meeting',
      event_type: 'invite',
      audience: 'participants',
      body: 'ExactSMS',
    },
    {
      category: 'meeting',
      event_type: 'invite',
      audience: 'all',
      body: 'AllSMS',
    },
  ];

  const map =
    buildSmsTemplateMap(rows);

  const exact =
    resolveSmsTemplateBody(
      map,
      'meeting',
      'invite',
      'participants',
      'fallback'
    );
  assert.equal(exact, 'ExactSMS');

  const all =
    resolveSmsTemplateBody(
      map,
      'meeting',
      'invite',
      'observers',
      'fallback'
    );
  assert.equal(all, 'AllSMS');

  const fallback =
    resolveSmsTemplateBody(
      map,
      'task',
      'assign',
      'all',
      'RenderedMessage'
    );
  assert.equal(
    fallback,
    'RenderedMessage'
  );
});

test('enables channels by default and disables only explicit false values', () => {
  const all: NotifyChannels =
    {};
  assert.deepEqual(
    resolveNotificationChannels(
      all
    ),
    {
      inAppEnabled: true,
      smsEnabled: true,
      baleEnabled: true,
    }
  );

  const partial: NotifyChannels =
    {
      inApp: false,
      sms: true,
    };
  assert.deepEqual(
    resolveNotificationChannels(
      partial
    ),
    {
      inAppEnabled: false,
      smsEnabled: true,
      baleEnabled: true,
    }
  );

  const allOff: NotifyChannels =
    {
      inApp: false,
      sms: false,
      bale: false,
    };
  assert.deepEqual(
    resolveNotificationChannels(
      allOff
    ),
    {
      inAppEnabled: false,
      smsEnabled: false,
      baleEnabled: false,
    }
  );
});

test('builds the legacy Bale title and message text', () => {
  assert.equal(
    buildBaleNotificationText(
      'Title',
      'Message'
    ),
    'Title\nMessage'
  );

  assert.equal(
    buildBaleNotificationText(
      'Same',
      'Same'
    ),
    'Same'
  );
});

test('detects duplicate RPC results in object and array forms', () => {
  assert.equal(
    isDuplicateNotificationRpcResult(
      { created: false }
    ),
    true
  );

  assert.equal(
    isDuplicateNotificationRpcResult(
      [{ created: false }]
    ),
    true
  );

  assert.equal(
    isDuplicateNotificationRpcResult(
      { created: true }
    ),
    false
  );

  assert.equal(
    isDuplicateNotificationRpcResult(
      []
    ),
    false
  );

  assert.equal(
    isDuplicateNotificationRpcResult(
      null
    ),
    false
  );
});
