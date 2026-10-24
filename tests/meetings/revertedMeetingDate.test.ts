import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRevertedMeetingTiming } from '../../src/features/meetings/builders/buildRevertedMeetingTiming';
import { formatMeetingRequestDate } from '../../src/features/meetings/formatMeetingRequestDate';

test('reverting preserves the requested day separately while removing the calendar schedule', () => {
  const source = { request_date: '2026-10-23T20:30:00.000Z', request_jalaali_date: '1405/08/02' };
  assert.deepEqual(buildRevertedMeetingTiming(source), {
    request_date: null, request_jalaali_date: '1405/08/02',
    start_time: null, end_time: null, duration: null,
  });
  assert.deepEqual(source, { request_date: '2026-10-23T20:30:00.000Z', request_jalaali_date: '1405/08/02' });
});

test('legacy missing dates stay unknown rather than becoming today or 1970', () => {
  assert.equal(buildRevertedMeetingTiming({}).request_date, null);
  for (const date of [null, undefined, '', 'invalid-date']) {
    assert.equal(formatMeetingRequestDate(date), '—');
  }
});

test('valid stored Jalali date survives even when a legacy timestamp is missing', () => {
  assert.equal(formatMeetingRequestDate(null, '1405/08/02'), '۱۴۰۵/۰۸/۰۲');
});

test('Tehran midnight is rendered on the same day in different browser time zones', () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tehran']) {
      process.env.TZ = zone;
      assert.equal(formatMeetingRequestDate('2026-10-23T20:30:00.000Z'), '۱۴۰۵/۰۸/۰۲');
      assert.equal(formatMeetingRequestDate('2026-10-24'), '۱۴۰۵/۰۸/۰۲');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('invalid stored date falls back to the valid original timestamp', () => {
  assert.equal(formatMeetingRequestDate('2026-10-23T20:30:00.000Z', 'invalid'), '۱۴۰۵/۰۸/۰۲');
});

test('legacy scheduled meetings without a saved Jalali date retain their Tehran day', () => {
  const timing = buildRevertedMeetingTiming({ request_date: '2026-10-23T20:30:00.000Z' });
  assert.equal(timing.request_date, null);
  assert.equal(timing.request_jalaali_date, '1405/08/02');
  assert.equal(formatMeetingRequestDate(timing.request_date, timing.request_jalaali_date), '۱۴۰۵/۰۸/۰۲');
});
