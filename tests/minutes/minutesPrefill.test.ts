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
