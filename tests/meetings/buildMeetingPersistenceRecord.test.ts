import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMeetingPersistenceRecord,
  type BuildMeetingPersistenceRecordInput,
} from '../../src/features/meetings/builders/buildMeetingPersistenceRecord';

function createInput(
  overrides: Partial<BuildMeetingPersistenceRecordInput> = {}
): BuildMeetingPersistenceRecordInput {
  return {
    subject: 'Design review',

    gregorianRequestDate: '2026-08-10T08:00:00.000Z',

    requestJalaaliDate: '1405/05/19',
    requestDuration: '1 ساعت',

    location: 'Room A',
    representative: 'Ali',
    phone: '09120000000',
    notes: '',

    priority: 'medium',
    statusType: 'requested',
    userId: 'owner-1',

    notifyUserIds: ['notify-1'],

    participantUserIds: ['participant-1'],

    externalParticipants: ['external@example.com'],

    repeatEnabled: false,
    repeatType: 'weekly',
    repeatInterval: 2,
    repeatEndDate: '1405/06/01',
    repeatWeekday: 0,

    reminderMinutes: 0,
    meetingManager: '',
    calendarId: '',

    isSchedulingFromCalendar: false,
    startTime: '',
    endTime: '',
    ...overrides,
  };
}

test('builds the legacy manual-request record', () => {
  const input = createInput();
  const result = buildMeetingPersistenceRecord(input);

  assert.deepEqual(result, {
    subject: 'Design review',

    request_date: '2026-08-10T08:00:00.000Z',

    request_jalaali_date: '1405/05/19',

    request_duration: '1 ساعت',
    duration: '1 ساعت',

    location: 'Room A',
    representative: 'Ali',
    phone: '09120000000',
    notes: null,

    priority: 'medium',
    status: 'open',
    status_type: 'requested',
    user_id: 'owner-1',

    notify_users: ['owner-1', 'notify-1'],

    participant_user_ids: ['participant-1'],

    external_participants: ['external@example.com'],

    repeat_type: 'none',
    repeat_interval: null,
    repeat_end_date: null,
    repeat_weekday: null,

    reminder_minutes: null,
    send_sms: false,
    meeting_manager: null,
    calendar_id: null,
  });
});

test('builds a closed calendar-scheduled record with a time-range duration', () => {
  const input = createInput({
    isSchedulingFromCalendar: true,
    startTime: '09:00',
    endTime: '10:30',
  });
  const result = buildMeetingPersistenceRecord(input);

  assert.equal(result.status, 'closed');
  assert.equal(result.duration, '09:00 - 10:30');
  assert.equal(result.start_time, '09:00');
  assert.equal(result.end_time, '10:30');

  assert.equal(result.subject, 'Design review');
  assert.equal(result.request_date, '2026-08-10T08:00:00.000Z');
  assert.equal(result.request_jalaali_date, '1405/05/19');
  assert.equal(result.request_duration, '1 ساعت');
  assert.equal(result.location, 'Room A');
  assert.equal(result.representative, 'Ali');
  assert.equal(result.phone, '09120000000');
  assert.equal(result.priority, 'medium');
  assert.equal(result.status_type, 'requested');
  assert.equal(result.user_id, 'owner-1');
  assert.deepEqual(result.notify_users, ['owner-1', 'notify-1']);
  assert.deepEqual(result.participant_user_ids, ['participant-1']);
  assert.deepEqual(result.external_participants, ['external@example.com']);
});

test('preserves optional times without changing manual duration or status', () => {
  const input = createInput({
    isSchedulingFromCalendar: false,
    startTime: '11:00',
    endTime: '12:00',
  });
  const result = buildMeetingPersistenceRecord(input);

  assert.equal(result.status, 'open');
  assert.equal(result.duration, '1 ساعت');
  assert.equal(result.start_time, '11:00');
  assert.equal(result.end_time, '12:00');
});

test('falls back to request duration when the calendar time pair is incomplete', () => {
  const input = createInput({
    isSchedulingFromCalendar: true,
    startTime: '09:00',
    endTime: '',
  });
  const result = buildMeetingPersistenceRecord(input);

  assert.equal(result.status, 'closed');
  assert.equal(result.duration, '1 ساعت');
  assert.ok(!('start_time' in result));
  assert.ok(!('end_time' in result));
});

test('deduplicates notification users in legacy insertion order without mutating input', () => {
  const input = createInput({
    notifyUserIds: ['notify-2', 'owner-1', 'notify-2', 'notify-3'],
  });
  const serializedInput = JSON.stringify(input);

  const result = buildMeetingPersistenceRecord(input);

  assert.deepEqual(result.notify_users, ['owner-1', 'notify-2', 'notify-3']);
  assert.equal(JSON.stringify(input), serializedInput);

  assert.deepEqual(result.participant_user_ids, ['participant-1']);
  assert.deepEqual(result.external_participants, ['external@example.com']);
});

test('maps enabled weekly and monthly repeat fields with legacy nullability', () => {
  const weeklyResult = buildMeetingPersistenceRecord(
    createInput({
      repeatEnabled: true,
      repeatType: 'weekly',
      repeatInterval: 2,
      repeatEndDate: '1405/06/01',
      repeatWeekday: 4,
    })
  );

  assert.equal(weeklyResult.repeat_type, 'weekly');
  assert.equal(weeklyResult.repeat_interval, 2);
  assert.equal(weeklyResult.repeat_end_date, '1405/06/01');
  assert.equal(weeklyResult.repeat_weekday, 4);

  const monthlyResult = buildMeetingPersistenceRecord(
    createInput({
      repeatEnabled: true,
      repeatType: 'monthly',
      repeatInterval: 3,
      repeatEndDate: '1405/08/01',
      repeatWeekday: 4,

      notes: 'Follow-up notes',
      reminderMinutes: 30,
      meetingManager: 'manager-1',
      calendarId: 'calendar-1',
    })
  );

  assert.equal(monthlyResult.repeat_type, 'monthly');
  assert.equal(monthlyResult.repeat_interval, 3);
  assert.equal(monthlyResult.repeat_end_date, '1405/08/01');
  assert.equal(monthlyResult.repeat_weekday, null);

  assert.equal(monthlyResult.notes, 'Follow-up notes');
  assert.equal(monthlyResult.reminder_minutes, 30);
  assert.equal(monthlyResult.meeting_manager, 'manager-1');
  assert.equal(monthlyResult.calendar_id, 'calendar-1');
  assert.equal(monthlyResult.send_sms, false);
});
