import assert from 'node:assert/strict';
import test from 'node:test';
import { quickNoteReminder, reminderDateTime, validateNoteReminder } from '../../src/components/Notes/reminderTime';

test('two days later preserves local time across month boundaries', () => {
  const now = new Date(2026, 0, 30, 14, 35, 42);
  const reminder = quickNoteReminder(2, now);
  assert.deepEqual(reminderDateTime(reminder), { date: '2026-02-01', time: '14:35' });
  assert.equal(new Date(reminder).getSeconds(), 0);
  assert.equal(now.getDate(), 30);
});

test('UTC storage round-trips into the chosen local date and time', () => {
  const selected = new Date('2026-11-06T16:45:00');
  assert.deepEqual(reminderDateTime(selected.toISOString()), { date: '2026-11-06', time: '16:45' });
});

test('past, invalid and current timestamps cannot schedule a new reminder', () => {
  const now = Date.parse('2026-11-04T12:00:00Z');
  for (const value of ['invalid', '2026-11-03T12:00:00Z', '2026-11-04T12:00:00Z']) {
    assert.throws(() => validateNoteReminder(value, null, now));
  }
  assert.doesNotThrow(() => validateNoteReminder('2026-11-06T12:00:00Z', null, now));
});

test('cancel and text-only edits preserve already delivered reminder semantics', () => {
  const past = '2026-11-01T12:00:00Z';
  assert.doesNotThrow(() => validateNoteReminder(null));
  assert.doesNotThrow(() => validateNoteReminder(past, past));
  assert.throws(() => validateNoteReminder(past, '2026-11-02T12:00:00Z'));
});
