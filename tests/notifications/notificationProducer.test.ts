import assert from 'node:assert/strict';
import test from 'node:test';

import {
  produceNotificationWithDependencies,
} from '../../src/features/notifications/services/notificationProducerOrchestration';
import type {
  NotificationProducerDependencies,
} from '../../src/features/notifications/services/notificationProducerOrchestration';
import type {
  NotifyPayload,
  SmsDispatchResult,
  NotificationTemplate,
} from '../../src/features/notifications/types/notificationProducer';
import type {
  CreateInAppNotificationInput,
  CreateInAppNotificationResult,
} from '../../src/features/notifications/repositories/inAppNotificationRepository';
import type {
  DispatchSmsNotificationInput,
} from '../../src/features/notifications/gateways/smsNotificationGateway';

interface CallLog {
  inApp: CreateInAppNotificationInput[];
  sms: DispatchSmsNotificationInput[];
  bale: { userId: string; text: string }[];
}

function createCallLog(): CallLog {
  return {
    inApp: [],
    sms: [],
    bale: [],
  };
}

function makePayload(
  overrides: Partial<NotifyPayload> = {}
): NotifyPayload {
  return {
    userId: 'user-1',
    category: 'meeting',
    eventType: 'invite',
    fallbackTitle: 'Fallback Title',
    fallbackMessage:
      'Fallback Message',
    placeholders: {
      meeting_subject: 'Subject',
    },
    senderId: 'sender-1',
    ...overrides,
  };
}

function makeDependencies(
  callLog: CallLog,
  options: {
    inAppResult?: CreateInAppNotificationResult;
    smsResult?: SmsDispatchResult;
    notificationTemplates?: Map<
      string,
      NotificationTemplate
    >;
    smsTemplates?: Map<string, string>;
  } = {}
): NotificationProducerDependencies {
  return {
    getNotificationTemplates:
      async () =>
        options.notificationTemplates ??
        new Map(),
    getSmsTemplates: async () =>
      options.smsTemplates ??
      new Map(),
    createInAppNotification: async (
      input
    ) => {
      callLog.inApp.push(input);
      return (
        options.inAppResult ?? {
          status: 'created',
        }
      );
    },
    dispatchSms: async (input) => {
      callLog.sms.push(input);
      return (
        options.smsResult ?? {
          ok: true,
          status: 'sent',
        }
      );
    },
    dispatchBale: async (
      userId,
      text
    ) => {
      callLog.bale.push({
        userId,
        text,
      });
    },
  };
}

test('dispatches in-app then SMS then Bale and returns the SMS result', async () => {
  const callLog = createCallLog();
  const deps = makeDependencies(
    callLog,
    {
      smsResult: {
        ok: true,
        status: 'sent',
      },
    }
  );

  const result =
    await produceNotificationWithDependencies(
      makePayload(),
      deps
    );

  assert.equal(
    callLog.inApp.length,
    1
  );
  assert.equal(
    callLog.inApp[0].title,
    'Fallback Title'
  );
  assert.equal(
    callLog.inApp[0].message,
    'Fallback Message'
  );

  assert.equal(
    callLog.sms.length,
    1
  );
  assert.equal(
    callLog.sms[0].message,
    'Fallback Message'
  );

  assert.equal(
    callLog.bale.length,
    1
  );
  assert.equal(
    callLog.bale[0].text,
    'Fallback Title\nFallback Message'
  );

  assert.equal(
    result.status,
    'sent'
  );
  assert.equal(result.ok, true);
});

test('returns RPC_ERROR and skips SMS and Bale when in-app creation fails', async () => {
  const callLog = createCallLog();
  const deps = makeDependencies(
    callLog,
    {
      inAppResult: {
        status: 'failed',
        errorMessage:
          'RPC blew up',
      },
    }
  );

  const result =
    await produceNotificationWithDependencies(
      makePayload(),
      deps
    );

  assert.equal(
    result.ok,
    false
  );
  assert.equal(
    result.status,
    'failed'
  );
  assert.equal(
    result.errorCode,
    'RPC_ERROR'
  );
  assert.equal(
    result.error,
    'RPC blew up'
  );

  assert.equal(
    callLog.sms.length,
    0
  );
  assert.equal(
    callLog.bale.length,
    0
  );
});

test('returns duplicate-event skip and skips SMS and Bale', async () => {
  const callLog = createCallLog();
  const deps = makeDependencies(
    callLog,
    {
      inAppResult: {
        status: 'duplicate',
      },
    }
  );

  const result =
    await produceNotificationWithDependencies(
      makePayload(),
      deps
    );

  assert.equal(
    result.ok,
    true
  );
  assert.equal(
    result.status,
    'skipped'
  );
  assert.equal(
    result.reason,
    'DUPLICATE_EVENT_KEY'
  );

  assert.equal(
    callLog.sms.length,
    0
  );
  assert.equal(
    callLog.bale.length,
    0
  );
});

test('continues with SMS and Bale when the in-app channel is disabled', async () => {
  const callLog = createCallLog();
  const deps = makeDependencies(
    callLog,
    {
      smsResult: {
        ok: true,
        status: 'sent',
      },
    }
  );

  const result =
    await produceNotificationWithDependencies(
      makePayload({
        channels: {
          inApp: false,
        },
      }),
      deps
    );

  assert.equal(
    callLog.inApp.length,
    0
  );
  assert.equal(
    callLog.sms.length,
    1
  );
  assert.equal(
    callLog.bale.length,
    1
  );
  assert.equal(
    result.status,
    'sent'
  );
});

test('returns CHANNEL_DISABLED when SMS is disabled while Bale still dispatches', async () => {
  const callLog = createCallLog();
  const deps = makeDependencies(
    callLog
  );

  const result =
    await produceNotificationWithDependencies(
      makePayload({
        channels: {
          sms: false,
        },
      }),
      deps
    );

  assert.deepEqual(result, {
    ok: true,
    status: 'skipped',
    reason: 'CHANNEL_DISABLED',
  });

  assert.equal(
    callLog.sms.length,
    0
  );
  assert.equal(
    callLog.bale.length,
    1
  );
});

test('uses exact then all then rendered-message fallback for SMS content', async () => {
  const callLog = createCallLog();

  const exactSms = new Map([
    [
      'meeting:invite:participants',
      'ExactSMS',
    ],
  ]);

  const allSms = new Map([
    [
      'meeting:invite:all',
      'AllSMS',
    ],
  ]);

  const noSms = new Map<string, string>();

  await produceNotificationWithDependencies(
    makePayload({
      audience: 'participants',
    }),
    makeDependencies(callLog, {
      smsTemplates: exactSms,
    })
  );

  assert.equal(
    callLog.sms[0].message,
    'ExactSMS'
  );

  callLog.sms = [];

  await produceNotificationWithDependencies(
    makePayload({
      audience: 'observers',
    }),
    makeDependencies(callLog, {
      smsTemplates: allSms,
    })
  );

  assert.equal(
    callLog.sms[0].message,
    'AllSMS'
  );

  callLog.sms = [];

  await produceNotificationWithDependencies(
    makePayload(),
    makeDependencies(callLog, {
      smsTemplates: noSms,
    })
  );

  assert.equal(
    callLog.sms[0].message,
    'Fallback Message'
  );
});

test('still loads and resolves Notification templates when all channels are disabled', async () => {
  const callLog = createCallLog();
  let templateLoads = 0;

  const deps: NotificationProducerDependencies =
    {
      getNotificationTemplates:
        async () => {
          templateLoads++;
          return new Map();
        },
      getSmsTemplates: async () =>
        new Map(),
      createInAppNotification:
        async () => {
          return {
            status: 'created',
          };
        },
      dispatchSms: async () => {
        return {
          ok: true,
          status: 'sent',
        };
      },
      dispatchBale: async () => {},
    };

  const result =
    await produceNotificationWithDependencies(
      makePayload({
        channels: {
          inApp: false,
          sms: false,
          bale: false,
        },
      }),
      deps
    );

  assert.equal(
    templateLoads,
    1
  );
  assert.equal(
    callLog.inApp.length,
    0
  );
  assert.equal(
    callLog.sms.length,
    0
  );
  assert.equal(
    callLog.bale.length,
    0
  );
  assert.deepEqual(result, {
    ok: true,
    status: 'skipped',
    reason: 'CHANNEL_DISABLED',
  });
});
