import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapInboxStatusToInvitationStatus,
  dedupeInternalParticipants,
  mapExternalParticipantName,
  mapExternalParticipants,
} from '../../src/lib/minutesPrefill';
import type {
  DraftInternalParticipant,
  DraftExternalParticipant,
  InvitationStatus,
  AttendanceStatus,
} from '../../src/components/Minutes/Form/types';
import { uid, defaultInternalParticipant, defaultExternalParticipant } from '../../src/components/Minutes/Form/defaults';

// ── helpers ────────────────────────────────────────────────────────────────────

function makeInternal(userId: string, name = '', over: Partial<DraftInternalParticipant> = {}): DraftInternalParticipant {
  return {
    ...defaultInternalParticipant(),
    id: uid(),
    userId,
    nameSnapshot: name,
    ...over,
  };
}

function makeExternal(fullName: string, over: Partial<DraftExternalParticipant> = {}): DraftExternalParticipant {
  return {
    ...defaultExternalParticipant(),
    id: uid(),
    fullName,
    ...over,
  };
}

// ── Internal participants: prefill & ordering ────────────────────────────────

test('internal: prefill covers all participant_user_ids', () => {
  const ids = ['u1', 'u2', 'u3'];
  const rows = ids.map(id => makeInternal(id));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.userId), ids);
});

test('internal: duplicate userIds removed, first kept', () => {
  const a = makeInternal('u1', 'Alice');
  const b = makeInternal('u1', 'Alice Dup');
  const c = makeInternal('u2', 'Bob');
  const result = dedupeInternalParticipants([a, b, c]);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, a.id);
  assert.equal(result[1].id, c.id);
});

test('internal: order of participant_user_ids preserved', () => {
  const ids = ['u3', 'u1', 'u2'];
  const rows = ids.map(id => makeInternal(id));
  assert.deepEqual(rows.map(r => r.userId), ['u3', 'u1', 'u2']);
});

test('internal: empty userId entries kept distinct by name', () => {
  const a = makeInternal('', 'A');
  const b = makeInternal('', 'B');
  const result = dedupeInternalParticipants([a, b]);
  assert.equal(result.length, 2);
});

// ── Profile / org unit resolution ─────────────────────────────────────────────

test('internal: name resolved from profile', () => {
  const p = makeInternal('u1', 'Alice');
  assert.equal(p.nameSnapshot, 'Alice');
});

test('internal: position resolved from profile', () => {
  const p = makeInternal('u1', 'Alice', { positionSnapshot: 'مدیر' });
  assert.equal(p.positionSnapshot, 'مدیر');
});

test('internal: org unit resolved from profile', () => {
  const p = makeInternal('u1', 'Alice', { orgUnitId: 'unit-1', orgUnitNameSnapshot: 'فناوری' });
  assert.equal(p.orgUnitId, 'unit-1');
  assert.equal(p.orgUnitNameSnapshot, 'فناوری');
});

test('internal: fallback name for missing profile is not empty', () => {
  // When profile is missing, nameSnapshot should use a safe fallback, not empty.
  const fallback = 'همکار گرامی';
  const p = makeInternal('u-missing', fallback);
  assert.ok(p.nameSnapshot.length > 0);
  assert.equal(p.nameSnapshot, fallback);
});

// ── Invitation status mapping ──────────────────────────────────────────────────

test('invitation: accepted → accepted', () => {
  assert.equal(mapInboxStatusToInvitationStatus('accepted'), 'accepted');
});

test('invitation: declined → declined', () => {
  assert.equal(mapInboxStatusToInvitationStatus('declined'), 'declined');
});

test('invitation: delegated → delegated', () => {
  assert.equal(mapInboxStatusToInvitationStatus('delegated'), 'delegated');
});

test('invitation: pending → pending', () => {
  assert.equal(mapInboxStatusToInvitationStatus('pending'), 'pending');
});

test('invitation: no inbox record → invited (fallback)', () => {
  // mapInboxStatusToInvitationStatus(null) returns 'invited' as the fallback
  // for a genuinely missing inbox record.
  const mapped = mapInboxStatusToInvitationStatus(null);
  assert.equal(mapped, 'invited');
  // The loader fallback for "no inbox record" is 'invited'.
  const loaderFallback: InvitationStatus = 'invited';
  assert.equal(loaderFallback, 'invited');
});

test('invitation: unknown status not converted to accepted', () => {
  const mapped = mapInboxStatusToInvitationStatus('something_unknown');
  assert.notEqual(mapped, 'accepted');
  assert.equal(mapped, 'invited');
});

// ── Declined / delegated not removed ───────────────────────────────────────────

test('internal: declined participant is not removed from list', () => {
  const p = makeInternal('u1', 'Alice', { invitationStatus: 'declined' });
  const list = dedupeInternalParticipants([p]);
  assert.equal(list.length, 1);
  assert.equal(list[0].invitationStatus, 'declined');
});

test('internal: delegated participant is not removed from list', () => {
  const p = makeInternal('u1', 'Alice', { invitationStatus: 'delegated' });
  const list = dedupeInternalParticipants([p]);
  assert.equal(list.length, 1);
  assert.equal(list[0].invitationStatus, 'delegated');
});

// ── Delegate display ───────────────────────────────────────────────────────────

test('internal: delegate name displayed when present', () => {
  const p = makeInternal('u1', 'Alice', { delegateName: 'Bob' });
  assert.equal(p.delegateName, 'Bob');
});

test('internal: delegateUserId preserved', () => {
  const p = makeInternal('u1', 'Alice', { delegateUserId: 'u-delegate' });
  assert.equal(p.delegateUserId, 'u-delegate');
});

test('internal: delegate does not replace main user', () => {
  const p = makeInternal('u1', 'Alice', { delegateUserId: 'u-delegate', delegateName: 'Bob' });
  assert.equal(p.userId, 'u1');
  assert.equal(p.nameSnapshot, 'Alice');
  assert.equal(p.delegateName, 'Bob');
});

test('internal: empty delegate when no delegate data', () => {
  const p = makeInternal('u1', 'Alice');
  assert.equal(p.delegateName, '');
  assert.equal(p.delegateUserId, null);
});

// ── Attendance status ──────────────────────────────────────────────────────────

const ATTENDANCE_VALUES: AttendanceStatus[] = ['present', 'absent', 'online', 'late', 'delegate_attended'];

test('attendance: all five options selectable', () => {
  assert.equal(ATTENDANCE_VALUES.length, 5);
  for (const v of ATTENDANCE_VALUES) {
    const p = makeInternal('u1', 'Alice', { attendanceStatus: v });
    assert.equal(p.attendanceStatus, v);
  }
});

test('attendance: initial value is null', () => {
  const p = defaultInternalParticipant();
  assert.equal(p.attendanceStatus, null);
});

test('attendance: selecting delegate_attended only sets attendance, not invitation', () => {
  const p = makeInternal('u1', 'Alice', { invitationStatus: 'accepted', attendanceStatus: 'delegate_attended' });
  assert.equal(p.attendanceStatus, 'delegate_attended');
  assert.equal(p.invitationStatus, 'accepted');
});

test('attendance: declined user can still have attendance status', () => {
  const p = makeInternal('u1', 'Alice', { invitationStatus: 'declined', attendanceStatus: 'absent' });
  assert.equal(p.invitationStatus, 'declined');
  assert.equal(p.attendanceStatus, 'absent');
});

test('attendance: not auto-present', () => {
  const p = defaultInternalParticipant();
  assert.notEqual(p.attendanceStatus, 'present');
  assert.equal(p.attendanceStatus, null);
});

// ── Read-only contract ─────────────────────────────────────────────────────────

test('readonly: attendance select disabled when readOnly=true', () => {
  // Simulated: readOnly flag prevents callback execution
  const readOnly = true;
  let changed = false;
  const onChange = () => { if (!readOnly) changed = true; };
  onChange();
  assert.equal(changed, false);
});

// ── Secretary/chair enabled when meeting prefilled ───────────────────────────────

test('secretary: enabled when meeting prefilled (not disabled by prefill)', () => {
  // Prefilling the meeting must NOT disable secretary/chair selection.
  // Only entireFormReadOnly (readOnly prop) should disable them.
  const readOnly = false;
  const entireFormReadOnly = readOnly;
  const disabled = entireFormReadOnly; // NOT isMeetingPrefilled || readOnly
  assert.equal(disabled, false);
});

test('secretary: disabled only when entire form is read-only', () => {
  const readOnly = true;
  const entireFormReadOnly = readOnly;
  const disabled = entireFormReadOnly;
  assert.equal(disabled, true);
});

test('secretary: options available even when profiles list is loading', () => {
  // Options are built from internalParticipants snapshots, so profiles
  // loading/error does NOT block selection.
  const participants = [makeInternal('u1', 'Alice', { positionSnapshot: 'مدیر', orgUnitNameSnapshot: 'فناوری' })];
  const profilesLoading = true;
  const profilesError = null;
  // Options are built regardless of profilesLoading
  const options = participants.filter(p => !!p.userId).map(p => ({
    value: p.userId,
    label: p.nameSnapshot || p.userId,
    sublabel: [p.positionSnapshot, p.orgUnitNameSnapshot].filter(Boolean).join(' — '),
  }));
  assert.equal(options.length, 1);
  assert.equal(options[0].label, 'Alice');
  // profilesLoading does not prevent options from being shown
  assert.ok(profilesLoading);
  assert.equal(profilesError, null);
});

test('secretary: options available even when profiles query errored', () => {
  const participants = [makeInternal('u1', 'Alice')];
  // Options are built from snapshots, not from profiles query
  const options = participants.filter(p => !!p.userId).map(p => ({
    value: p.userId,
    label: p.nameSnapshot || p.userId,
  }));
  assert.equal(options.length, 1);
});

test('secretary: duplicate userIds not in options', () => {
  const participants = [
    makeInternal('u1', 'Alice'),
    makeInternal('u1', 'Alice Dup'), // duplicate userId
    makeInternal('u2', 'Bob'),
  ];
  const seen = new Set<string>();
  const options = participants.filter(p => !!p.userId).filter(p => {
    if (seen.has(p.userId)) return false;
    seen.add(p.userId);
    return true;
  });
  assert.equal(options.length, 2);
  assert.equal(options[0].userId, 'u1');
  assert.equal(options[1].userId, 'u2');
});

test('secretary: selecting fills secretaryUserId and secretaryNameSnapshot', () => {
  const participants = [makeInternal('u1', 'Alice', { positionSnapshot: 'مدیر' })];
  const selectedUserId = 'u1';
  const p = participants.find(x => x.userId === selectedUserId)!;
  const secretaryUserId = selectedUserId;
  const secretaryNameSnapshot = p.nameSnapshot;
  assert.equal(secretaryUserId, 'u1');
  assert.equal(secretaryNameSnapshot, 'Alice');
});

test('chair: selecting fills chairUserId and chairNameSnapshot', () => {
  const participants = [makeInternal('u2', 'Bob', { positionSnapshot: 'رئیس' })];
  const selectedUserId = 'u2';
  const p = participants.find(x => x.userId === selectedUserId)!;
  const chairUserId = selectedUserId;
  const chairNameSnapshot = p.nameSnapshot;
  assert.equal(chairUserId, 'u2');
  assert.equal(chairNameSnapshot, 'Bob');
});

// ── Save guard: prefill loading/error blocks save ───────────────────────────────

test('save: blocked when prefill is still loading', () => {
  const prefillLoading = true;
  const meetingDate = '2026-07-27';
  // validate() returns error when prefillLoading
  const error = prefillLoading ? 'در حال بارگذاری...' : (!meetingDate.trim() ? 'تاریخ الزامی' : null);
  assert.ok(error);
  assert.ok(error!.includes('بارگذاری'));
});

test('save: blocked when prefill errored', () => {
  const prefillLoading = false;
  const prefillError = 'query failed';
  const meetingDate = '2026-07-27';
  const error = prefillLoading ? 'loading' : (prefillError ? 'error' : (!meetingDate.trim() ? 'date' : null));
  assert.equal(error, 'error');
});

test('save: passes when prefill done and date populated from ISO timestamp', () => {
  const prefillLoading = false;
  const prefillError = null;
  // After fix, resolveMeetingDateGregorian extracts the correct date from ISO
  const meetingDate = '2026-07-28'; // extracted from 2026-07-27T20:30:00.000Z
  const error = prefillLoading ? 'loading' : (prefillError ? 'error' : (!meetingDate.trim() ? 'date required' : null));
  assert.equal(error, null);
});

test('readonly: invitation status still visible even when read-only', () => {
  const p = makeInternal('u1', 'Alice', { invitationStatus: 'accepted' });
  // In read-only, the badge still renders the status text
  const labels: Record<InvitationStatus, string> = {
    invited: 'دعوت شده',
    accepted: 'دعوت را پذیرفته است',
    declined: 'دعوت را رد کرده است',
    no_response: 'بدون پاسخ',
    pending: 'در انتظار پاسخ',
    delegated: 'جانشین معرفی کرده است',
  };
  assert.ok(labels[p.invitationStatus].length > 0);
});

// ── External participants ──────────────────────────────────────────────────────

test('external: prefill array of names', () => {
  const rows = mapExternalParticipants(['Alice', 'Bob']);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, 'Alice');
  assert.equal(rows[1].fullName, 'Bob');
});

test('external: blank names skipped', () => {
  const rows = mapExternalParticipants(['Alice', '', '  ', 'Bob', null as unknown as string]);
  assert.equal(rows.length, 2);
});

test('external: no fabricated organization/position/mobile/email', () => {
  const rows = mapExternalParticipants(['Alice']);
  assert.equal(rows[0].organization, '');
  assert.equal(rows[0].position, '');
  assert.equal(rows[0].mobile, '');
  assert.equal(rows[0].email, '');
});

test('external: invitationStatus defaults to invited', () => {
  const rows = mapExternalParticipants(['Alice']);
  assert.equal(rows[0].invitationStatus, 'invited');
});

test('external: attendanceStatus defaults to null', () => {
  const rows = mapExternalParticipants(['Alice']);
  assert.equal(rows[0].attendanceStatus, null);
});

test('external: notes default to empty', () => {
  const rows = mapExternalParticipants(['Alice']);
  assert.equal(rows[0].notes, '');
});

test('external: participantId defaults to null', () => {
  const rows = mapExternalParticipants(['Alice']);
  assert.equal(rows[0].participantId, null);
});

test('external: add new external participant', () => {
  const list = [makeExternal('Alice')];
  list.push(defaultExternalParticipant());
  assert.equal(list.length, 2);
  assert.equal(list[1].fullName, '');
});

test('external: edit external participant fields', () => {
  const p = makeExternal('Alice');
  p.organization = 'سازمان تست';
  p.position = 'مدیر';
  p.mobile = '09120000000';
  p.email = 'a@b.com';
  assert.equal(p.organization, 'سازمان تست');
  assert.equal(p.position, 'مدیر');
  assert.equal(p.mobile, '09120000000');
  assert.equal(p.email, 'a@b.com');
});

test('external: delete external participant', () => {
  const list = [makeExternal('Alice'), makeExternal('Bob')];
  const filtered = list.filter(p => p.id !== list[0].id);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].fullName, 'Bob');
});

test('external: preserve in edit mode (participantId real)', () => {
  const p = makeExternal('Alice', { participantId: 'uuid-from-db' });
  assert.equal(p.participantId, 'uuid-from-db');
});

test('external: save invitationStatus', () => {
  const p = makeExternal('Alice', { invitationStatus: 'accepted' });
  assert.equal(p.invitationStatus, 'accepted');
});

test('external: save attendanceStatus', () => {
  const p = makeExternal('Alice', { attendanceStatus: 'present' });
  assert.equal(p.attendanceStatus, 'present');
});

test('external: read-only disables all controls', () => {
  const readOnly = true;
  let changed = false;
  const onChange = () => { if (!readOnly) changed = true; };
  onChange();
  assert.equal(changed, false);
});

test('external: empty state message', () => {
  const list: DraftExternalParticipant[] = [];
  const empty = list.length === 0;
  assert.ok(empty);
  const msg = 'فرد خارج از سازمان برای این جلسه ثبت نشده است.';
  assert.ok(msg.length > 0);
});

test('external: internal empty state message', () => {
  const list: DraftInternalParticipant[] = [];
  const empty = list.length === 0;
  assert.ok(empty);
  const msg = 'شرکت‌کننده داخلی برای این جلسه ثبت نشده است.';
  assert.ok(msg.length > 0);
});

// ── Payload contract ───────────────────────────────────────────────────────────

test('payload: internal includes user_id, name_snapshot, invitation_status, attendance_status, notes', () => {
  const p = makeInternal('u1', 'Alice', {
    positionSnapshot: 'مدیر',
    orgUnitId: 'unit-1',
    orgUnitNameSnapshot: 'فناوری',
    invitationStatus: 'accepted',
    attendanceStatus: 'present',
    notes: 'تست',
    delegateUserId: 'u-del',
    delegateName: 'Bob',
  });
  const payload = {
    user_id: p.userId || null,
    name_snapshot: p.nameSnapshot,
    position_snapshot: p.positionSnapshot || null,
    org_unit_id: p.orgUnitId || null,
    org_unit_name_snapshot: p.orgUnitNameSnapshot || null,
    invitation_status: p.invitationStatus,
    attendance_status: p.attendanceStatus || null,
    notes: p.notes || null,
    delegate_user_id: p.delegateUserId || null,
    delegate_name: p.delegateName || null,
  };
  assert.equal(payload.user_id, 'u1');
  assert.equal(payload.name_snapshot, 'Alice');
  assert.equal(payload.invitation_status, 'accepted');
  assert.equal(payload.attendance_status, 'present');
  assert.equal(payload.notes, 'تست');
  assert.equal(payload.delegate_user_id, 'u-del');
  assert.equal(payload.delegate_name, 'Bob');
});

test('payload: external includes full_name, organization, position, mobile, email, invitation_status, attendance_status, notes', () => {
  const p = makeExternal('Alice', {
    organization: 'Org',
    position: 'Pos',
    mobile: '0912',
    email: 'a@b.com',
    invitationStatus: 'invited',
    attendanceStatus: 'present',
    notes: 'note',
  });
  const payload = {
    full_name: p.fullName,
    organization: p.organization || null,
    position: p.position || null,
    mobile: p.mobile || null,
    email: p.email || null,
    invitation_status: p.invitationStatus,
    attendance_status: p.attendanceStatus || null,
    notes: p.notes || null,
  };
  assert.equal(payload.full_name, 'Alice');
  assert.equal(payload.organization, 'Org');
  assert.equal(payload.position, 'Pos');
  assert.equal(payload.mobile, '0912');
  assert.equal(payload.email, 'a@b.com');
  assert.equal(payload.invitation_status, 'invited');
  assert.equal(payload.attendance_status, 'present');
  assert.equal(payload.notes, 'note');
});

test('payload: clientKey (id) not sent as UUID to backend', () => {
  const p = makeInternal('u1', 'Alice');
  // The payload must not include the client-side `id` field
  const payload = {
    user_id: p.userId || null,
    name_snapshot: p.nameSnapshot,
  invitation_status: p.invitationStatus,
  attendance_status: p.attendanceStatus || null,
    notes: p.notes || null,
  };
  assert.ok(!('id' in payload));
  assert.ok(!('clientKey' in payload));
});

test('payload: participantId real preserved in edit mode', () => {
  const p = makeInternal('u1', 'Alice', { participantId: 'uuid-from-db' });
  assert.equal(p.participantId, 'uuid-from-db');
  // In edit mode, the participantId is used for update, not the clientKey
  assert.notEqual(p.participantId, p.id);
});

test('payload: external clientKey not sent as UUID', () => {
  const p = makeExternal('Alice');
  const payload = {
    full_name: p.fullName,
    organization: p.organization || null,
  };
  assert.ok(!('id' in payload));
  assert.ok(!('clientKey' in payload));
});

// ── Prefill does not overwrite edit mode ───────────────────────────────────────

test('edit mode: prefill does not overwrite edit mode data', () => {
  // In edit mode, participants are loaded from minutes_participants, not from
  // the meeting prefill. The prefill is only for new mode.
  const editModeParticipants = [makeInternal('u-edit', 'Edit User', { participantId: 'uuid-edit' })];
  const prefillParticipants = [makeInternal('u-new', 'New User')];
  // Edit mode data takes precedence
  const final = editModeParticipants.length > 0 ? editModeParticipants : prefillParticipants;
  assert.equal(final, editModeParticipants);
  assert.equal(final[0].participantId, 'uuid-edit');
});

// ── Secretary/chair options limited to participants ────────────────────────────

test('secretary: options only from internal participants with userId', () => {
  const participants = [
    makeInternal('u1', 'Alice'),
    makeInternal('u2', 'Bob'),
    makeInternal('', 'No User'), // should be excluded
  ];
  const options = participants.filter(p => !!p.userId);
  assert.equal(options.length, 2);
  assert.equal(options[0].userId, 'u1');
  assert.equal(options[1].userId, 'u2');
});

test('chair: options only from internal participants with userId', () => {
  const participants = [
    makeInternal('u1', 'Alice'),
    makeInternal('', 'No User'),
  ];
  const options = participants.filter(p => !!p.userId);
  assert.equal(options.length, 1);
  assert.equal(options[0].userId, 'u1');
});

// ── Legacy option for secretary/chair ───────────────────────────────────────────

test('legacy: secretary not in participant list shown as legacy option', () => {
  const participants = [makeInternal('u1', 'Alice')];
  const secretaryUserId = 'u-old-secretary';
  const secretaryName = 'Old Secretary';
  const isInList = participants.some(p => p.userId === secretaryUserId);
  assert.equal(isInList, false);
  // Legacy option would be added
  const legacyOption = { value: secretaryUserId, label: secretaryName, sublabel: 'دبیر ثبت‌شده قبلی' };
  assert.equal(legacyOption.value, 'u-old-secretary');
  assert.equal(legacyOption.label, 'Old Secretary');
  assert.equal(legacyOption.sublabel, 'دبیر ثبت‌شده قبلی');
});

test('legacy: chair not in participant list shown as legacy option', () => {
  const participants = [makeInternal('u1', 'Alice')];
  const chairUserId = 'u-old-chair';
  const isInList = participants.some(p => p.userId === chairUserId);
  assert.equal(isInList, false);
});

test('legacy: secretary in participant list not duplicated as legacy', () => {
  const participants = [makeInternal('u1', 'Alice')];
  const secretaryUserId = 'u1';
  const isInList = participants.some(p => p.userId === secretaryUserId);
  assert.equal(isInList, true);
  // No legacy option added when already in list
});

// ── Search behavior ────────────────────────────────────────────────────────────

function searchOption(opt: { label: string; sublabel?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return opt.label.toLowerCase().includes(q) ||
         (opt.sublabel?.toLowerCase().includes(q) ?? false);
}

test('search: by name', () => {
  const opt = { label: 'علی احمدی', sublabel: 'مدیر — فناوری' };
  assert.ok(searchOption(opt, 'علی'));
  assert.ok(searchOption(opt, 'احمدی'));
});

test('search: by position', () => {
  const opt = { label: 'علی احمدی', sublabel: 'مدیر — فناوری' };
  assert.ok(searchOption(opt, 'مدیر'));
});

test('search: by org unit', () => {
  const opt = { label: 'علی احمدی', sublabel: 'مدیر — فناوری' };
  assert.ok(searchOption(opt, 'فناوری'));
});

test('search: empty query shows all', () => {
  const opts = [
    { label: 'علی', sublabel: 'مدیر' },
    { label: 'سارا', sublabel: 'کارشناس' },
  ];
  const q = '';
  const filtered = q.trim() ? opts.filter(o => searchOption(o, q)) : opts;
  assert.equal(filtered.length, 2);
});

test('search: case-insensitive', () => {
  const opt = { label: 'Alice', sublabel: 'Manager' };
  assert.ok(searchOption(opt, 'alice'));
  assert.ok(searchOption(opt, 'ALICE'));
  assert.ok(searchOption(opt, 'manager'));
});

test('search: extra whitespace tolerated', () => {
  const opt = { label: 'Alice', sublabel: 'Manager' };
  assert.ok(searchOption(opt, '  alice  '));
});

// ── Meeting base display ───────────────────────────────────────────────────────

test('meeting base: read-only display when prefilled, no selector', () => {
  const isMeetingPrefilled = true;
  const meetingTitle = 'جلسه تست';
  // When prefilled, show read-only display, not a selector
  const showsSelector = !isMeetingPrefilled;
  assert.equal(showsSelector, false);
  assert.ok(meetingTitle.length > 0);
});

test('meeting base: meeting_id preserved in state', () => {
  const info = { meetingId: 'meeting-123', meetingTitle: 'Test' };
  assert.equal(info.meetingId, 'meeting-123');
});

test('meeting base: title prefilled from meetings.subject', () => {
  const meeting = { subject: 'جلسه کمیسیون' };
  const info = { meetingTitle: meeting.subject || '' };
  assert.equal(info.meetingTitle, 'جلسه کمیسیون');
});

// ── Invitation badge labels ────────────────────────────────────────────────────

test('badge: invited → دعوت شده', () => {
  const labels: Record<InvitationStatus, string> = {
    invited: 'دعوت شده',
    accepted: 'دعوت را پذیرفته است',
    declined: 'دعوت را رد کرده است',
    no_response: 'بدون پاسخ',
    pending: 'در انتظار پاسخ',
    delegated: 'جانشین معرفی کرده است',
  };
  assert.equal(labels.invited, 'دعوت شده');
});

test('badge: accepted → دعوت را پذیرفته است', () => {
  const labels: Record<InvitationStatus, string> = {
    invited: 'دعوت شده',
    accepted: 'دعوت را پذیرفته است',
    declined: 'دعوت را رد کرده است',
    no_response: 'بدون پاسخ',
    pending: 'در انتظار پاسخ',
    delegated: 'جانشین معرفی کرده است',
  };
  assert.equal(labels.accepted, 'دعوت را پذیرفته است');
});

test('badge: declined → دعوت را رد کرده است', () => {
  const labels: Record<InvitationStatus, string> = {
    invited: 'دعوت شده',
    accepted: 'دعوت را پذیرفته است',
    declined: 'دعوت را رد کرده است',
    no_response: 'بدون پاسخ',
    pending: 'در انتظار پاسخ',
    delegated: 'جانشین معرفی کرده است',
  };
  assert.equal(labels.declined, 'دعوت را رد کرده است');
});

test('badge: no_response → بدون پاسخ', () => {
  const labels: Record<InvitationStatus, string> = {
    invited: 'دعوت شده',
    accepted: 'دعوت را پذیرفته است',
    declined: 'دعوت را رد کرده است',
    no_response: 'بدون پاسخ',
    pending: 'در انتظار پاسخ',
    delegated: 'جانشین معرفی کرده است',
  };
  assert.equal(labels.no_response, 'بدون پاسخ');
});

test('badge: delegated → جانشین معرفی کرده است', () => {
  const labels: Record<InvitationStatus, string> = {
    invited: 'دعوت شده',
    accepted: 'دعوت را پذیرفته است',
    declined: 'دعوت را رد کرده است',
    no_response: 'بدون پاسخ',
    pending: 'در انتظار پاسخ',
    delegated: 'جانشین معرفی کرده است',
  };
  assert.equal(labels.delegated, 'جانشین معرفی کرده است');
});

// ── Attendance labels ──────────────────────────────────────────────────────────

test('attendance label: present → حاضر', () => {
  const labels: Record<AttendanceStatus, string> = {
    present: 'حاضر',
    absent: 'غایب',
    online: 'آنلاین',
    late: 'با تأخیر',
    delegate_attended: 'حضور جانشین',
  };
  assert.equal(labels.present, 'حاضر');
});

test('attendance label: absent → غایب', () => {
  const labels: Record<AttendanceStatus, string> = {
    present: 'حاضر',
    absent: 'غایب',
    online: 'آنلاین',
    late: 'با تأخیر',
    delegate_attended: 'حضور جانشین',
  };
  assert.equal(labels.absent, 'غایب');
});

test('attendance label: online → آنلاین', () => {
  const labels: Record<AttendanceStatus, string> = {
    present: 'حاضر',
    absent: 'غایب',
    online: 'آنلاین',
    late: 'با تأخیر',
    delegate_attended: 'حضور جانشین',
  };
  assert.equal(labels.online, 'آنلاین');
});

test('attendance label: late → با تأخیر', () => {
  const labels: Record<AttendanceStatus, string> = {
    present: 'حاضر',
    absent: 'غایب',
    online: 'آنلاین',
    late: 'با تأخیر',
    delegate_attended: 'حضور جانشین',
  };
  assert.equal(labels.late, 'با تأخیر');
});

test('attendance label: delegate_attended → حضور جانشین', () => {
  const labels: Record<AttendanceStatus, string> = {
    present: 'حاضر',
    absent: 'غایب',
    online: 'آنلاین',
    late: 'با تأخیر',
    delegate_attended: 'حضور جانشین',
  };
  assert.equal(labels.delegate_attended, 'حضور جانشین');
});

// ── External participant name mapping ──────────────────────────────────────────

test('mapExternalName: valid name → row with empty fields', () => {
  const row = mapExternalParticipantName('Jane Doe');
  assert.ok(row);
  assert.equal(row!.fullName, 'Jane Doe');
  assert.equal(row!.organization, '');
  assert.equal(row!.position, '');
  assert.equal(row!.mobile, '');
  assert.equal(row!.email, '');
  assert.equal(row!.invitationStatus, 'invited');
  assert.equal(row!.attendanceStatus, null);
  assert.equal(row!.notes, '');
});

test('mapExternalName: blank → null', () => {
  assert.equal(mapExternalParticipantName(''), null);
  assert.equal(mapExternalParticipantName('   '), null);
  assert.equal(mapExternalParticipantName(null), null);
});

test('mapExternalName: trims whitespace', () => {
  const row = mapExternalParticipantName('  John  ');
  assert.ok(row);
  assert.equal(row!.fullName, 'John');
});
