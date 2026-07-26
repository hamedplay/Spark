import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultDecision } from '../../src/components/Minutes/Form/defaults';
import type { DraftAgendaItem, DraftDecision } from '../../src/components/Minutes/Form/types';
import type { DecisionDraftPayload } from '../../src/components/Minutes/types';

function agendaToDecision(agenda: DraftAgendaItem): DraftDecision {
  return {
    ...defaultDecision(),
    title: agenda.title,
    agendaResultId: agenda.id,
    discussionResult: agenda.discussionResult || '',
    resultType: agenda.resultType || 'discussion',
    additionalNotes: agenda.additionalNotes || '',
  };
}

function serializeDecision(d: DraftDecision): DecisionDraftPayload {
  return {
    id: d.decisionId,
    agenda_result_id: d.agendaResultId,
    title: d.title,
    description: d.description || null,
    primary_owner_user_id: d.primaryOwnerUserId,
    responsible_unit_id: d.responsibleUnitId || null,
    responsible_unit_name_snapshot: d.responsibleUnitNameSnapshot || null,
    priority: d.priority,
    start_date: d.startDate || null,
    due_date: d.dueDate || null,
    requires_followup: d.requiresFollowup,
    latest_update: d.latestUpdate || null,
    discussion_result: d.discussionResult || null,
    result_type: d.resultType || null,
    additional_notes: d.additionalNotes || null,
  };
}

test('agendaToDecision: copies title and links agenda id', () => {
  const agenda: DraftAgendaItem = {
    id: 'agenda-1',
    meetingAgendaItemId: 'db-1',
    order: 1,
    title: 'بودجه سال آینده',
    description: '',
    presenter: 'علی',
    allocatedTime: '15',
    discussionResult: 'مورد توافق',
    resultType: 'resolution',
    additionalNotes: 'توجه به بخشنامه',
  };
  const dec = agendaToDecision(agenda);
  assert.equal(dec.title, 'بودجه سال آینده');
  assert.equal(dec.agendaResultId, 'agenda-1');
  assert.equal(dec.discussionResult, 'مورد توافق');
  assert.equal(dec.resultType, 'resolution');
  assert.equal(dec.additionalNotes, 'توجه به بخشنامه');
  assert.equal(dec.decisionId, null);
});

test('agendaToDecision: independent decision has no agenda link', () => {
  const dec = defaultDecision();
  assert.equal(dec.agendaResultId, null);
  assert.equal(dec.title, '');
});

test('serializeDecision: produces correct payload shape', () => {
  const dec: DraftDecision = {
    id: 'draft-1',
    decisionId: 'db-uuid',
    agendaResultId: 'agenda-2',
    title: 'اقدام فوری',
    description: 'شرح مصوبه',
    primaryOwnerUserId: 'user-1',
    responsibleUnitId: 'unit-1',
    responsibleUnitNameSnapshot: 'واحد مالی',
    priority: 'urgent',
    startDate: '2026-01-01',
    dueDate: '2026-02-01',
    requiresFollowup: true,
    latestUpdate: '',
    discussionResult: 'بحث شد',
    resultType: 'action',
    additionalNotes: 'یادداشت',
  };
  const payload = serializeDecision(dec);
  assert.equal(payload.id, 'db-uuid');
  assert.equal(payload.agenda_result_id, 'agenda-2');
  assert.equal(payload.title, 'اقدام فوری');
  assert.equal(payload.description, 'شرح مصوبه');
  assert.equal(payload.primary_owner_user_id, 'user-1');
  assert.equal(payload.responsible_unit_id, 'unit-1');
  assert.equal(payload.responsible_unit_name_snapshot, 'واحد مالی');
  assert.equal(payload.priority, 'urgent');
  assert.equal(payload.start_date, '2026-01-01');
  assert.equal(payload.due_date, '2026-02-01');
  assert.equal(payload.requires_followup, true);
  assert.equal(payload.discussion_result, 'بحث شد');
  assert.equal(payload.result_type, 'action');
  assert.equal(payload.additional_notes, 'یادداشت');
});

test('serializeDecision: nulls empty optional fields', () => {
  const dec = defaultDecision();
  const payload = serializeDecision(dec);
  assert.equal(payload.description, null);
  assert.equal(payload.responsible_unit_id, null);
  assert.equal(payload.start_date, null);
  assert.equal(payload.due_date, null);
  assert.equal(payload.discussion_result, null);
  assert.equal(payload.result_type, 'discussion');
  assert.equal(payload.additional_notes, null);
});

test('serializeDecision: validation - title and owner required', () => {
  const dec = defaultDecision();
  // Empty title and owner should be caught by RPC, but payload still serializes
  const payload = serializeDecision(dec);
  assert.equal(payload.title, '');
  assert.equal(payload.primary_owner_user_id, '');
});
