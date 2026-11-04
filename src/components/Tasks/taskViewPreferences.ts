import type { TaskSort, TaskViewMode } from './taskPageSelectors';
const modes = new Set(['cards', 'list', 'kanban']);
const sorts = new Set(['due', 'newest', 'oldest', 'priority', 'progress', 'title']);
export function readTaskView(userId: string | null): { mode: TaskViewMode; sort: TaskSort } {
  const defaults = { mode: 'cards' as TaskViewMode, sort: 'due' as TaskSort };
  if (!userId) return defaults;
  try {
    const value = JSON.parse(localStorage.getItem(`spark:task-view:${userId}`) || '{}');
    return { mode: modes.has(value?.mode) ? value.mode : defaults.mode, sort: sorts.has(value?.sort) ? value.sort : defaults.sort };
  } catch { return defaults; }
}
export function saveTaskView(userId: string | null, patch: { mode?: TaskViewMode; sort?: TaskSort }) {
  if (!userId) return;
  try { localStorage.setItem(`spark:task-view:${userId}`, JSON.stringify({ ...readTaskView(userId), ...patch })); } catch { /* Storage is optional. */ }
}
