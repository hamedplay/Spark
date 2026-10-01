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
    participantId: null,
    userId: '',
    nameSnapshot: '',
    positionSnapshot: '',
    orgUnitId: '',
    orgUnitNameSnapshot: '',
    invitationStatus: 'invited',
    attendanceStatus: null,
    delegate: '',
    delegateUserId: null,
    delegateName: '',
    notes: '',
    isSignatory: false,
    source: 'manual',
    ...overrides,
  };
}

// ── resolveEligibleSystemApprovers ─────────────────────────────────────────

test('system mode includes only selected internal signatories with a valid user_id', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', nameSnapshot: 'علی', isSignatory: true }),
    participant({ id: 'p-2', userId: 'user-b', nameSnapshot: 'سارا', isSignatory: false }),
    participant({ id: 'p-3', userId: 'user-c', nameSnapshot: 'رضا', isSignatory: true }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  assert.equal(eligible.length, 2);
  assert.deepEqual(
    eligible.map(e => e.userId),
    ['user-a', 'user-c'],
  );
});

test('system signatory selection is independent of attendance status', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', attendanceStatus: 'present', isSignatory: true }),
    participant({ id: 'p-2', userId: 'user-b', attendanceStatus: 'absent', isSignatory: true }),
    participant({ id: 'p-3', userId: 'user-c', attendanceStatus: null, isSignatory: false }),
    participant({ id: 'p-4', userId: 'user-d', attendanceStatus: 'late', isSignatory: true }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  assert.equal(eligible.length, 3);
  assert.deepEqual(
    eligible.map(e => e.userId),
    ['user-a', 'user-b', 'user-d'],
  );
});

test('system mode excludes a selected signer without a user_id', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', isSignatory: true }),
    participant({ id: 'p-2', userId: '', isSignatory: true }),
    participant({ id: 'p-3', userId: 'user-c', isSignatory: false }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  assert.equal(eligible.length, 1);
  assert.deepEqual(eligible.map(e => e.userId), ['user-a']);
});

test('system mode with no selected signatories yields zero approvers', () => {
  const eligible = resolveEligibleSystemApprovers([
    participant({ userId: 'user-a', isSignatory: false }),
  ]);
  assert.equal(eligible.length, 0);
});

test('system mode preserves selected participant id and name snapshot', () => {
  const participants = [
    participant({ id: 'p-7', userId: 'user-x', nameSnapshot: 'مریم احمدی', isSignatory: true }),
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

test('eligibility: system mode with a selected eligible signer can submit', () => {
  const participants = [participant({ userId: 'user-a', isSignatory: true })];
  const check = checkSystemApproverEligibility('system', participants);
  assert.equal(check.canSubmit, true);
  assert.equal(check.errorMessage, null);
});

test('eligibility: system mode with participants but no selected signer is blocked', () => {
  const participants = [participant({ userId: 'user-a', isSignatory: false })];
  const check = checkSystemApproverEligibility('system', participants);
  assert.equal(check.canSubmit, false);
  assert.ok(check.errorMessage);
  assert.match(check.errorMessage!, /امضاکننده/);
});

test('eligibility: system mode with only a selected signer without user_id is blocked', () => {
  const participants = [participant({ userId: '', isSignatory: true })];
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

test('revision contract: duplicate selected user_id values remain backend-deduplicable', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'user-a', nameSnapshot: 'علی', isSignatory: true }),
    participant({ id: 'p-2', userId: 'user-a', nameSnapshot: 'علی (دبیر)', isSignatory: true }),
    participant({ id: 'p-3', userId: 'user-b', nameSnapshot: 'سارا', isSignatory: true }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  assert.equal(eligible.length, 3);
  const distinctUsers = new Set(eligible.map(e => e.userId));
  assert.equal(distinctUsers.size, 2);
});

test('secretary/chair are approvers only when explicitly selected as signatories', () => {
  const participants = [
    participant({ id: 'p-1', userId: 'secretary-user', nameSnapshot: 'دبیر', isSignatory: false }),
    participant({ id: 'p-2', userId: 'chair-user', nameSnapshot: 'رئیس', isSignatory: true }),
    participant({ id: 'p-3', userId: 'member-user', nameSnapshot: 'عضو', isSignatory: true }),
  ];
  const eligible = resolveEligibleSystemApprovers(participants);
  const userIds = eligible.map(e => e.userId);
  assert.ok(!userIds.includes('secretary-user'));
  assert.ok(userIds.includes('chair-user'));
  assert.ok(userIds.includes('member-user'));
});
