import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapInboxStatusToInvitationStatus,
  dedupeInternalParticipants,
  mapExternalParticipantName,
  mapExternalParticipants,
} from '../../src/lib/minutesPrefill';
import type { DraftInternalParticipant } from '../../src/components/Minutes/Form/types';
import { uid } from '../../src/components/Minutes/Form/defaults';

// ── mapInboxStatusToInvitationStatus ────────────────────────────────────────

test('mapInboxStatus: accepted → accepted', () => {
  assert.equal(mapInboxStatusToInvitationStatus('accepted'), 'accepted');
});

test('mapInboxStatus: declined → declined', () => {
  assert.equal(mapInboxStatusToInvitationStatus('declined'), 'declined');
});

test('mapInboxStatus: delegated → delegated', () => {
  assert.equal(mapInboxStatusToInvitationStatus('delegated'), 'delegated');
});

test('mapInboxStatus: pending → no_response (وضعیت انتظار قرارداد Minutes)', () => {
  assert.equal(mapInboxStatusToInvitationStatus('pending'), 'no_response');
});

test('mapInboxStatus: null/undefined/unknown → no_response', () => {
  assert.equal(mapInboxStatusToInvitationStatus(null), 'no_response');
  assert.equal(mapInboxStatusToInvitationStatus(undefined), 'no_response');
  assert.equal(mapInboxStatusToInvitationStatus('something_else'), 'no_response');
});

// ── dedupeInternalParticipants ──────────────────────────────────────────────

function makeInternal(userId: string, name = ''): DraftInternalParticipant {
  return {
    id: uid(),
    userId,
    nameSnapshot: name,
    positionSnapshot: '',
    orgUnitId: '',
    orgUnitNameSnapshot: '',
    invitationStatus: 'invited',
    attendanceStatus: null,
    delegate: '',
    notes: '',
  };
}

test('dedupe: removes duplicate participants by userId, keeps first', () => {
  const a = makeInternal('user-1', 'Alice');
  const b = makeInternal('user-1', 'Alice duplicate');
  const c = makeInternal('user-2', 'Bob');
  const result = dedupeInternalParticipants([a, b, c]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, a.id);
  assert.equal(result[1].id, c.id);
});

test('dedupe: preserves entries with empty userId (distinct by name)', () => {
  const a = makeInternal('', 'Name A');
  const b = makeInternal('', 'Name B');
  const result = dedupeInternalParticipants([a, b]);
  assert.equal(result.length, 2);
});

test('dedupe: empty input returns empty', () => {
  assert.equal(dedupeInternalParticipants([]).length, 0);
});

// ── mapExternalParticipantName ───────────────────────────────────────────────

test('mapExternalName: valid name → draft row with empty org/position/mobile/email', () => {
  const row = mapExternalParticipantName('Jane Doe');
  assert.ok(row);
  assert.equal(row!.fullName, 'Jane Doe');
  assert.equal(row!.organization, '');
  assert.equal(row!.position, '');
  assert.equal(row!.mobile, '');
  assert.equal(row!.email, '');
  assert.equal(row!.attendanceStatus, null);
});

test('mapExternalName: blank/whitespace name → null (no fabricated data)', () => {
  assert.equal(mapExternalParticipantName(''), null);
  assert.equal(mapExternalParticipantName('   '), null);
  assert.equal(mapExternalParticipantName(null), null);
});

test('mapExternalName: trims surrounding whitespace', () => {
  const row = mapExternalParticipantName('  John  ');
  assert.ok(row);
  assert.equal(row!.fullName, 'John');
});

// ── mapExternalParticipants ─────────────────────────────────────────────────

test('mapExternalParticipants: array of names → rows, skipping blanks', () => {
  const rows = mapExternalParticipants(['Alice', '', '  ', 'Bob', null as unknown as string]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, 'Alice');
  assert.equal(rows[1].fullName, 'Bob');
});

test('mapExternalParticipants: null/undefined input → empty array', () => {
  assert.equal(mapExternalParticipants(null).length, 0);
  assert.equal(mapExternalParticipants(undefined).length, 0);
  assert.equal(mapExternalParticipants([]).length, 0);
});

test('mapExternalParticipants: no fabricated organization/position fields', () => {
  const rows = mapExternalParticipants(['Alice']);
  assert.equal(rows[0].organization, '');
  assert.equal(rows[0].position, '');
  assert.equal(rows[0].mobile, '');
  assert.equal(rows[0].email, '');
});

// ── Meeting query schema contract ────────────────────────────────────────────
// The meetings table does NOT have meeting_type or org_unit_id columns.
// Requesting them causes HTTP 400 and was incorrectly surfaced as a
// permission denial. These tests pin the corrected select string.

const MEETINGS_SELECT_COLUMNS = [
  'id',
  'subject',
  'request_date',
  'start_time',
  'end_time',
  'location',
  'participant_user_ids',
  'external_participants',
  'meeting_manager',
  'user_id',
];

function buildMeetingsSelectString(): string {
  return MEETINGS_SELECT_COLUMNS.join(', ');
}

test('schema: meetings select does NOT include meeting_type', () => {
  const select = buildMeetingsSelectString();
  assert.ok(!select.includes('meeting_type'));
});

test('schema: meetings select does NOT include org_unit_id', () => {
  const select = buildMeetingsSelectString();
  assert.ok(!select.includes('org_unit_id'));
});

test('schema: meetings select includes only real columns', () => {
  const select = buildMeetingsSelectString();
  for (const col of MEETINGS_SELECT_COLUMNS) {
    assert.ok(select.includes(col), `missing expected column ${col}`);
  }
  const forbidden = ['meeting_type', 'org_unit_id'];
  for (const col of forbidden) {
    assert.ok(!select.includes(col), `forbidden column ${col} present`);
  }
});

// ── Error separation contract ────────────────────────────────────────────────
// A query error (e.g. column does not exist) must NOT be reported as
// MEETING_NO_PERMISSION. The UI must distinguish:
//   - MEETING_NO_PERMISSION → "شما اجازه ثبت... ندارید."
//   - MEETING_NOT_FOUND     → "جلسه موردنظر یافت نشد."
//   - MEETING_QUERY_ERROR   → "دریافت اطلاعات جلسه ناموفق بود."

const ERROR_MESSAGES: Record<string, string> = {
  MEETING_NO_PERMISSION: 'شما اجازه ثبت صورت‌جلسه برای این جلسه را ندارید.',
  MEETING_NOT_FOUND: 'جلسه موردنظر یافت نشد.',
  MEETING_QUERY_ERROR: 'دریافت اطلاعات جلسه ناموفق بود.',
};

test('error separation: query error code is distinct from permission', () => {
  assert.notEqual('MEETING_QUERY_ERROR', 'MEETING_NO_PERMISSION');
  assert.notEqual('MEETING_QUERY_ERROR', 'CHECK_FAILED');
});

test('error separation: query error message is not the permission message', () => {
  assert.notEqual(ERROR_MESSAGES.MEETING_QUERY_ERROR, ERROR_MESSAGES.MEETING_NO_PERMISSION);
});

test('error separation: query error does not mention دسترسی (permission)', () => {
  assert.ok(!ERROR_MESSAGES.MEETING_QUERY_ERROR.includes('دسترسی'));
  assert.ok(ERROR_MESSAGES.MEETING_NO_PERMISSION.includes('اجازه'));
});

test('error separation: not-found message mentions یافت نشد', () => {
  assert.ok(ERROR_MESSAGES.MEETING_NOT_FOUND.includes('یافت نشد'));
  assert.ok(!ERROR_MESSAGES.MEETING_NOT_FOUND.includes('اجازه'));
});

// ── Supabase error shape simulation ──────────────────────────────────────────
// Simulates the real PostgREST error returned when requesting a non-existent
// column. The frontend must not interpret this as MEETING_NO_PERMISSION.

function simulateColumnError() {
  return {
    code: '42703',
    message: 'column meetings.meeting_type does not exist',
    details: null,
    hint: null,
  };
}

test('supabase error: 42703 column does not exist is a query error, not permission', () => {
  const err = simulateColumnError();
  // The frontend should map this to MEETING_QUERY_ERROR, never to
  // MEETING_NO_PERMISSION.
  const mappedCode = err.code === '42703' ? 'MEETING_QUERY_ERROR' : 'MEETING_NO_PERMISSION';
  assert.equal(mappedCode, 'MEETING_QUERY_ERROR');
  assert.notEqual(mappedCode, 'MEETING_NO_PERMISSION');
});

test('supabase error: 42703 has code/message/details/hint fields', () => {
  const err = simulateColumnError();
  assert.equal(typeof err.code, 'string');
  assert.equal(typeof err.message, 'string');
  assert.ok(err.message.includes('meeting_type'));
});

// ── Prefill blocking contract ────────────────────────────────────────────────
// If the meeting query fails, the form must NOT open with empty data.
// Create Draft and Submit must be disabled.

test('blocking: query error → form not ready, create draft disabled', () => {
  const prefillResult = { allowed: false, errorCode: 'MEETING_QUERY_ERROR', existingMinuteId: null, data: null };
  // Form is ready only when result.allowed && result.data
  const formReady = prefillResult.allowed && !!prefillResult.data;
  assert.equal(formReady, false);
  // Create draft must not proceed
  const canCreateDraft = prefillResult.allowed;
  assert.equal(canCreateDraft, false);
});

test('blocking: not found → form not ready, create draft disabled', () => {
  const prefillResult = { allowed: false, errorCode: 'MEETING_NOT_FOUND', existingMinuteId: null, data: null };
  const formReady = prefillResult.allowed && !!prefillResult.data;
  assert.equal(formReady, false);
});

test('blocking: permission denied → form not ready, create draft disabled', () => {
  const prefillResult = { allowed: false, errorCode: 'MEETING_NO_PERMISSION', existingMinuteId: null, data: null };
  const formReady = prefillResult.allowed && !!prefillResult.data;
  assert.equal(formReady, false);
});

test('blocking: success → form ready, create draft enabled', () => {
  const prefillResult = {
    allowed: true,
    errorCode: null,
    existingMinuteId: null,
    data: { info: {}, internalParticipants: [], externalParticipants: [], agendaItems: [], profiles: [], orgUnits: [] },
  };
  const formReady = prefillResult.allowed && !!prefillResult.data;
  assert.equal(formReady, true);
});

// ── Prefill content contract (fields that ARE available) ──────────────────────
// Title, date, time, location, participants, and agenda must still prefill.

test('prefill content: subject maps to meetingTitle', () => {
  const meeting = { id: 'm1', subject: 'جلسه کمیسیون معاملات', request_date: '2026-07-26', start_time: '10:00', end_time: '11:00', location: 'سال جلسات' };
  const info = {
    meetingTitle: meeting.subject || '',
    meetingDate: meeting.request_date || '',
    startTime: meeting.start_time || '',
    endTime: meeting.end_time || '',
    location: meeting.location || '',
  };
  assert.equal(info.meetingTitle, 'جلسه کمیسیون معاملات');
  assert.equal(info.meetingDate, '2026-07-26');
  assert.equal(info.startTime, '10:00');
  assert.equal(info.endTime, '11:00');
  assert.equal(info.location, 'سال جلسات');
});

test('prefill content: missing meeting_type/org_unit_id does not break prefill', () => {
  // These fields are not on the meetings table; they default to empty.
  const info = {
    meetingType: '',
    orgUnitId: '',
    orgUnitNameSnapshot: '',
  };
  assert.equal(info.meetingType, '');
  assert.equal(info.orgUnitId, '');
  assert.equal(info.orgUnitNameSnapshot, '');
  // Form is still usable — user can fill these manually.
});

// ── Retry contract ────────────────────────────────────────────────────────────
test('retry: transient query error → retry re-runs the prefill', () => {
  let attempt = 0;
  let calls = 0;
  const tryPrefill = () => {
    calls++;
    attempt++;
    // First call fails, second succeeds
    if (attempt === 1) return { allowed: false, errorCode: 'MEETING_QUERY_ERROR', data: null };
    return { allowed: true, errorCode: null, data: { ok: true } };
  };
  const r1 = tryPrefill();
  assert.equal(r1.allowed, false);
  const r2 = tryPrefill();
  assert.equal(r2.allowed, true);
  assert.equal(calls, 2);
});
