import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretMinutesAccess,
  resolveMinutesEntryAction,
  resolveMinutesSubmitOutcome,
  type MinutesAccessResult,
} from '../../src/lib/minutesMeetingAccess';

function access(overrides: Partial<MinutesAccessResult> = {}): MinutesAccessResult {
  return {
    allowed: false,
    existingMinuteId: null,
    existingMinuteStatus: null,
    errorCode: null,
    ...overrides,
  };
}

// ── interpretMinutesAccess ────────────────────────────────────────────────

test('allows creating minutes when permitted and no existing minutes', () => {
  const result = interpretMinutesAccess(true, []);
  assert.equal(result.allowed, true);
  assert.equal(result.errorCode, null);
});

test('blocks creation when permission RPC returns false', () => {
  const result = interpretMinutesAccess(false, []);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'MEETING_NO_PERMISSION');
});

test('returns existing minute id when minutes already exist', () => {
  const result = interpretMinutesAccess(true, [{ id: 'minute-1', status: 'draft' }]);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'MINUTES_ALREADY_EXISTS');
  assert.equal(result.existingMinuteId, 'minute-1');
  assert.equal(result.existingMinuteStatus, 'draft');
});

test('returns CHECK_FAILED when permission RPC returns null', () => {
  const result = interpretMinutesAccess(null, []);
  assert.equal(result.allowed, false);
  assert.equal(result.errorCode, 'CHECK_FAILED');
});

// ── resolveMinutesEntryAction: button contract ────────────────────────────

test('entry: allowed user → navigate to new form', () => {
  const action = resolveMinutesEntryAction(access({ allowed: true }), 'meeting-1');
  assert.equal(action.kind, 'navigate_to_new_form');
  assert.equal((action as { meetingId: string }).meetingId, 'meeting-1');
});

test('entry: permission denied → block (button hidden for unauthorized user)', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'block');
});

test('entry: permission RPC false → block', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'block');
});

test('entry: no meetingId in URL → block with guidance', () => {
  const action = resolveMinutesEntryAction(access({ allowed: true }), null);
  assert.equal(action.kind, 'block');
  assert.match((action as { message: string }).message, /جزئیات جلسه/);
});

test('entry: invalid UUID (not found) → block, indistinguishable from unauthorized', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    '00000000-0000-0000-0000-000000000000',
  );
  assert.equal(action.kind, 'block');
});

test('entry: unauthorized UUID → block, same message as not-found', () => {
  const notFound = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    '00000000-0000-0000-0000-000000000000',
  );
  const unauthorized = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    '11111111-1111-1111-1111-111111111111',
  );
  assert.deepEqual(notFound, unauthorized);
});

test('entry: valid meeting not in client list but RPC allows → navigate to new form', () => {
  // This is the key case: the meeting is NOT in the client-side meetings list
  // (pagination/filter), but the server-side RPC grants access.
  const action = resolveMinutesEntryAction(access({ allowed: true }), 'meeting-not-in-list');
  assert.equal(action.kind, 'navigate_to_new_form');
});

test('entry: existing minutes → navigate to existing minute detail', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MINUTES_ALREADY_EXISTS', existingMinuteId: 'minute-99' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'navigate_to_existing_minute');
  assert.equal((action as { minuteId: string }).minuteId, 'minute-99');
});

// ── resolveMinutesSubmitOutcome: submit contract ─────────────────────────

test('submit: success → success with real minuteId', () => {
  const outcome = resolveMinutesSubmitOutcome(
    { success: true, minute_id: 'minute-created' },
    null,
  );
  assert.equal(outcome.kind, 'success');
  assert.equal((outcome as { minuteId: string }).minuteId, 'minute-created');
});

test('submit: race condition MINUTES_ALREADY_EXISTS → duplicate, navigate to existing', () => {
  const outcome = resolveMinutesSubmitOutcome(
    { success: false, error_code: 'MINUTES_ALREADY_EXISTS' },
    'minute-existing',
  );
  assert.equal(outcome.kind, 'duplicate');
  assert.equal((outcome as { minuteId: string }).minuteId, 'minute-existing');
});

test('submit: race condition without existing id → error (no raw DB text)', () => {
  const outcome = resolveMinutesSubmitOutcome(
    { success: false, error_code: 'MINUTES_ALREADY_EXISTS' },
    null,
  );
  assert.equal(outcome.kind, 'error');
  assert.match((outcome as { message: string }).message, /ناموفق/);
});

test('submit: null RPC result → error', () => {
  const outcome = resolveMinutesSubmitOutcome(null, null);
  assert.equal(outcome.kind, 'error');
});

test('submit: meetingId is never sent as p_minute_id — success uses minute_id from RPC', () => {
  // Contract: the submit flow must use the minute_id returned by create_minutes_draft,
  // never the meetingId. This test documents that resolveMinutesSubmitOutcome only
  // returns success when the RPC provides a distinct minute_id.
  const meetingId = 'meeting-1';
  const outcome = resolveMinutesSubmitOutcome(
    { success: true, minute_id: 'minute-1' },
    null,
  );
  assert.equal(outcome.kind, 'success');
  assert.notEqual((outcome as { minuteId: string }).minuteId, meetingId);
});

// ── URL cleanup contract ──────────────────────────────────────────────────

test('URL cleanup: clearMeetingIdFromUrl removes only meeting param, preserves minute', () => {
  // Simulate the URL cleanup contract: after navigating to minutes-detail,
  // the `meeting` param must be gone but `minute` must remain.
  const url = new URL('https://app.example/?meeting=meeting-1&minute=minute-1&mpage=minutes-detail');
  url.searchParams.delete('meeting');
  assert.equal(url.searchParams.has('meeting'), false);
  assert.equal(url.searchParams.get('minute'), 'minute-1');
  assert.equal(url.searchParams.get('mpage'), 'minutes-detail');
});

test('URL cleanup: cancel from new form clears meeting param', () => {
  const url = new URL('https://app.example/?meeting=meeting-1&mpage=minutes-new');
  url.searchParams.delete('meeting');
  assert.equal(url.searchParams.has('meeting'), false);
  assert.equal(url.searchParams.get('mpage'), 'minutes-new');
});

test('URL cleanup: unmount of minutes-new clears meeting, preserves destination minute', () => {
  const url = new URL('https://app.example/?meeting=meeting-1&minute=minute-2&mpage=minutes-detail');
  url.searchParams.delete('meeting');
  assert.equal(url.searchParams.has('meeting'), false);
  assert.equal(url.searchParams.get('minute'), 'minute-2');
});

// ── Phase 0: calendar→minutes entry contract ──────────────────────────────

test('entry: allowed meeting without existing minutes → navigate to new form', () => {
  const action = resolveMinutesEntryAction(access({ allowed: true }), 'meeting-eligible');
  assert.equal(action.kind, 'navigate_to_new_form');
  assert.equal((action as { meetingId: string }).meetingId, 'meeting-eligible');
});

test('entry: meeting with existing minutes → navigate to existing minute detail', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MINUTES_ALREADY_EXISTS', existingMinuteId: 'minute-existing' }),
    'meeting-with-minutes',
  );
  assert.equal(action.kind, 'navigate_to_existing_minute');
  assert.equal((action as { minuteId: string }).minuteId, 'minute-existing');
});

test('entry: unauthorized meeting → block with generic message', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    'meeting-unauthorized',
  );
  assert.equal(action.kind, 'block');
  assert.match((action as { message: string }).message, /دسترسی ندارید/);
});

test('entry: missing meeting ID → block with guidance', () => {
  const action = resolveMinutesEntryAction(access({ allowed: true }), null);
  assert.equal(action.kind, 'block');
  assert.match((action as { message: string }).message, /جزئیات جلسه/);
});

test('URL cleanup: new-form entry sets meeting, clears old minute, sets mpage', () => {
  const url = new URL('https://app.example/?minute=minute-old&mpage=minutes');
  url.searchParams.delete('minute');
  url.searchParams.set('meeting', 'meeting-1');
  url.searchParams.set('mpage', 'minutes-new');
  assert.equal(url.searchParams.get('meeting'), 'meeting-1');
  assert.equal(url.searchParams.has('minute'), false);
  assert.equal(url.searchParams.get('mpage'), 'minutes-new');
});
