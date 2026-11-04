import assert from 'node:assert/strict';
import test from 'node:test';
import { filterTasks, getTaskCounters, sortTasks, taskDayKey } from '../../src/components/Tasks/taskPageSelectors';
import { loadAllTaskPages } from '../../src/components/Tasks/taskData';
import { readTaskView, saveTaskView } from '../../src/components/Tasks/taskViewPreferences';
import type { ActionTask } from '../../src/components/Tasks/TaskCard';

const now = new Date('2026-11-04T12:00:00Z');
function task(id: string, overrides: Partial<ActionTask> = {}): ActionTask {
  return { id, title: `اقدام ${id}`, description: 'پیگیری', status: 'pending', priority: 'medium', archived: false,
    current_assignee_id: 'me', user_id: 'owner', created_by_id: 'owner', created_at: '2026-11-01T10:00:00Z',
    due_date: '2026-11-04T10:00:00Z', ...overrides } as ActionTask;
}
const tasks = [
  task('today'), task('late', { due_date: '2026-11-03T18:00:00Z', priority: 'high', tags: ['مهم'], project_id: 'project' }),
  task('future', { due_date: '2026-11-08T10:00:00Z', current_assignee_id: 'other', personal_project_id: 'personal' }),
  task('done', { status: 'completed', archived: true, due_date: '2026-11-02T10:00:00Z' }),
  task('archive', { archived: true }), task('none', { due_date: null, current_assignee_id: null }),
];
const base = { tasks, searchTerm: '', statusFilter: 'all' as const, taskTab: 'all' as const, personalProjectFilter: 'all', userId: 'me', now };
const ids = (items: ActionTask[]) => items.map(item => item.id);

test('deadline filters use Tehran dates and exclude finished/archived work', () => {
  assert.equal(taskDayKey('2026-11-03T21:00:00Z'), '2026-11-04');
  assert.deepEqual(ids(filterTasks({ ...base, dueFilter: 'today' })), ['today']);
  assert.deepEqual(ids(filterTasks({ ...base, dueFilter: 'overdue' })), ['late']);
  assert.deepEqual(ids(filterTasks({ ...base, dueFilter: 'week' })), ['today', 'future']);
  assert.deepEqual(ids(filterTasks({ ...base, dueFilter: 'no_due' })), ['none']);
});

test('priority, assignee, project and search filters combine rather than override', () => {
  assert.deepEqual(ids(filterTasks({ ...base, priorityFilter: 'high', managementProjectFilter: 'project', assigneeFilter: 'me', searchTerm: 'مهم' })), ['late']);
  assert.deepEqual(ids(filterTasks({ ...base, personalProjectFilter: 'personal', assigneeFilter: 'other' })), ['future']);
  assert.deepEqual(ids(filterTasks({ ...base, assigneeFilter: 'unassigned' })), ['none']);
  assert.deepEqual(filterTasks({ ...base, priorityFilter: 'high', dueFilter: 'today' }), []);
});

test('completed actions remain findable after automatic archival', () => {
  assert.deepEqual(ids(filterTasks({ ...base, statusFilter: 'completed' })), ['done']);
  assert.deepEqual(ids(filterTasks({ ...base, statusFilter: 'archived' })), ['done', 'archive']);
  assert.deepEqual(filterTasks({ ...base, taskTab: 'assigned_to_me', userId: null }), []);
});

test('overview counters agree with the matching scope', () => {
  const counters = getTaskCounters(tasks, 'me', now);
  assert.equal(counters.total, 6);
  assert.equal(counters.open, 4);
  assert.equal(counters.assignedToMe, 2);
  assert.equal(counters.today, 1);
  assert.equal(counters.overdue, 1);
  assert.equal(counters.completed, 1);
});

test('sorting is stable, does not mutate input, and puts missing deadlines last', () => {
  const original = [...tasks];
  assert.equal(sortTasks(tasks, 'due').at(-1)?.id, 'none');
  assert.equal(sortTasks(tasks, 'priority')[0].id, 'late');
  assert.equal(sortTasks(tasks, 'progress')[0].id, 'done');
  assert.deepEqual(tasks, original);
});

test('all task pages are loaded and duplicate IDs are not counted twice', async () => {
  const pages = [[tasks[0], tasks[1]], [tasks[1], tasks[2]], []];
  const ranges: number[][] = [];
  const result = await loadAllTaskPages(async (from, to) => { ranges.push([from, to]); return { data: pages.shift()!, error: null }; }, 2);
  assert.deepEqual(ranges, [[0, 1], [2, 3], [4, 5]]);
  assert.deepEqual(ids(result), ['today', 'late', 'future']);
});

test('a later page failure is surfaced instead of returning a misleading partial total', async () => {
  let page = 0;
  await assert.rejects(loadAllTaskPages(async () => ++page === 1
    ? { data: [tasks[0]], error: null }
    : { data: null, error: new Error('network') }, 1), /network/);
});

test('view choices are per user and blocked storage never breaks the page', () => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  } });
  try {
    saveTaskView('me', { mode: 'kanban', sort: 'priority' });
    assert.deepEqual(readTaskView('me'), { mode: 'kanban', sort: 'priority' });
    assert.deepEqual(readTaskView('other'), { mode: 'cards', sort: 'due' });
    storage.set('spark:task-view:me', 'null');
    assert.deepEqual(readTaskView('me'), { mode: 'cards', sort: 'due' });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('disabled'); } });
    assert.doesNotThrow(() => saveTaskView('me', { mode: 'list' }));
    assert.equal(readTaskView('me').mode, 'cards');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('server row caps smaller than the requested page do not truncate the workspace', async () => {
  const offsets: number[] = [];
  const rows = tasks.slice(0, 3);
  const result = await loadAllTaskPages(async (from) => {
    offsets.push(from);
    return { data: rows.slice(from, from + 1), error: null, count: from === 0 ? rows.length : null };
  }, 500);
  assert.deepEqual(offsets, [0, 1, 2]);
  assert.equal(result.length, 3);
});
