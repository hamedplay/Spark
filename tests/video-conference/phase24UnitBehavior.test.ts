import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFERENCE_PERMISSIONS,
  CONFERENCE_RBAC_ROLES,
  type ConferenceAuthorization,
  type SpeakerSessionRow,
} from '../../src/features/video-conference/types/conference.types';
import {
  ASSIGNABLE_CONFERENCE_ROLES,
  conferenceMessageRole,
  conferenceRoleLabel,
  hasConferencePermission,
} from '../../src/features/video-conference/utils/conferencePermissions';
import {
  calculateSpeakerRemainingSeconds,
} from '../../src/features/video-conference/hooks/useConferenceSpeakerTimer';
import {
  calculateConferencePhaseRemainingSeconds,
  conferencePhaseHidesMedia,
} from '../../src/features/video-conference/hooks/useConferencePhase';
import {
  ConferencePollActionError,
  loadConferencePollSnapshot,
  runConferencePollAction,
} from '../../src/features/video-conference/services/conferencePolls';
import {
  ConferenceChatActionError,
  runConferenceChatAction,
} from '../../src/features/video-conference/services/conferenceChat';
import {
  getMyConferenceAuthorization,
  setConferenceParticipantRole,
} from '../../src/features/video-conference/services/conferenceAuthorization';

function speakerSession(
  patch: Partial<SpeakerSessionRow>,
): SpeakerSessionRow {
  return {
    id: 'session-1',
    room_id: 'room-1',
    user_id: 'user-1',
    granted_by: 'host-1',
    starts_at: '2026-08-31T09:00:00.000Z',
    active_started_at: '2026-08-31T09:00:00.000Z',
    expires_at: '2026-08-31T09:01:00.000Z',
    allocated_seconds: 60,
    used_seconds: 0,
    status: 'ACTIVE',
    queue_position: null,
    paused_at: null,
    ended_at: null,
    end_reason: null,
    created_at: '2026-08-31T09:00:00.000Z',
    updated_at: '2026-08-31T09:00:00.000Z',
    ...patch,
  };
}

test('Phase 24 unit: canonical conference roles and assignable roles stay distinct', () => {
  assert.deepEqual(CONFERENCE_RBAC_ROLES, [
    'OWNER',
    'HOST',
    'CO_HOST',
    'MODERATOR',
    'PRESENTER',
    'PARTICIPANT',
    'VIEWER',
  ]);
  assert.equal(ASSIGNABLE_CONFERENCE_ROLES.includes('OWNER'), false);
  assert.deepEqual(ASSIGNABLE_CONFERENCE_ROLES, [
    'HOST',
    'CO_HOST',
    'MODERATOR',
    'PRESENTER',
    'PARTICIPANT',
    'VIEWER',
  ]);
});

test('Phase 24 unit: permission helper fails closed until authorization is loaded', () => {
  const unloaded: ConferenceAuthorization = {
    loaded: false,
    role: 'HOST',
    permissions: ['MANAGE_ROLES'],
  };
  assert.equal(
    hasConferencePermission(unloaded, 'MANAGE_ROLES'),
    false,
  );

  const loaded: ConferenceAuthorization = {
    ...unloaded,
    loaded: true,
  };
  assert.equal(
    hasConferencePermission(loaded, 'MANAGE_ROLES'),
    true,
  );
  assert.equal(
    hasConferencePermission(loaded, 'START_RECORDING'),
    false,
  );
});

test('Phase 24 unit: role labels and chat role mapping are stable', () => {
  assert.equal(conferenceRoleLabel('OWNER'), 'مالک جلسه');
  assert.equal(conferenceRoleLabel('MODERATOR'), 'مدیر جلسه');
  assert.equal(conferenceRoleLabel('VIEWER'), 'بیننده');

  assert.equal(conferenceMessageRole('OWNER'), 'admin');
  assert.equal(conferenceMessageRole('HOST'), 'admin');
  assert.equal(conferenceMessageRole('CO_HOST'), 'admin');
  assert.equal(conferenceMessageRole('MODERATOR'), 'moderator');
  assert.equal(conferenceMessageRole('PRESENTER'), 'user');
  assert.equal(conferenceMessageRole(null), 'user');
});

test('Phase 24 unit: speaker timer calculation uses synchronized server time', () => {
  const now = Date.parse('2026-08-31T09:00:30.250Z');
  assert.equal(
    calculateSpeakerRemainingSeconds(
      speakerSession({ status: 'ACTIVE' }),
      now,
    ),
    30,
  );

  assert.equal(
    calculateSpeakerRemainingSeconds(
      speakerSession({
        status: 'PAUSED',
        allocated_seconds: 90,
        used_seconds: 31,
        expires_at: null,
      }),
      now,
    ),
    59,
  );

  assert.equal(
    calculateSpeakerRemainingSeconds(
      speakerSession({
        status: 'ACTIVE',
        expires_at: '2026-08-31T08:59:59.000Z',
      }),
      now,
    ),
    0,
  );

  for (const status of [
    'QUEUED',
    'EXPIRED',
    'COMPLETED',
    'CANCELLED',
  ] as const) {
    assert.equal(
      calculateSpeakerRemainingSeconds(
        speakerSession({ status }),
        now,
      ),
      0,
      status,
    );
  }
});

test('Phase 24 unit: phase countdown and media hiding are deterministic', () => {
  const now = Date.parse('2026-08-31T09:00:00.250Z');

  assert.equal(
    calculateConferencePhaseRemainingSeconds(
      '2026-08-31T09:00:10.000Z',
      now,
    ),
    10,
  );
  assert.equal(
    calculateConferencePhaseRemainingSeconds(
      '2026-08-31T08:59:59.000Z',
      now,
    ),
    0,
  );
  assert.equal(
    calculateConferencePhaseRemainingSeconds(null, now),
    null,
  );

  assert.equal(conferencePhaseHidesMedia('COUNTDOWN'), true);
  assert.equal(conferencePhaseHidesMedia('RESUMING'), true);
  assert.equal(conferencePhaseHidesMedia('LIVE'), false);
  assert.equal(conferencePhaseHidesMedia('BREAK'), false);
});

test('Phase 24 unit: authorization parser rejects unknown roles and permissions', async () => {
  const calls: unknown[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return {
        data: {
          ok: true,
          role: 'HOST',
          permissions: [
            'MANAGE_ROLES',
            'SEND_CHAT',
            'NOT_A_REAL_PERMISSION',
          ],
        },
        error: null,
      };
    },
  } as any;

  const auth = await getMyConferenceAuthorization(
    client,
    'room-1',
  );

  assert.deepEqual(calls, [[
    'get_my_conference_authorization',
    { p_room_id: 'room-1' },
  ]]);
  assert.deepEqual(auth, {
    loaded: true,
    role: 'HOST',
    permissions: ['MANAGE_ROLES', 'SEND_CHAT'],
  });

  client.rpc = async () => ({
    data: {
      ok: true,
      role: 'ROOT',
      permissions: ['MANAGE_ROLES'],
    },
    error: null,
  });

  assert.deepEqual(
    await getMyConferenceAuthorization(client, 'room-1'),
    { loaded: true, role: null, permissions: [] },
  );
});

test('Phase 24 unit: OWNER cannot be assigned through normal role mutation', async () => {
  const client = {
    functions: {
      invoke: async () => {
        throw new Error('should not call edge');
      },
    },
  } as any;

  await assert.rejects(
    () => setConferenceParticipantRole(
      client,
      'room-1',
      'user-2',
      'OWNER',
    ),
    /OWNER_ROLE_IS_TRANSFER_ONLY/,
  );
});

test('Phase 24 unit: poll transport preserves create and vote rules', async () => {
  const calls: unknown[] = [];
  const client = {
    functions: {
      invoke: async (name: string, options: unknown) => {
        calls.push([name, options]);
        return { data: { ok: true }, error: null };
      },
    },
  } as any;

  await runConferencePollAction(client, {
    roomId: 'room-1',
    question: 'Q?',
    pollType: 'MULTIPLE_CHOICE',
    options: ['A', 'B', 'C'],
    anonymous: true,
    resultVisibility: 'AFTER_CLOSE',
    timeLimitSeconds: 60,
    openImmediately: true,
  });

  await runConferencePollAction(client, {
    roomId: 'room-1',
    action: 'vote',
    pollId: 'poll-1',
    optionIds: ['opt-1', 'opt-3'],
  });

  assert.deepEqual(calls, [
    [
      'conference-poll-control',
      {
        body: {
          roomId: 'room-1',
          question: 'Q?',
          pollType: 'MULTIPLE_CHOICE',
          options: ['A', 'B', 'C'],
          anonymous: true,
          resultVisibility: 'AFTER_CLOSE',
          timeLimitSeconds: 60,
          openImmediately: true,
        },
      },
    ],
    [
      'conference-poll-control',
      {
        body: {
          roomId: 'room-1',
          action: 'vote',
          pollId: 'poll-1',
          optionIds: ['opt-1', 'opt-3'],
        },
      },
    ],
  ]);
});

test('Phase 24 unit: poll snapshot falls back safely and action errors keep server code', async () => {
  const snapshotClient = {
    rpc: async () => ({
      data: {
        ok: true,
        serverTime: '2026-08-31T09:00:00.000Z',
        canCreate: true,
        canVote: false,
        polls: 'not-an-array',
      },
      error: null,
    }),
  } as any;

  assert.deepEqual(
    await loadConferencePollSnapshot(snapshotClient, 'room-1'),
    {
      loaded: true,
      serverTime: '2026-08-31T09:00:00.000Z',
      canCreate: true,
      canVote: false,
      polls: [],
    },
  );

  const errorClient = {
    functions: {
      invoke: async () => ({
        data: { ok: false, error: 'ALREADY_VOTED' },
        error: null,
      }),
    },
  } as any;

  await assert.rejects(
    () => runConferencePollAction(errorClient, {
      roomId: 'room-1',
      action: 'vote',
      pollId: 'poll-1',
      optionIds: ['opt-1'],
    }),
    (error: unknown) => (
      error instanceof ConferencePollActionError
      && error.code === 'ALREADY_VOTED'
    ),
  );
});

test('Phase 24 unit: chat action surfaces authorization and rate-limit state', async () => {
  const calls: unknown[] = [];
  const okClient = {
    functions: {
      invoke: async (name: string, options: unknown) => {
        calls.push([name, options]);
        return { data: { ok: true, messageId: 'm1' }, error: null };
      },
    },
  } as any;

  const result = await runConferenceChatAction(okClient, {
    roomId: 'room-1',
    action: 'send',
    body: 'hello',
    mentionedUserIds: ['user-2'],
  });
  assert.equal(result.messageId, 'm1');
  assert.deepEqual(calls, [[
    'conference-chat-control',
    {
      body: {
        roomId: 'room-1',
        action: 'send',
        body: 'hello',
        mentionedUserIds: ['user-2'],
      },
    },
  ]]);

  const deniedClient = {
    functions: {
      invoke: async () => ({
        data: {
          ok: false,
          error: 'FORBIDDEN',
          retryAfterMs: 2500,
        },
        error: null,
      }),
    },
  } as any;

  await assert.rejects(
    () => runConferenceChatAction(deniedClient, {
      roomId: 'room-1',
      action: 'send',
      body: 'blocked',
    }),
    (error: unknown) => (
      error instanceof ConferenceChatActionError
      && error.code === 'FORBIDDEN'
      && error.retryAfterMs === 2500
    ),
  );
});

test('Phase 24 unit: permission catalogue has no duplicates', () => {
  assert.equal(
    new Set(CONFERENCE_PERMISSIONS).size,
    CONFERENCE_PERMISSIONS.length,
  );
});
