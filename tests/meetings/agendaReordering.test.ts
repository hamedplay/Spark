import test from 'node:test';
import assert from 'node:assert/strict';
import { moveAgendaItem, reorderMeetingAgenda, reorderMinutesAgenda } from '../../src/components/Agenda/reorderAgenda';

test('moving agenda clauses in both directions preserves content and source records', () => {
  const items = Object.freeze(['a', 'b', 'c'].map((id, sort_order) => Object.freeze({ id, sort_order, title: id, description: `شرح ${id}` })));
  const result = reorderMeetingAgenda(items, 0, 2);
  assert.deepEqual(result.map(x => [x.id, x.sort_order]), [['b', 0], ['c', 1], ['a', 2]]);
  assert.deepEqual(reorderMeetingAgenda(result, 2, 0), items);
  assert.equal(result[2].description, items[0].description);
  assert.deepEqual(items.map(x => x.id), ['a', 'b', 'c']);
});

test('minutes reorder retains original identities and meeting links with consecutive snapshot order', () => {
  const items = ['a', 'b', 'c'].map((id, index) => ({ id, meetingAgendaItemId: `meeting-${id}`, order: index + 1, title: id }));
  const result = reorderMinutesAgenda(items, 2, 0);
  assert.deepEqual(result.map(x => [x.id, x.meetingAgendaItemId, x.order]), [['c', 'meeting-c', 1], ['a', 'meeting-a', 2], ['b', 'meeting-b', 3]]);
  assert.equal(items[2].order, 3);
});

test('out of range, fractional and same-position moves cannot discard agenda clauses', () => {
  for (const [from, to] of [[-1, 1], [0, 3], [0.5, 1], [1, 1], [NaN, 0]]) assert.deepEqual(moveAgendaItem(['a', 'b', 'c'], from, to), ['a', 'b', 'c']);
  assert.deepEqual(moveAgendaItem([], 0, 1), []);
});

test('reordered minutes serialize in the new order without changing decision links', async () => {
  const { buildMinutesDraftPayload } = await import('../../src/components/Minutes/MinutesFormPayload');
  const { defaultInfo, defaultAgendaItem, defaultDecision } = await import('../../src/components/Minutes/Form/defaults');
  const agendaItems = ['a', 'b', 'c'].map((id, i) => ({ ...defaultAgendaItem(i + 1), id, title: id, meetingAgendaItemId: `meeting-${id}` }));
  const decision = { ...defaultDecision(), title: 'مصوبه', meetingAgendaItemId: 'meeting-a' };
  const payload = buildMinutesDraftPayload({ info: defaultInfo, agendaItems: reorderMinutesAgenda(agendaItems, 0, 2), internalParticipants: [], externalParticipants: [], profiles: [], decisions: [decision] });
  assert.deepEqual(payload.agenda_results.map(x => [x.meeting_agenda_item_id, x.sort_order_snapshot]), [['meeting-b', 1], ['meeting-c', 2], ['meeting-a', 3]]);
  assert.equal(payload.decisions[0].meeting_agenda_item_id, 'meeting-a');
});
