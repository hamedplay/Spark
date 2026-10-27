import assert from 'node:assert/strict';
import test from 'node:test';
import { meetingLocalDate } from '../../src/features/meetings/meetingLocalDate';

test('date-only values and Tehran-midnight UTC timestamps identify the same day', () => {
  assert.equal(meetingLocalDate('2026-10-28'), '2026-10-28');
  assert.equal(meetingLocalDate('2026-10-27T20:30:00.000Z'), '2026-10-28');
  assert.equal(meetingLocalDate('2026-10-28T00:00:00+03:30'), '2026-10-28');
  assert.equal(meetingLocalDate('2026-10-27T20:29:59.000Z'), '2026-10-27');
});

test('invalid timestamps fail instead of producing a wrong filter', () => {
  assert.throws(() => meetingLocalDate('not a date'));
});
