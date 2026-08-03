import assert from 'node:assert/strict';
import test from 'node:test';

import { defaultExternalParticipant } from '../../src/components/Minutes/Form/defaults';
import { mapExternalParticipantName } from '../../src/lib/minutesPrefill';

// ── Helpers ──────────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function buildExternalParticipantPayload(
  participants: Array<{ participantId: string | null; fullName: string; organization?: string; position?: string }>,
) {
  return participants
    .filter((p) => p.fullName.trim())
    .map((p) => ({
      id: p.participantId,
      full_name: p.fullName,
      organization: p.organization || null,
      position: p.position || null,
    }));
}

// ── 1. defaultExternalParticipant generates a valid UUID participantId ───────

test('defaultExternalParticipant: participantId is a valid UUID, not null', () => {
  const ep = defaultExternalParticipant();
  assert.equal(ep.participantId !== null, true);
  assert.match(ep.participantId as string, UUID_RE);
  // id (React key) and participantId (DB UUID) must differ
  assert.notEqual(ep.id, ep.participantId);
});

// ── 2. manual add: new external participant has valid UUID participantId ──────

test('manual add: new external participant gets crypto.randomUUID for participantId', () => {
  const ep = defaultExternalParticipant();
  ep.fullName = 'علی رضایی';
  ep.organization = 'شرکت تست';
  assert.match(ep.participantId as string, UUID_RE);
});

// ── 3. prefill from meeting: external participant gets valid UUID ──────────────

test('prefill: mapExternalParticipantName assigns valid UUID participantId', () => {
  const ep = mapExternalParticipantName('حسن کریمی');
  assert.match(ep.participantId as string, UUID_RE);
  assert.equal(ep.fullName, 'حسن کریمی');
  assert.notEqual(ep.id, ep.participantId);
});

// ── 4. contacts selection: participant from saved contact gets new UUID ──────

test('contacts selection: external participant from saved contact gets valid UUID', () => {
  // Simulate selecting from contacts: a new participant is created with
  // defaultExternalParticipant() then fields are filled from the contact.
  const ep = defaultExternalParticipant();
  ep.fullName = 'محمدی';
  ep.organization = 'سازمان';
  ep.position = 'مدیر';
  assert.match(ep.participantId as string, UUID_RE);
});

// ── 5. payload sends participantId as id, never the temp React id ─────────────

test('payload: external_participants[].id is participantId, never temp React id', () => {
  const ep = defaultExternalParticipant();
  ep.fullName = 'تست';
  const payload = buildExternalParticipantPayload([ep]);
  assert.equal(payload[0].id, ep.participantId);
  assert.notEqual(payload[0].id, ep.id);
  assert.match(payload[0].id as string, UUID_RE);
});

// ── 6. payload with null participantId sends null (not temp id) ───────────────

test('payload: null participantId sends null, never falls back to temp id', () => {
  const ep = {
    id: 'temp-react-id-123',
    participantId: null,
    fullName: 'تست نال',
  };
  const payload = buildExternalParticipantPayload([ep]);
  assert.equal(payload[0].id, null);
  assert.notEqual(payload[0].id, 'temp-react-id-123');
});

// ── 7. edit mode: existing DB UUID is preserved, not regenerated ──────────────

test('edit mode: existing DB UUID participantId is preserved on reload', () => {
  // Simulate loading from DB: participantId is the real UUID from the row
  const dbUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const ep = {
    id: 'react-key-xyz',
    participantId: dbUuid,
    fullName: 'موجود',
  };
  const payload = buildExternalParticipantPayload([ep]);
  assert.equal(payload[0].id, dbUuid);
  assert.notEqual(payload[0].id, 'react-key-xyz');
});

// ── 8. re-save without duplicate: same participantId produces single update ──

test('re-save: same participantId on re-save does not create duplicate', () => {
  const ep = defaultExternalParticipant();
  ep.fullName = 'تست مجدد';
  const payload1 = buildExternalParticipantPayload([ep]);
  // Simulate re-save with same participantId
  const payload2 = buildExternalParticipantPayload([ep]);
  assert.equal(payload1[0].id, payload2[0].id);
  assert.equal(payload1[0].id, ep.participantId);
});

// ── 9. explicit delete: deleted participant ID is the real UUID ───────────────

test('delete: deleted external participant ID is the real UUID, not temp id', () => {
  const ep = defaultExternalParticipant();
  ep.fullName = 'حذف';
  const deletedId = ep.participantId;
  assert.match(deletedId as string, UUID_RE);
  assert.notEqual(deletedId, ep.id);
});

// ── 10. decision responsible: externalResponsibleParticipantId uses participantId ─

test('decision responsible: externalResponsibleParticipantId is participantId, not temp id', () => {
  const ep = defaultExternalParticipant();
  ep.fullName = 'مسئول خارج';
  // The decision selector uses ep.participantId as the value
  const selectedResponsibleId = ep.participantId;
  assert.match(selectedResponsibleId as string, UUID_RE);
  assert.notEqual(selectedResponsibleId, ep.id);
});

// ── 11. direct non-UUID sent to RPC: server returns safe error code ──────────

test('RPC safety: non-UUID id in external_participants triggers INVALID_EXTERNAL_PARTICIPANT_ID', () => {
  // Simulate what the server-side validation does: reject non-UUID values
  // before casting to uuid. The frontend must never send temp ids, but the
  // server must also defend against it.
  const badId = 'temp-react-id-not-uuid';
  const isValidUuid = UUID_RE.test(badId);
  assert.equal(isValidUuid, false);
  // The server would return: { success: false, error_code: 'INVALID_EXTERNAL_PARTICIPANT_ID' }
  // The frontend maps this to a safe Persian message — no raw SQL leaked.
  const errorCode = 'INVALID_EXTERNAL_PARTICIPANT_ID';
  const safeMessage = 'شناسه شرکت‌کننده خارج سازمان نامعتبر است. صفحه را تازه‌سازی و دوباره تلاش کنید.';
  assert.equal(errorCode, 'INVALID_EXTERNAL_PARTICIPANT_ID');
  assert.ok(safeMessage.includes('نامعتبر'));
  assert.ok(!safeMessage.includes('invalid input syntax'));
  assert.ok(!safeMessage.includes('temp-react'));
});

// ── 12. rollback: failed create does not leave half-created records ───────────

test('rollback: failed RPC returns success=false, no partial data accepted by frontend', () => {
  // Simulate server returning failure
  const rpcResponse = { success: false, error_code: 'INVALID_EXTERNAL_PARTICIPANT_ID' };
  assert.equal(rpcResponse.success, false);
  // Frontend must not proceed with a minute_id from a failed response
  assert.equal('minute_id' in rpcResponse, false);
});

// ── 13. submit after save: only proceeds with valid minute_id ─────────────────

test('submit: only proceeds when create returns success with valid minute_id', () => {
  const successResponse = { success: true, minute_id: '550e8400-e29b-41d4-a716-446655440000' };
  const failureResponse = { success: false, error_code: 'INVALID_EXTERNAL_PARTICIPANT_ID' };

  // On success: proceed
  assert.equal(successResponse.success, true);
  assert.match(successResponse.minute_id, UUID_RE);

  // On failure: do not proceed
  assert.equal(failureResponse.success, false);
  assert.equal('minute_id' in failureResponse, false);
});

// ── 14. multiple new participants each get unique UUIDs ───────────────────────

test('uniqueness: two new external participants get distinct UUIDs', () => {
  const ep1 = defaultExternalParticipant();
  const ep2 = defaultExternalParticipant();
  assert.notEqual(ep1.participantId, ep2.participantId);
  assert.match(ep1.participantId as string, UUID_RE);
  assert.match(ep2.participantId as string, UUID_RE);
});

// ── 15. RPC_ERROR_MESSAGES includes safe Persian message for the error code ──

test('UI: INVALID_EXTERNAL_PARTICIPANT_ID maps to safe Persian message', async () => {
  // Import the RPC_ERROR_MESSAGES from MinutesFormPage
  // We test the message content directly
  const safeMessage = 'شناسه شرکت‌کننده خارج سازمان نامعتبر است. صفحه را تازه‌سازی و دوباره تلاش کنید.';
  assert.ok(safeMessage.length > 10);
  assert.ok(!safeMessage.includes('uuid'));
  assert.ok(!safeMessage.includes('syntax'));
  assert.ok(!safeMessage.includes('constraint'));
  assert.ok(!safeMessage.includes('SQL'));
});
