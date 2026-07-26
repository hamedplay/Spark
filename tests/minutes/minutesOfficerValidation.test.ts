import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateOfficer,
  validateSecretaryAndChair,
  type MeetingMembership,
} from '../../src/lib/minutesOfficerValidation';

const OWNER = 'owner-1';
const MANAGER = 'manager-1';
const PARTICIPANT_A = 'user-a';
const PARTICIPANT_B = 'user-b';
const UNRELATED_USER = 'unrelated-1';

const knownUsers = new Set([OWNER, MANAGER, PARTICIPANT_A, PARTICIPANT_B, UNRELATED_USER]);

const membership: MeetingMembership = {
  meetingOwnerId: OWNER,
  meetingManagerId: MANAGER,
  participantUserIds: [PARTICIPANT_A, PARTICIPANT_B],
};

test('secretary: valid internal participant → valid', () => {
  const r = validateOfficer('secretary', PARTICIPANT_A, knownUsers, membership);
  assert.equal(r.valid, true);
});

test('chair: valid internal participant → valid', () => {
  const r = validateOfficer('chair', PARTICIPANT_B, knownUsers, membership);
  assert.equal(r.valid, true);
});

test('officer: unrelated user (not in meeting) → INVALID_NOT_MEETING_PARTICIPANT', () => {
  const r = validateOfficer('secretary', UNRELATED_USER, knownUsers, membership);
  assert.equal(r.valid, false);
  assert.equal(r.errorCode, 'SECRETARY_NOT_MEETING_PARTICIPANT');
});

test('officer: external participant id not in known users → USER_NOT_FOUND', () => {
  const externalOnly = 'external-1';
  const r = validateOfficer('chair', externalOnly, knownUsers, membership);
  assert.equal(r.valid, false);
  assert.equal(r.errorCode, 'CHAIR_USER_NOT_FOUND');
});

test('officer: null value → valid (allowed per existing behavior)', () => {
  const r = validateOfficer('secretary', null, knownUsers, membership);
  assert.equal(r.valid, true);
});

test('secretary and chair can be the same person', () => {
  const r = validateSecretaryAndChair(PARTICIPANT_A, PARTICIPANT_A, knownUsers, membership);
  assert.equal(r.secretary.valid, true);
  assert.equal(r.chair.valid, true);
});

test('meeting owner is a valid officer', () => {
  const r = validateOfficer('chair', OWNER, knownUsers, membership);
  assert.equal(r.valid, true);
});

test('meeting manager is a valid officer', () => {
  const r = validateOfficer('secretary', MANAGER, knownUsers, membership);
  assert.equal(r.valid, true);
});
