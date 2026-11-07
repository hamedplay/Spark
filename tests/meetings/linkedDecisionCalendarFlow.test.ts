import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';
import { agendaItemsForSave, linkedDecisionAgendaTitle, type PickerDecision } from '../../src/lib/linkedAgendaDecisions';

const decision: PickerDecision = {
  id: '10000000-0000-4000-8000-000000000001', minute_id: '20000000-0000-4000-8000-000000000001',
  title: 'موضوع مصوبه', minute_title: 'جلسه اصلی', meeting_date: '2026-11-04',
  description: null, minute_number: null, decision_number: null, parent_decision_id: null,
  clause_order: null, status: 'in_progress', progress_percent: 20, owner_name: 'مسئول',
  primary_owner_user_id: null, responsible_unit_name_snapshot: null,
};

type Node = { type: any; props: any; children: any[] };
const h = (type: any, props: any, ...children: any[]): Node => ({ type, props: props || {}, children: children.flat(Infinity) });
const walk = (node: any): Node[] => !node || typeof node !== 'object' ? [] : [node, ...node.children.flatMap(walk)];
const text = (node: any): string => !node || typeof node === 'boolean' ? ''
  : typeof node === 'object' ? node.children.map(text).join('') : String(node);

for (const mode of ['calendar', 'request'] as const) {
  const file = mode === 'calendar' ? 'src/components/CalendarMeetingForm/AgendaSection.tsx'
    : 'src/features/meetings/components/CreateMeetingForm/AgendaEditor.tsx';
  const code = (await transform(readFileSync(file, 'utf8').replace(/^import.*$/gm, ''), {
    loader: 'tsx', format: 'iife', globalName: 'UI', jsxFactory: 'h', jsxFragment: 'Fragment',
  })).code;
  function form(manualOpen = false) {
    let enabled = false, index = 0, items: any[] = [];
    const states: any[] = mode === 'request' ? [manualOpen] : [];
    const sandbox: any = { h, Fragment: 'Fragment', crypto, linkedDecisionAgendaTitle,
      useState(initial: any) { const key = index++; if (!(key in states)) states[key] = initial;
        return [states[key], (value: any) => states[key] = typeof value === 'function' ? value(states[key]) : value]; },
      ...Object.fromEntries(['AgendaDecisionPicker', 'LinkedDecisionDialog', 'ReorderableAgendaList',
        'ClipboardList', 'UserCheck', 'Clock', 'Pencil', 'Trash2', 'Check', 'Plus'].map(name => [name, name])),
    };
    vm.runInNewContext(code, sandbox);
    const render = () => {
      index = 0;
      return mode === 'calendar' ? sandbox.UI.AgendaSection({
        agendaEnabled: enabled, setAgendaEnabled: (value: boolean) => enabled = value,
        agendaItems: items, setAgendaItems: (value: any) => items = typeof value === 'function' ? value(items) : value,
        showAgendaForm: manualOpen, agendaForm: { title: 'پیش‌نویس دستی', presenter: '', duration_minutes: '', description: '' },
        editingAgendaIdx: null, participantDisplayItems: [], selectedExternal: [], prefillMeetingId: null,
      }) : sandbox.UI.AgendaEditor({ enabled, onEnabledChange: (value: boolean) => enabled = value,
        items, onItemsChange: (value: any[]) => items = value, participantNames: [], externalNames: [] });
    };
    return { render, get items() { return items; }, get enabled() { return enabled; } };
  }

  test(`${mode}: picker entry is visible before agenda is enabled and while manual entry is open`, () => {
    for (const manualOpen of [false, true]) {
      const state = form(manualOpen);
      const button = walk(state.render()).find(n => n.type === 'button' && text(n) === 'افزودن از پیگیری مصوبات');
      assert.ok(button); button.props.onClick(); assert.equal(state.enabled, true);
      const nodes = walk(state.render());
      assert.ok(nodes.some(n => n.type === 'AgendaDecisionPicker'));
      assert.ok(nodes.some(n => n.type === 'input' && n.props.type === 'checkbox' && n.props.checked === true));
    }
  });

  test(`${mode}: selecting multiple decisions creates independent items and skips duplicate sources`, () => {
    const state = form();
    walk(state.render()).find(n => n.type === 'button' && text(n) === 'افزودن از پیگیری مصوبات')!.props.onClick();
    const choose = () => walk(state.render()).find(n => n.type === 'AgendaDecisionPicker')!;
    const another = { ...decision, id: '10000000-0000-4000-8000-000000000002', title: 'مصوبه دیگر' };
    choose().props.onSelect([decision, decision, another]);
    assert.equal(state.items.length, 2); assert.equal(new Set(state.items.map(item => item.id)).size, 2);
    assert.equal(state.items[0].source_decision_id, decision.id);
    assert.match(state.items[0].title, /1405\/08\/13/);
    choose().props.onSelect([decision]); assert.equal(state.items.length, 2);
    assert.equal(choose().props.existingIds.length, 2);
    assert.equal(decision.title, 'موضوع مصوبه');
  });
}

test('real picker RPC date key produces a Jalali title without undefined or guessed date', () => {
  assert.match(linkedDecisionAgendaTitle(decision), /مورخ 1405\/08\/13/);
  assert.doesNotMatch(linkedDecisionAgendaTitle(decision), /undefined|2026-11-04/);
});

const serviceCode = (await transform(readFileSync('src/features/meetings/services/createMeetingSeries.ts', 'utf8')
  .replace(/^import.*$/gm, ''), { loader: 'ts', format: 'iife', globalName: 'Service' })).code;
async function series(agenda: any[], failSync = false) {
  const calls: any[] = [], dispatched: string[] = [];
  const sandbox: any = { agendaItemsForSave,
    supabase: { rpc: async (name: string, params: any) => { calls.push({ name, params });
      return name === 'create_meeting_series' ? { data: ['first-occurrence', 'second-occurrence'], error: null }
        : { data: 2, error: failSync ? { message: 'denied' } : null }; } },
    dispatchRecurringMeetingDelivery: async (id: string) => dispatched.push(id),
  };
  vm.runInNewContext(serviceCode, sandbox);
  return { run: () => sandbox.Service.createMeetingSeries('operation-id', [{ subject: 'جلسه' }], agenda, 'weekly'), calls, dispatched };
}

test('both forms share first-occurrence-only persistence; manual agenda repeats and original order survives', async () => {
  const agenda = [{ id: '30000000-0000-4000-8000-000000000001', title: 'پیگیری', source_decision_id: decision.id },
    { id: '30000000-0000-4000-8000-000000000002', title: 'دستی' }];
  const result = await series(agenda); await result.run();
  assert.equal(result.calls[0].params.p_agenda.length, 1);
  assert.equal(result.calls[0].params.p_agenda[0].title, 'دستی');
  assert.equal(result.calls[1].params.p_meeting_id, 'first-occurrence');
  assert.deepEqual(result.calls[1].params.p_items.map((item: any) => [item.id, item.source_decision_id]),
    [[agenda[0].id, decision.id], [agenda[1].id, null]]);
  assert.deepEqual(result.dispatched, ['operation-id']);
  const calendar = readFileSync('src/components/CalendarMeetingForm.tsx', 'utf8');
  assert.match(calendar, /\[\{ \.\.\.record, request_jalaali_date: meetingDateStr \}, \.\.\.repeatRecords\],\s*linked, pattern\)/);
});

test('manual-only series needs no link sync; failed link sync prevents dispatch and false success', async () => {
  const manual = await series([{ title: 'دستی' }]); await manual.run(); assert.equal(manual.calls.length, 1);
  const failed = await series([{ title: 'پیگیری', source_decision_id: decision.id }], true);
  await assert.rejects(failed.run, /ارتباط مصوبات نوبت اول ناموفق/); assert.equal(failed.dispatched.length, 0);
});
