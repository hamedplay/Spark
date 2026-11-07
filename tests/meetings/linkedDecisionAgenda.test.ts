import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedDecisionAgendaTitle, agendaItemsForSave } from '../../src/lib/linkedAgendaDecisions';
import { reorderMeetingAgenda } from '../../src/components/Agenda/reorderAgenda';
import type { PickerDecision } from '../../src/lib/linkedAgendaDecisions';

const source: PickerDecision = {
  id: '6598d3c2-ad54-4f90-9223-02c154b5838f',
  minute_id: '9dd582c5-ed88-41b0-b252-134e97f952df',
  parent_decision_id: null, clause_order: null,
  title: 'بررسی اجرای پروژه سامانه خدمات الکترونیک',
  description: null, minute_title: 'شورای معاونت',
  meeting_date: '1405/08/13', minute_number: '۱۲۵', decision_number: '۳',
  status: 'in_progress', progress_percent: 20, owner_name: 'کارشناس',
  primary_owner_user_id: null, responsible_unit_name_snapshot: null,
};

test('formal identifiers from source are included without duplication', () => {
  assert.equal(linkedDecisionAgendaTitle(source),
    'بررسی و پیگیری مصوبه شماره ۳ از صورت‌جلسه شماره ۱۲۵ با موضوع بررسی اجرای پروژه سامانه خدمات الکترونیک');
});

test('source clause order is included only for a real subclause', () => {
  const titled = linkedDecisionAgendaTitle({
    ...source, parent_decision_id: '00000000-0000-0000-0000-000000000003',
    clause_order: 2,
  });
  assert.match(titled, /بند 2 \/ مصوبه شماره ۳/);
});

test('missing official identifiers never become fabricated sequential numbers', () => {
  const titled = linkedDecisionAgendaTitle({ ...source, minute_number: null, decision_number: null });
  assert.match(titled, /از صورت‌جلسه «شورای معاونت» مورخ 1405\/08\/13/);
  assert.doesNotMatch(titled, /شماره 1|شماره ۱۲۵|شماره ۳/);
});

test('save payload preserves stable UUID, source relation, custom title and order', () => {
  const existing = [
    { id: '88888888-8888-4888-8888-888888888888', title: 'عنوان ویرایش‌شده', presenter: null,
      duration_minutes: null, description: null, sort_order: 0, source_decision_id: source.id },
    { id: '99999999-9999-4999-8999-999999999999', title: 'دستور دستی', presenter: null,
      duration_minutes: null, description: null, sort_order: 1, source_decision_id: null },
  ];
  const reordered = reorderMeetingAgenda(existing, 0, 1);
  const serialized = agendaItemsForSave(reordered);
  assert.deepEqual(serialized.map(item => [item.id, item.source_decision_id]),
    [[existing[1].id, null], [existing[0].id, source.id]]);
  assert.equal(serialized[1].title, 'عنوان ویرایش‌شده');
});

test('legacy temporary form IDs cannot break UUID-only SQL persistence', () => {
  const item = agendaItemsForSave([{ id: 'prefill-0', title: 'عنوان قبلی' }])[0];
  assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i);
  assert.equal(item.source_decision_id, null);
});
