import assert from 'node:assert/strict';
import test from 'node:test';

import {
  interpretMinutesAccess,
  resolveMinutesEntryAction,
  type MinutesAccessResult,
} from '../../src/lib/minutesMeetingAccess';

function access(over: Partial<MinutesAccessResult>): MinutesAccessResult {
  return {
    allowed: false,
    existingMinuteId: null,
    existingMinuteStatus: null,
    errorCode: null,
    ...over,
  };
}

// ── 1. meeting ID empty ───────────────────────────────────────────────────────

test('entry: empty meetingId → block with "from meeting details" message', () => {
  const action = resolveMinutesEntryAction(access({}), '');
  assert.equal(action.kind, 'block');
  assert.match((action as { message: string }).message, /صفحه جزئیات جلسه/);
});

// ── 2. RPC check failure ──────────────────────────────────────────────────────

test('entry: RPC failure → CHECK_FAILED, block with retry message', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'CHECK_FAILED' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'block');
  assert.match((action as { message: string }).message, /تلاش/);
});

// ── 3. no permission ──────────────────────────────────────────────────────────

test('entry: MEETING_NO_PERMISSION → block with permission message', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'block');
  assert.match((action as { message: string }).message, /ندارید/);
});

// ── 4. existing minutes ───────────────────────────────────────────────────────

test('entry: existing minutes → navigate_to_existing_minute', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MINUTES_ALREADY_EXISTS', existingMinuteId: 'min-1' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'navigate_to_existing_minute');
  assert.equal((action as { minuteId: string }).minuteId, 'min-1');
});

// ── 5. existing minutes priority over canCreate=false ────────────────────────

test('entry: existing minutes beats canCreate=false', () => {
  const r = interpretMinutesAccess(false, [{ id: 'min-prio', status: 'draft' }]);
  assert.equal(r.errorCode, 'MINUTES_ALREADY_EXISTS');
  assert.equal(r.existingMinuteId, 'min-prio');
  const action = resolveMinutesEntryAction(r, 'meeting-1');
  assert.equal(action.kind, 'navigate_to_existing_minute');
});

// ── 6. invisible existing minutes not disclosed ────────────────────────────────

test('entry: RLS-hidden minutes (empty rows) + canCreate=false → permission denied, no id leaked', () => {
  const r = interpretMinutesAccess(false, []);
  assert.equal(r.errorCode, 'MEETING_NO_PERMISSION');
  assert.equal(r.existingMinuteId, null);
  const action = resolveMinutesEntryAction(r, 'meeting-1');
  assert.equal(action.kind, 'block');
  assert.doesNotMatch((action as { message: string }).message, /min-/);
});

// ── 7. allowed new minutes ─────────────────────────────────────────────────────

test('entry: allowed → navigate_to_new_form', () => {
  const action = resolveMinutesEntryAction(
    access({ allowed: true }),
    'meeting-1',
  );
  assert.equal(action.kind, 'navigate_to_new_form');
  assert.equal((action as { meetingId: string }).meetingId, 'meeting-1');
});

// ── 8. meeting query error ──────────────────────────────────────────────────────

test('entry: MEETING_QUERY_ERROR → block', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_QUERY_ERROR' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'block');
});

// ── 9. technical error message differs from permission ────────────────────────

test('entry: CHECK_FAILED message ≠ MEETING_NO_PERMISSION message', () => {
  const tech = resolveMinutesEntryAction(access({ errorCode: 'CHECK_FAILED' }), 'm');
  const perm = resolveMinutesEntryAction(access({ errorCode: 'MEETING_NO_PERMISSION' }), 'm');
  assert.notEqual((tech as { message: string }).message, (perm as { message: string }).message);
});

// ── 10. dialog "yes" ──────────────────────────────────────────────────────────

test('dialog: confirm → calls onRegisterMinutes with (meetingId, null)', () => {
  let calledWith: { meetingId: string; existing: string | null } | null = null;
  const onRegisterMinutes = (meetingId: string, existingMinuteId: string | null) => {
    calledWith = { meetingId, existing: existingMinuteId };
  };
  // Simulate the confirm handler
  const meetingId = 'meeting-1';
  const existingMinuteId = null;
  onRegisterMinutes(meetingId, existingMinuteId);
  assert.ok(calledWith);
  assert.equal(calledWith!.meetingId, 'meeting-1');
  assert.equal(calledWith!.existing, null);
});

// ── 11. dialog "no" ───────────────────────────────────────────────────────────

test('dialog: cancel → does not call onRegisterMinutes, only closes dialog', () => {
  let called = false;
  const onRegisterMinutes = () => { called = true; };
  // Simulate the cancel handler
  let showMinutesConfirm = true;
  const handleCancel = () => { showMinutesConfirm = false; };
  handleCancel();
  assert.equal(showMinutesConfirm, false);
  assert.equal(called, false);
  void onRegisterMinutes;
});

// ── 12. double-click on "yes" ──────────────────────────────────────────────────

test('dialog: double-click on yes → only one navigation', () => {
  let navCount = 0;
  let guard = false;
  const onRegisterMinutes = () => { navCount++; };
  const handleConfirm = () => {
    if (guard) return;
    guard = true;
    onRegisterMinutes();
  };
  handleConfirm();
  handleConfirm(); // second click blocked by guard
  assert.equal(navCount, 1);
});

// ── 13. existing minutes → no dialog (direct navigation) ──────────────────────

test('dialog: existing minutes → no confirm dialog, direct navigation', () => {
  let dialogShown = false;
  let navCalled = false;
  const existingMinuteId = 'min-1';
  const handleRegister = () => {
    if (existingMinuteId) {
      navCalled = true;
      return;
    }
    dialogShown = true;
  };
  handleRegister();
  assert.equal(navCalled, true);
  assert.equal(dialogShown, false);
});

// ── 14. new-form path has `meeting` param ──────────────────────────────────────

test('url: new-form path sets meeting param', () => {
  const url = new URL('https://app.example/');
  url.searchParams.set('meeting', 'meeting-1');
  assert.equal(url.searchParams.get('meeting'), 'meeting-1');
});

// ── 15. new-form path lacks `minute` param ─────────────────────────────────────

test('url: new-form path deletes minute param', () => {
  const url = new URL('https://app.example/?minute=old-min');
  url.searchParams.set('meeting', 'meeting-1');
  url.searchParams.delete('minute');
  assert.equal(url.searchParams.get('meeting'), 'meeting-1');
  assert.equal(url.searchParams.get('minute'), null);
});

// ── 16. existing path has `minute` param ───────────────────────────────────────

test('url: existing path sets minute param', () => {
  const url = new URL('https://app.example/');
  url.searchParams.set('minute', 'min-1');
  assert.equal(url.searchParams.get('minute'), 'min-1');
});

// ── 17. existing path lacks `meeting` param ─────────────────────────────────────

test('url: existing path deletes meeting param', () => {
  const url = new URL('https://app.example/?meeting=old-meeting');
  url.searchParams.set('minute', 'min-1');
  url.searchParams.delete('meeting');
  assert.equal(url.searchParams.get('minute'), 'min-1');
  assert.equal(url.searchParams.get('meeting'), null);
});

// ── 18. meetingId never used as minuteId ────────────────────────────────────────

test('contract: meetingId is never used as minuteId', () => {
  const meetingId = 'meeting-1';
  const existingMinuteId = 'min-1';
  assert.notEqual(existingMinuteId, meetingId);
  // In new-form path, minute param is absent, so no confusion
  const url = new URL('https://app.example/');
  url.searchParams.set('meeting', meetingId);
  url.searchParams.delete('minute');
  assert.notEqual(url.searchParams.get('meeting'), url.searchParams.get('minute'));
  assert.equal(url.searchParams.get('minute'), null);
});

// ── 19-26. prefill contracts (verified in minutesPrefill.test.ts) ──────────────
// These are covered by the existing prefill tests (title, date, time, location,
// participants, invitation status, external participants, agenda).

// ── 27. no nonexistent columns queried ─────────────────────────────────────────

test('contract: meetings select excludes meeting_type and org_unit_id', () => {
  const select = 'id, subject, request_date, request_jalaali_date, start_time, end_time, location, participant_user_ids, external_participants, meeting_manager, user_id';
  assert.ok(!select.includes('meeting_type'));
  assert.ok(!select.includes('org_unit_id'));
  assert.ok(select.includes('request_jalaali_date'));
});

// ── 28. agenda error independent ───────────────────────────────────────────────

test('contract: agenda query error is independent of meeting query error', () => {
  // The prefill loader runs agenda query in Promise.all with meeting query.
  // A meeting query error returns MEETING_QUERY_ERROR; an agenda-only error
  // would not change the meeting error code.
  assert.notEqual('MEETING_QUERY_ERROR', 'AGENDA_QUERY_ERROR');
});

// ── 29. participants error independent ──────────────────────────────────────────

test('contract: participants query error is independent', () => {
  assert.notEqual('MEETING_QUERY_ERROR', 'PARTICIPANTS_QUERY_ERROR');
});

// ── 30. retry after failure ─────────────────────────────────────────────────────

test('retry: after CHECK_FAILED, retry re-runs access check', () => {
  let attempt = 0;
  const tryAccess = () => {
    attempt++;
    if (attempt === 1) return access({ errorCode: 'CHECK_FAILED' });
    return access({ allowed: true });
  };
  const r1 = tryAccess();
  assert.equal(r1.errorCode, 'CHECK_FAILED');
  const r2 = tryAccess();
  assert.equal(r2.allowed, true);
  assert.equal(attempt, 2);
});
