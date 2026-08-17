import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveEligibleSystemApprovers,
  shouldCreateApproverRows,
  checkSystemApproverEligibility,
} from '../../src/lib/minutesApprovalEligibility';
import type { DraftInternalParticipant } from '../../src/components/Minutes/Form/types';

function participant(overrides: Partial<DraftInternalParticipant> = {}): DraftInternalParticipant {
  return {
    id: 'p-1',
    userId: '',
    nameSnapshot: '',
    positionSnapshot: '',
    orgUnitId: null,
    orgUnitNameSnapshot: '',
    invitationStatus: 'invited',
    attendanceStatus: null,
    delegate: '',
    notes: '',
    ...overrides,
  };
}

// ── resolveEligibleSystemApprovers ─────────────────────────────────────────

test('system mode includes all internal participants with a valid user_id', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', nameSnapshot: 'علی' }),
    participant({ id: 'p-2', userId: 'user-b', nameSnapshot: 'سارا' }),
    participant({ id: 'p-3', userId: 'user-c', nameSnapshot: 'رضا' }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  assert.equal(eligible.length, 3);
  assert.deepEqual(
    eligible.map(e => e.userId),
    ['user-a', 'user-b', 'user-c'],
  );
});

test('system mode is independent of attendance status', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', attendanceStatus: 'present' }),
    participant({ id: 'p-2', userId: 'user-b', attendanceStatus: 'absent' }),
    participant({ id: 'p-3', userId: 'user-c', attendanceStatus: null }),
    participant({ id: 'p-4', userId: 'user-d', attendanceStatus: 'late' }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  // All four are included regardless of attendance — attendance is NOT a condition
  assert.equal(eligible.length, 4);
  assert.deepEqual(
    eligible.map(e => e.userId),
    ['user-a', 'user-b', 'user-c', 'user-d'],
  );
});

test('system mode excludes participants without a user_id (external-only)', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a' }),
    participant({ id: 'p-2', userId: '' }),
    participant({ id: 'p-3', userId: 'user-c' }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  assert.equal(eligible.length, 2);
  assert.deepEqual(
    eligible.map(e => e.userId),
    ['user-a', 'user-c'],
  );
});

test('system mode with no internal participants yields zero approvers', () => {
  const eligible = resolveEligibleSystemApprovers([]);
  assert.equal(eligible.length, 0);
});

test('system mode preserves participant id and name snapshot', () => {
  const participants = [
    participant({ id: 'p-7', userId: 'user-x', nameSnapshot: 'مریم احمدی' }),
  ];
  const [first] = resolveEligibleSystemApprovers(participants);
  assert.equal(first.id, 'p-7');
  assert.equal(first.userId, 'user-x');
  assert.equal(first.nameSnapshot, 'مریم احمدی');
});

// ── shouldCreateApproverRows ───────────────────────────────────────────────

test('in-person mode creates no approver rows', () => {
  assert.equal(shouldCreateApproverRows('in_person'), false);
});

test('system mode creates approver rows', () => {
  assert.equal(shouldCreateApproverRows('system'), true);
});

test('empty approval mode creates no approver rows', () => {
  assert.equal(shouldCreateApproverRows(''), false);
});

// ── checkSystemApproverEligibility ─────────────────────────────────────────

test('eligibility: system mode with eligible participants → can submit', () => {
  const participants = [participant({ userId: 'user-a' })];
  const check = checkSystemApproverEligibility('system', participants);
  assert.equal(check.canSubmit, true);
  assert.equal(check.errorMessage, null);
});

test('eligibility: system mode with no eligible participants → blocked', () => {
  const check = checkSystemApproverEligibility('system', []);
  assert.equal(check.canSubmit, false);
  assert.ok(check.errorMessage);
  assert.match(check.errorMessage!, /سیستمی/);
});

test('eligibility: system mode with only external (no user_id) participants → blocked', () => {
  const participants = [
    participant({ id: 'p-1', userId: '' }),
    participant({ id: 'p-2', userId: '' }),
  ];
  const check = checkSystemApproverEligibility('system', participants);
  assert.equal(check.canSubmit, false);
});

test('eligibility: in-person mode never blocked by participant count', () => {
  const check = checkSystemApproverEligibility('in_person', []);
  assert.equal(check.canSubmit, true);
  assert.equal(check.errorMessage, null);
});

test('eligibility: empty mode never blocked by participant count', () => {
  const check = checkSystemApproverEligibility('', []);
  assert.equal(check.canSubmit, true);
  assert.equal(check.errorMessage, null);
});

// ── revision / duplicate handling contract ─────────────────────────────────
// The unique constraint (minute_id, revision_number, approver_user_id) plus the
// ON CONFLICT DO UPDATE clause in submit_minutes_for_approval ensures that
// re-submitting for the same revision does not create duplicate rows. These
// tests document the frontend contract that mirrors that behavior.

test('revision contract: same user_id set deduplicates approver candidates', () => {
  // If the same user appears twice in the participants list (e.g. secretary also
  // listed as a participant), the backend DISTINCT + unique constraint ensures
  // one approver row. The frontend candidate list should reflect distinct users.
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', nameSnapshot: 'علی' }),
    participant({ id: 'p-2', userId: 'user-a', nameSnapshot: 'علی (دبیر)' }),
    participant({ id: 'p-3', userId: 'user-b', nameSnapshot: 'سارا' }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  // Frontend lists all eligible; backend deduplicates via DISTINCT.
  // The contract is that all entries with a valid user_id are candidates.
  assert.equal(eligible.length, 3);
  const distinctUsers = new Set(eligible.map(e => e.userId));
  assert.equal(distinctUsers.size, 2);
});

test('secretary/chair included when they are internal participants', () => {
  // Secretary and chair must NOT be silently dropped from the approver list
  // when they are internal participants with a valid user_id.
  const participants = [
    participant({ id: 'p-1', userId: 'secretary-user', nameSnapshot: 'دبیر' }),
    participant({ id: 'p-2', userId: 'chair-user', nameSnapshot: 'رئیس' }),
    participant({ id: 'p-3', userId: 'member-user', nameSnapshot: 'عضو' }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  const userIds = eligible.map(e => e.userId);
  assert.ok(userIds.includes('secretary-user'));
  assert.ok(userIds.includes('chair-user'));
  assert.ok(userIds.includes('member-user'));
});
