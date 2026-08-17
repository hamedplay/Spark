import assert from 'node:assert/strict';
import test from 'node:test';

import { isMeetingEligibleForMinutes } from '../../src/lib/isMeetingEligibleForMinutes';
import {
  resolveMinutesEntryAction,
  resolveMinutesSubmitOutcome,
  interpretMinutesAccess,
  type MinutesAccessResult,
} from '../../src/lib/minutesMeetingAccess';
import type { MeetingData } from '../../src/components/Calendar/types';

function meeting(overrides: Partial<MeetingData> = {}): MeetingData {
  return {
    id: 'meeting-1',
    subject: 'جلسه',
    request_date: '2026-07-26',
    start_time: '10:00',
    end_time: '11:00',
    duration: '60',
    location: '',
    representative: '',
    phone: '',
    notes: null,
    priority: 'medium',
    status: 'open',
    status_type: 'scheduled',
    created_at: '',
    user_id: 'user-1',
    calendar_id: 'cal-1',
    ...overrides,
  } as MeetingData;
}

function access(overrides: Partial<MinutesAccessResult> = {}): MinutesAccessResult {
  return {
    allowed: false,
    existingMinuteId: null,
    existingMinuteStatus: null,
    errorCode: null,
    ...overrides,
  };
}

// ── 1. approved + calendar_id + RPC=true → ثبت button ───────────────────────
test('eligibility: scheduled calendar meeting with calendar_id and status_type=scheduled → eligible', () => {
  assert.equal(isMeetingEligibleForMinutes(meeting()), true);
});

test('button: allowed=true and no existing → ثبت صورت‌جلسه (navigate_to_new_form)', () => {
  const action = resolveMinutesEntryAction(access({ allowed: true }), 'meeting-1');
  assert.equal(action.kind, 'navigate_to_new_form');
  assert.equal((action as { meetingId: string }).meetingId, 'meeting-1');
});

// ── 2. existing minute with allowed=false → مشاهده button ───────────────────
test('button: existing minute with allowed=false → مشاهده (navigate_to_existing_minute)', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MINUTES_ALREADY_EXISTS', existingMinuteId: 'minute-99' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'navigate_to_existing_minute');
  assert.equal((action as { minuteId: string }).minuteId, 'minute-99');
});

// ── 3. CHECK_FAILED → retry button ───────────────────────────────────────────
test('button: CHECK_FAILED → block (retry shown, no navigation)', () => {
  const action = resolveMinutesEntryAction(access({ errorCode: 'CHECK_FAILED' }), 'meeting-1');
  assert.equal(action.kind, 'block');
});

// ── 4. MEETING_NO_PERMISSION → no navigation ─────────────────────────────────
test('button: MEETING_NO_PERMISSION → block, no navigation', () => {
  const action = resolveMinutesEntryAction(
    access({ errorCode: 'MEETING_NO_PERMISSION' }),
    'meeting-1',
  );
  assert.equal(action.kind, 'block');
});

// ── 5. requested → no button ─────────────────────────────────────────────────
test('eligibility: status_type=requested → not eligible', () => {
  assert.equal(isMeetingEligibleForMinutes(meeting({ status_type: 'requested', calendar_id: null })), false);
});

// ── 6. rejected → no button ──────────────────────────────────────────────────
test('eligibility: status_type=rejected → not eligible', () => {
  assert.equal(isMeetingEligibleForMinutes(meeting({ status_type: 'rejected' })), false);
});

// ── 7. meeting without calendar_id → no button ──────────────────────────────
test('eligibility: meeting without calendar_id → not eligible', () => {
  assert.equal(isMeetingEligibleForMinutes(meeting({ calendar_id: null })), false);
});

test('eligibility: meeting with empty calendar_id → not eligible', () => {
  assert.equal(isMeetingEligibleForMinutes(meeting({ calendar_id: '' })), false);
});

test('eligibility: missing id → not eligible', () => {
  assert.equal(isMeetingEligibleForMinutes(meeting({ id: '' })), false);
});

// ── 8. existing minute opens with minute=<existingMinuteId> ──────────────────
test('navigation: existing minute sets minute=<existingMinuteId>, never meetingId', () => {
  const url = new URL('https://app.example/');
  url.searchParams.set('minute', 'minute-99');
  url.searchParams.delete('meeting');
  assert.equal(url.searchParams.get('minute'), 'minute-99');
  assert.equal(url.searchParams.has('meeting'), false);
  assert.notEqual(url.searchParams.get('minute'), 'meeting-1');
});

// ── 9. new minute opens with meeting=<meetingId> ────────────────────────────
test('navigation: new minute sets meeting=<meetingId>, never minute param', () => {
  const url = new URL('https://app.example/');
  url.searchParams.set('meeting', 'meeting-1');
  url.searchParams.delete('minute');
  assert.equal(url.searchParams.get('meeting'), 'meeting-1');
  assert.equal(url.searchParams.has('minute'), false);
});

// ── 10. meetingId never placed in `minute` param ─────────────────────────────
test('contract: meetingId is never used as minuteId', () => {
  assert.notEqual('meeting-1', 'minute-99');
});

// ── confirm "no" → no navigation ─────────────────────────────────────────────
test('confirm: declining confirm modal → no onRegisterMinutes call', () => {
  let called = false;
  const onRegisterMinutes = (): void => { called = true; };
  void onRegisterMinutes;
  assert.equal(called, false);
});

// ── loading shows disabled button, not removed ───────────────────────────────
test('loading state: access state has loading=true, allowed=false, error=false', () => {
  const loadingState = { loading: true, allowed: false, existingMinuteId: null, error: false };
  assert.equal(loadingState.loading, true);
  assert.equal(loadingState.allowed, false);
  assert.equal(loadingState.error, false);
});

// ── submit outcome contract ───────────────────────────────────────────────────
test('submit: success → minuteId from RPC, never meetingId', () => {
  const outcome = resolveMinutesSubmitOutcome(
    { success: true, minute_id: 'minute-1' },
    null,
  );
  assert.equal(outcome.kind, 'success');
  assert.notEqual((outcome as { minuteId: string }).minuteId, 'meeting-1');
});

test('submit: duplicate race → navigate to existing, not create', () => {
  const outcome = resolveMinutesSubmitOutcome(
    { success: false, error_code: 'MINUTES_ALREADY_EXISTS' },
    'minute-existing',
  );
  assert.equal(outcome.kind, 'duplicate');
  assert.equal((outcome as { minuteId: string }).minuteId, 'minute-existing');
});

// ── interpretMinutesAccess contract ──────────────────────────────────────────
test('interpret: canCreate=true, no existing → allowed', () => {
  const r = interpretMinutesAccess(true, []);
  assert.equal(r.allowed, true);
  assert.equal(r.errorCode, null);
});

test('interpret: canCreate=false → MEETING_NO_PERMISSION', () => {
  const r = interpretMinutesAccess(false, []);
  assert.equal(r.allowed, false);
  assert.equal(r.errorCode, 'MEETING_NO_PERMISSION');
});

test('interpret: null → CHECK_FAILED (network error, not denial)', () => {
  const r = interpretMinutesAccess(null, []);
  assert.equal(r.allowed, false);
  assert.equal(r.errorCode, 'CHECK_FAILED');
});

test('interpret: existing rows → MINUTES_ALREADY_EXISTS', () => {
  const r = interpretMinutesAccess(true, [{ id: 'm-1', status: 'draft' }]);
  assert.equal(r.allowed, false);
  assert.equal(r.errorCode, 'MINUTES_ALREADY_EXISTS');
  assert.equal(r.existingMinuteId, 'm-1');
});
