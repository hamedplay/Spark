import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { defaultDecision, defaultInfo } from '../../src/components/Minutes/Form/defaults';
import type { DraftAgendaItem, DraftDecision } from '../../src/components/Minutes/Form/types';
import { buildDecisionsPayload, validateMinutesForm } from '../../src/components/Minutes/MinutesFormPayload';

function agendaToDecision(agenda: DraftAgendaItem): DraftDecision {
  return {
    ...defaultDecision(),
    title: agenda.title,
    meetingAgendaItemId: agenda.meetingAgendaItemId || null,
    agendaResultId: null,
    discussionResult: agenda.discussionResult || '',
    resultType: agenda.resultType || 'discussion',
    additionalNotes: agenda.additionalNotes || '',
  };
}

function validInfo() {
  return {
    ...defaultInfo,
    meetingId: 'meeting-1',
    meetingTitle: 'جلسه آزمون',
    meetingDate: '2026-08-19',
    secretaryUserId: 'secretary-1',
    chairUserId: 'chair-1',
  };
}

test('defaultDecision: assigns a stable UUID before first save', () => {
  const decision = defaultDecision();
  assert.match(decision.decisionId || '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(decision.parentDecisionId, null);
  assert.equal(decision.clauseOrder, null);
});

test('agendaToDecision: copies title and links via meetingAgendaItemId', () => {
  const agenda: DraftAgendaItem = {
    id: 'agenda-1',
    meetingAgendaItemId: 'db-agenda-1',
    order: 1,
    title: 'بودجه سال آینده',
    description: '',
    presenter: 'علی',
    allocatedTime: '15',
    discussionResult: 'مورد توافق',
    resultType: 'resolution',
    additionalNotes: 'توجه به بخشنامه',
  };
  const decision = agendaToDecision(agenda);
  assert.equal(decision.title, 'بودجه سال آینده');
  assert.equal(decision.meetingAgendaItemId, 'db-agenda-1');
  assert.equal(decision.agendaResultId, null);
  assert.equal(decision.discussionResult, 'مورد توافق');
  assert.equal(decision.resultType, 'resolution');
  assert.equal(decision.additionalNotes, 'توجه به بخشنامه');
  assert.ok(decision.decisionId);
});

test('agendaToDecision: never stores temp React id as agendaResultId', () => {
  const agenda: DraftAgendaItem = {
    id: 'temp-react-id',
    meetingAgendaItemId: 'real-db-id',
    order: 1,
    title: 'test',
    description: '',
    presenter: '',
    allocatedTime: '',
    discussionResult: '',
    resultType: 'discussion',
    additionalNotes: '',
  };
  const decision = agendaToDecision(agenda);
  assert.equal(decision.agendaResultId, null);
  assert.notEqual(decision.agendaResultId, 'temp-react-id');
  assert.equal(decision.meetingAgendaItemId, 'real-db-id');
});

test('buildDecisionsPayload: standalone decision keeps its own execution fields', () => {
  const decision: DraftDecision = {
    ...defaultDecision(),
    title: 'اقدام فوری',
    description: 'شرح مصوبه',
    meetingAgendaItemId: 'db-agenda-2',
    primaryOwnerUserId: 'user-1',
    responsibleUnitId: 'unit-1',
    responsibleUnitNameSnapshot: 'واحد مالی',
    priority: 'urgent',
    startDate: '2026-08-20',
    dueDate: '2026-08-25',
    requiresFollowup: true,
  };

  const [payload] = buildDecisionsPayload([decision]);
  assert.equal(payload.id, decision.decisionId);
  assert.equal(payload.parent_decision_id, null);
  assert.equal(payload.clause_order, null);
  assert.equal(payload.meeting_agenda_item_id, 'db-agenda-2');
  assert.equal(payload.primary_owner_user_id, 'user-1');
  assert.equal(payload.responsible_unit_id, 'unit-1');
  assert.equal(payload.responsible_unit_name_snapshot, 'واحد مالی');
  assert.equal(payload.priority, 'urgent');
  assert.equal(payload.start_date, '2026-08-20');
  assert.equal(payload.due_date, '2026-08-25');
});

test('buildDecisionsPayload: parent and clauses are serialized atomically and parent mirrors first clause internally', () => {
  const parent: DraftDecision = {
    ...defaultDecision(),
    title: 'مصوبه مادر',
    description: 'تصمیم کلی جلسه',
    primaryOwnerUserId: '',
    responsibleUnitId: null,
    responsibleUnitNameSnapshot: '',
  };
  const clause1: DraftDecision = {
    ...defaultDecision(),
    parentDecisionId: parent.decisionId,
    clauseOrder: 1,
    title: 'بند اول',
    primaryOwnerUserId: 'user-1',
    responsibleUnitId: 'unit-1',
    responsibleUnitNameSnapshot: 'فناوری اطلاعات',
    priority: 'important',
    startDate: '2026-08-20',
    dueDate: '2026-09-06',
  };
  const clause2: DraftDecision = {
    ...defaultDecision(),
    parentDecisionId: parent.decisionId,
    clauseOrder: 2,
    title: 'بند دوم',
    primaryOwnerUserId: 'user-2',
    responsibleUnitId: 'unit-2',
    responsibleUnitNameSnapshot: 'برنامه‌ریزی',
    priority: 'normal',
    dueDate: '2026-10-07',
  };

  const payload = buildDecisionsPayload([parent, clause1, clause2]);
  assert.equal(payload.length, 3);

  const parentPayload = payload.find(item => item.id === parent.decisionId);
  const clause1Payload = payload.find(item => item.id === clause1.decisionId);
  const clause2Payload = payload.find(item => item.id === clause2.decisionId);

  assert.ok(parentPayload);
  assert.ok(clause1Payload);
  assert.ok(clause2Payload);
  assert.equal(parentPayload.parent_decision_id, null);
  assert.equal(parentPayload.clause_order, null);
  assert.equal(parentPayload.primary_owner_user_id, 'user-1');
  assert.equal(parentPayload.responsible_unit_id, 'unit-1');
  assert.equal(parentPayload.due_date, '2026-09-06');

  assert.equal(clause1Payload.parent_decision_id, parent.decisionId);
  assert.equal(clause1Payload.clause_order, 1);
  assert.equal(clause1Payload.primary_owner_user_id, 'user-1');
  assert.equal(clause2Payload.parent_decision_id, parent.decisionId);
  assert.equal(clause2Payload.clause_order, 2);
  assert.equal(clause2Payload.primary_owner_user_id, 'user-2');
});

test('validateMinutesForm: standalone decision requires its own owner', () => {
  const decision: DraftDecision = {
    ...defaultDecision(),
    title: 'مصوبه بدون بند',
    primaryOwnerUserId: '',
  };

  const error = validateMinutesForm({
    info: validInfo(),
    decisions: [decision],
    prefillLoading: false,
    prefillError: null,
  });
  assert.equal(error, 'انتخاب مسئول برای هر مصوبه الزامی است');
});

test('validateMinutesForm: parent with clauses does not require a separate owner', () => {
  const parent: DraftDecision = {
    ...defaultDecision(),
    title: 'مصوبه مادر',
    primaryOwnerUserId: '',
  };
  const clause1: DraftDecision = {
    ...defaultDecision(),
    parentDecisionId: parent.decisionId,
    clauseOrder: 1,
    title: 'بند اول',
    primaryOwnerUserId: 'user-1',
  };
  const clause2: DraftDecision = {
    ...defaultDecision(),
    parentDecisionId: parent.decisionId,
    clauseOrder: 2,
    title: 'بند دوم',
    primaryOwnerUserId: 'user-2',
  };

  const error = validateMinutesForm({
    info: validInfo(),
    decisions: [parent, clause1, clause2],
    prefillLoading: false,
    prefillError: null,
  });
  assert.equal(error, null);
});

test('validateMinutesForm: every clause requires its own owner', () => {
  const parent: DraftDecision = {
    ...defaultDecision(),
    title: 'مصوبه مادر',
    primaryOwnerUserId: '',
  };
  const clause: DraftDecision = {
    ...defaultDecision(),
    parentDecisionId: parent.decisionId,
    clauseOrder: 1,
    title: 'بند بدون مسئول',
    primaryOwnerUserId: '',
  };

  const error = validateMinutesForm({
    info: validInfo(),
    decisions: [parent, clause],
    prefillLoading: false,
    prefillError: null,
  });
  assert.equal(error, 'انتخاب مسئول برای هر بند الزامی است');
});
