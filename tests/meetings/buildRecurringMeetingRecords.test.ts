import assert from 'node:assert/strict';
import test from 'node:test';
import moment from 'moment-jalaali';

import {
  buildRecurringMeetingRecords,
  type BuildRecurringMeetingRecordsInput,
  type RecurringMeetingBaseRecord,
} from '../../src/features/meetings/builders/buildRecurringMeetingRecords';

function localDate(
  year: number,
  month: number,
  day: number,
  hour = 12
): Date {
  return new Date(
    year,
    month,
    day,
    hour,
    0,
    0,
    0
  );
}

function localMidnight(
  year: number,
  month: number,
  day: number
): Date {
  return localDate(year, month, day, 0);
}

function localEndOfDay(
  year: number,
  month: number,
  day: number
): string {
  return new Date(
    year,
    month,
    day,
    23,
    59,
    59,
    999
  ).toISOString();
}

function createBaseRecord(
  requestDate: Date
): RecurringMeetingBaseRecord {
  return {
    id: 'source-meeting-id',
    subject: 'Weekly standup',
    request_date: requestDate.toISOString(),
    request_jalaali_date: moment(requestDate).format('jYYYY/jMM/jDD'),
    request_duration: '60',
    duration: '60',
    location: 'Room A',
    representative: 'Alice',
    phone: '+1-555-0100',
    notes: null,
    priority: 'normal',
    status: 'closed',
    status_type: 'internal',
    user_id: 'user-1',
    notify_users: ['user-2'],
    participant_user_ids: ['user-3'],
    external_participants: ['bob@example.com'],
    repeat_type: 'weekly',
    repeat_interval: 1,
    repeat_end_date: null,
    repeat_weekday: 0,
    reminder_minutes: 30,
    send_sms: false,
    meeting_manager: 'manager-1',
    calendar_id: 'cal-1',
    start_time: '09:00',
    end_time: '10:00',
  };
}

function createInput(
  overrides: Partial<BuildRecurringMeetingRecordsInput> = {}
): BuildRecurringMeetingRecordsInput {
  return {
    baseRecord: createBaseRecord(localDate(2026, 0, 1)),
    repeatType: 'weekly',
    repeatInterval: 1,
    repeatEndDate: localEndOfDay(2026, 0, 31),
    repeatWeekday: 0,
    repeatMonthlyMode: 'specific',
    repeatMonthlyWeekday: 0,
    ...overrides,
  };
}

test('returns no records for an invalid end date', () => {
  const input = createInput({ repeatEndDate: 'not-a-date' });
  const result = buildRecurringMeetingRecords(input);
  assert.deepEqual(result, []);
});

test('generates weekly Saturday records in legacy order', () => {
  const baseDate = localDate(2026, 0, 1);
  const input = createInput({
    baseRecord: createBaseRecord(baseDate),
    repeatType: 'weekly',
    repeatWeekday: 0,
    repeatInterval: 1,
    repeatEndDate: localEndOfDay(2026, 0, 17),
  });

  const serializedBaseRecord =
    JSON.stringify(input.baseRecord);

  const expectedDates = [
    localDate(2026, 0, 3),
    localDate(2026, 0, 10),
    localDate(2026, 0, 17),
  ];

  const result = buildRecurringMeetingRecords(input);

  assert.equal(result.length, expectedDates.length);

  const expectedRequestDates = expectedDates.map((d) => d.toISOString());
  const actualRequestDates = result.map((r) => r.request_date);
  assert.deepEqual(actualRequestDates, expectedRequestDates);

  for (const record of result) {
    assert.equal(record.status, 'open');
    assert.equal('id' in record, false);
    assert.equal(record.subject, 'Weekly standup');
    assert.deepEqual(record.notify_users, ['user-2']);
    assert.deepEqual(record.participant_user_ids, ['user-3']);
    assert.deepEqual(record.external_participants, ['bob@example.com']);
    assert.equal(record.start_time, '09:00');
    assert.equal(record.end_time, '10:00');
  }

  const expectedJalaali = expectedDates.map((d) =>
    moment(d).format('jYYYY/jMM/jDD')
  );
  const actualJalaali = result.map((r) => r.request_jalaali_date);
  assert.deepEqual(actualJalaali, expectedJalaali);

  assert.equal(
    JSON.stringify(input.baseRecord),
    serializedBaseRecord
  );

  assert.equal(
    input.baseRecord.status,
    'closed',
    'base record was mutated'
  );
  assert.equal(
    input.baseRecord.id,
    'source-meeting-id',
    'base record id was removed'
  );
});

test('preserves JavaScript Date rollover for monthly specific dates', () => {
  const baseDate = localDate(2026, 0, 31);
  const input = createInput({
    baseRecord: createBaseRecord(baseDate),
    repeatType: 'monthly',
    repeatMonthlyMode: 'specific',
    repeatInterval: 1,
    repeatEndDate: localEndOfDay(2026, 3, 30),
  });

  const expectedDates = [
    localMidnight(2026, 2, 3),
    localMidnight(2026, 2, 31),
  ];

  const result = buildRecurringMeetingRecords(input);

  assert.equal(result.length, expectedDates.length);

  const expectedRequestDates = expectedDates.map((d) => d.toISOString());
  const actualRequestDates = result.map((r) => r.request_date);
  assert.deepEqual(actualRequestDates, expectedRequestDates);
});

test('generates the first Saturday of each following month', () => {
  const baseDate = localDate(2026, 0, 15);
  const input = createInput({
    baseRecord: createBaseRecord(baseDate),
    repeatType: 'monthly',
    repeatMonthlyMode: 'first',
    repeatMonthlyWeekday: 0,
    repeatInterval: 1,
    repeatEndDate: localEndOfDay(2026, 3, 30),
  });

  const expectedDates = [
    localMidnight(2026, 1, 7),
    localMidnight(2026, 2, 7),
    localMidnight(2026, 3, 4),
  ];

  const result = buildRecurringMeetingRecords(input);

  assert.equal(result.length, expectedDates.length);

  const expectedRequestDates = expectedDates.map((d) => d.toISOString());
  const actualRequestDates = result.map((r) => r.request_date);
  assert.deepEqual(actualRequestDates, expectedRequestDates);
});

test('generates the last Saturday of each following month', () => {
  const baseDate = localDate(2026, 0, 15);
  const input = createInput({
    baseRecord: createBaseRecord(baseDate),
    repeatType: 'monthly',
    repeatMonthlyMode: 'last',
    repeatMonthlyWeekday: 0,
    repeatInterval: 1,
    repeatEndDate: localEndOfDay(2026, 3, 30),
  });

  const expectedDates = [
    localMidnight(2026, 1, 28),
    localMidnight(2026, 2, 28),
    localMidnight(2026, 3, 25),
  ];

  const result = buildRecurringMeetingRecords(input);

  assert.equal(result.length, expectedDates.length);

  const expectedRequestDates = expectedDates.map((d) => d.toISOString());
  const actualRequestDates = result.map((r) => r.request_date);
  assert.deepEqual(actualRequestDates, expectedRequestDates);
});

test('uses the Jalali repeat end date through its local end of day', () => {
  const baseDate = moment('1404/01/01', 'jYYYY/jMM/jDD').toDate();
  baseDate.setHours(12, 0, 0, 0);

  const input = createInput({
    baseRecord: createBaseRecord(baseDate),
    repeatType: 'weekly',
    repeatWeekday: 0,
    repeatInterval: 1,
    repeatEndDate: '1404/01/15',
  });

  const dayAfter = new Date(baseDate);
  dayAfter.setDate(dayAfter.getDate() + 1);
  const dayPlusEight = new Date(baseDate);
  dayPlusEight.setDate(dayPlusEight.getDate() + 8);

  const expectedDates = [dayAfter, dayPlusEight];

  const result = buildRecurringMeetingRecords(input);

  assert.equal(result.length, expectedDates.length);

  const expectedRequestDates = expectedDates.map((d) => d.toISOString());
  const actualRequestDates = result.map((r) => r.request_date);
  assert.deepEqual(actualRequestDates, expectedRequestDates);
});
