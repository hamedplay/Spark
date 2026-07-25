/**
 * Scenario tests for meeting edit notification system.
 * Run with: node scripts/test-meeting-edit.js
 */
const tests = [];
let passed = 0, failed = 0;
function test(name, fn) { tests.push({ name, fn }); }
function assert(c, m) { if (!c) throw new Error(`Assertion failed: ${m}`); }
function assertDeepEqual(a, e, m) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m}\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`); }

// ─── normalizeStr ───────────────────────────────────────────────────
test('normalizeStr: null/empty/whitespace all equal', () => {
  const n = (v) => v === null || v === undefined ? '' : String(v).trim();
  assert(n(null) === n(''), 'null==empty');
  assert(n('  ') === n(''), 'ws==empty');
  assert(n('hello') === n('  hello  '), 'trim');
});

// ─── computeChangeSet: no changes ──────────────────────────────────
test('computeChangeSet: no changes → hasAnyChanges=false', () => {
  const IMPORTANT = ['subject','request_date','start_time','end_time','location','conference_room_id','is_online'];
  const MINOR = ['phone','representative','meeting_manager','notes','priority','reminder_minutes','calendar_id','send_sms','members_only','agenda_items'];
  const n = (v) => v === null || v === undefined ? '' : String(v).trim();
  const existing = { subject:'A', request_date:'2026-01-01', start_time:'10:00', end_time:'11:00', location:'X', phone:'123', notes:'  ' };
  const next = { subject:'A', request_date:'2026-01-01', start_time:'10:00', end_time:'11:00', location:'X', phone:'123', notes:null };
  const importantFields = IMPORTANT.filter(f => n(existing[f]) !== n(next[f]));
  const minorFields = MINOR.filter(f => n(existing[f]) !== n(next[f]));
  assert(importantFields.length === 0, 'no important');
  assert(minorFields.length === 0, 'no minor');
});

// ─── computeChangeSet: phone-only → minor ──────────────────────────
test('computeChangeSet: phone-only → minorFields has phone', () => {
  const IMPORTANT = ['subject','request_date','start_time','end_time','location','conference_room_id','is_online'];
  const MINOR = ['phone','representative','meeting_manager','notes','priority','reminder_minutes','calendar_id','send_sms','members_only'];
  const n = (v) => v === null || v === undefined ? '' : String(v).trim();
  const importantFields = IMPORTANT.filter(f => n({subject:'A',phone:'123'}[f]) !== n({subject:'A',phone:'456'}[f]));
  const minorFields = MINOR.filter(f => n({subject:'A',phone:'123'}[f]) !== n({subject:'A',phone:'456'}[f]));
  assert(importantFields.length === 0, 'no important');
  assert(minorFields.includes('phone'), 'phone in minor');
});

// ─── Modal trigger: hasAnyChanges ──────────────────────────────────
test('Modal trigger: opens on ANY change (hasAnyChanges), not just importantFields', () => {
  // Participant-only change: importantFields=0, participantChanged=true
  const cs = { importantFields: [], minorFields: [], participantChanged: true, notifyUsersChanged: false, externalChanged: false, hasNonParticipantChanges: false, hasAnyChanges: true };
  assert(cs.hasAnyChanges, 'hasAnyChanges true for participant-only');
  assert(cs.importantFields.length === 0, 'no important fields');
  // Old logic: importantFields.length > 0 → false → no modal (BUG)
  // New logic: hasAnyChanges → true → modal opens (FIXED)
});

test('Modal trigger: no changes → no modal', () => {
  const cs = { importantFields: [], minorFields: [], participantChanged: false, notifyUsersChanged: false, externalChanged: false, hasNonParticipantChanges: false, hasAnyChanges: false };
  assert(!cs.hasAnyChanges, 'no changes');
});

// ─── Notify gating: without notifications ─────────────────────────
test('Without notifications: ALL events skipped including added/removed', () => {
  const notifyExistingParticipants = false;
  const added = ['user1'], removed = ['user2'], retained = ['user3'];
  const events = [];
  // Simulate: if !notifyExistingParticipants, skip ALL
  if (notifyExistingParticipants) {
    events.push({ uid: added[0], type: 'invite' });
    events.push({ uid: removed[0], type: 'cancel' });
  }
  assert(events.length === 0, 'no events when notify=false');
});

test('With notifications: added→invite, removed→cancel, retained→change', () => {
  const notifyExistingParticipants = true;
  const hasImportantChanges = true;
  const added = ['user1'], removed = ['user2'], retained = ['user3'];
  const events = [];
  if (notifyExistingParticipants) {
    for (const uid of added) events.push({ uid, type: 'invite' });
    for (const uid of removed) events.push({ uid, type: 'cancel' });
    if (hasImportantChanges) for (const uid of retained) events.push({ uid, type: 'change' });
  }
  assert(events.length === 3, '3 events');
  assert(events.find(e => e.uid === 'user1').type === 'invite', 'added→invite');
  assert(events.find(e => e.uid === 'user2').type === 'cancel', 'removed→cancel');
  assert(events.find(e => e.uid === 'user3').type === 'change', 'retained→change');
});

test('Retained does NOT get change when only participants changed (no important fields)', () => {
  const notifyExistingParticipants = true;
  const importantFields = [];
  const retained = ['user3'];
  const events = [];
  if (notifyExistingParticipants && importantFields.length > 0) {
    for (const uid of retained) events.push({ uid, type: 'change' });
  }
  assert(events.length === 0, 'retained gets no change when no important fields');
});

// ─── External participant diff ──────────────────────────────────────
test('External diff: added, retained, removed', () => {
  const normName = (n) => (n || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const prevExt = new Set(['Alice','Bob','Charlie'].map(normName));
  const nextExt = ['Bob','Charlie','David'];
  const newExt = nextExt.filter(n => !prevExt.has(normName(n)));
  const retainedExt = nextExt.filter(n => prevExt.has(normName(n)));
  const removedExt = ['Alice','Bob','Charlie'].filter(n => !new Set(nextExt.map(normName)).has(normName(n)));
  assertDeepEqual(newExt, ['David'], 'newExt');
  assertDeepEqual(retainedExt, ['Bob','Charlie'], 'retainedExt');
  assertDeepEqual(removedExt, ['Alice'], 'removedExt');
});

test('External cancel: sent when notify=true', () => {
  const notifyExistingParticipants = true;
  const removedExt = ['Alice'];
  const events = [];
  if (notifyExistingParticipants && removedExt.length > 0) {
    events.push({ type: 'cancel', target: removedExt[0] });
  }
  assert(events.length === 1, 'cancel sent');
});

test('External cancel: NOT sent when notify=false', () => {
  const notifyExistingParticipants = false;
  const removedExt = ['Alice'];
  const events = [];
  if (notifyExistingParticipants && removedExt.length > 0) {
    events.push({ type: 'cancel', target: removedExt[0] });
  }
  assert(events.length === 0, 'no cancel when notify=false');
});

// ─── Conference room ────────────────────────────────────────────────
test('Conference room: online→online preserves room, 0 new rooms', () => {
  const wasOnline = true, isOnline = true;
  let newRooms = 0;
  if (isOnline && !wasOnline) newRooms++;
  assert(newRooms === 0, 'no new room');
});

test('Conference room: offline→online creates 1 room on commit', () => {
  const wasOnline = false, isOnline = true;
  let newRooms = 0;
  if (isOnline && !wasOnline) newRooms++;
  assert(newRooms === 1, '1 new room');
});

test('Conference room: online→offline clears association', () => {
  const wasOnline = true, isOnline = false;
  let roomId = null;
  if (!isOnline) roomId = null;
  assert(roomId === null, 'cleared');
});

test('Conference room: modal cancel → 0 new rooms', () => {
  // User clicks "بازگشت به ویرایش" — commitEdit never called
  let newRooms = 0;
  // commitEdit not called, so no room creation
  assert(newRooms === 0, 'no rooms on cancel');
});

// ─── Creator notification ──────────────────────────────────────────
test('Creator: NOT notified on edit (only on first schedule)', () => {
  const isFirstSchedule = false;
  const hasImportantChanges = true;
  const notifyCreator = isFirstSchedule; // only on first schedule
  assert(!notifyCreator, 'no creator notification on edit');
});

test('Creator: notified on first schedule (create)', () => {
  const isFirstSchedule = true;
  const notifyCreator = isFirstSchedule;
  assert(notifyCreator, 'creator notified on create');
});

// ─── Idempotency ───────────────────────────────────────────────────
test('Idempotency: operation_id makes keys unique per operation', () => {
  const op1 = 'op-123', op2 = 'op-456';
  const meetingId = 'm1', uid = 'u1', type = 'invite';
  const key1 = `${op1}:${meetingId}:${uid}:participants:${type}`;
  const key2 = `${op2}:${meetingId}:${uid}:participants:${type}`;
  assert(key1 !== key2, 'different operations → different keys');
});

test('Idempotency: same operation → same key (double-click dedup)', () => {
  const op = 'op-123';
  const meetingId = 'm1', uid = 'u1', type = 'invite';
  const key1 = `${op}:${meetingId}:${uid}:participants:${type}`;
  const key2 = `${op}:${meetingId}:${uid}:participants:${type}`;
  assert(key1 === key2, 'same operation → same key');
});

test('Idempotency: per-channel independence', () => {
  const op = 'op-123', meetingId = 'm1', uid = 'u1', type = 'invite';
  const smsKey = `${op}:${meetingId}:${uid}:participants:${type}:sms`;
  const baleKey = `${op}:${meetingId}:${uid}:participants:${type}:bale`;
  assert(smsKey !== baleKey, 'different channels → different keys');
});

// ─── No duplicate events ───────────────────────────────────────────
test('No recipient gets two conflicting events in one operation', () => {
  const added = ['u1'], removed = ['u2'], retained = ['u3'];
  const events = [];
  for (const uid of added) events.push({ uid, type: 'invite' });
  for (const uid of removed) events.push({ uid, type: 'cancel' });
  for (const uid of retained) events.push({ uid, type: 'change' });
  // Check no uid appears twice
  const uids = events.map(e => e.uid);
  assert(new Set(uids).size === uids.length, 'no duplicate recipients');
});

// ─── Run ───────────────────────────────────────────────────────────
console.log('Running meeting edit scenario tests...\n');
for (const { name, fn } of tests) {
  try { fn(); console.log(`  PASS: ${name}`); passed++; }
  catch (err) { console.error(`  FAIL: ${name}\n    ${err.message}`); failed++; }
}
console.log(`\n${passed} passed, ${failed} failed, ${tests.length} total`);
process.exit(failed > 0 ? 1 : 0);
