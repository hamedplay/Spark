import type { ActionTask } from './TaskCard';

export type TaskStatusFilter = 'all' | 'open' | 'pending' | 'in_progress' | 'completed' | 'archived';
export type TaskTab = 'assigned_to_me' | 'created_by_me' | 'all';
export type TaskViewMode = 'cards' | 'list' | 'kanban';
export type TaskDueFilter = 'all' | 'today' | 'week' | 'overdue' | 'no_due';
export type TaskSort = 'due' | 'newest' | 'oldest' | 'priority' | 'progress' | 'title';
export type TaskPriorityFilter = 'all' | 'high' | 'medium' | 'low';

export interface TaskFilterInput {
  tasks: ActionTask[];
  searchTerm: string;
  statusFilter: TaskStatusFilter;
  taskTab: TaskTab;
  personalProjectFilter: string;
  userId: string | null;
  priorityFilter?: TaskPriorityFilter;
  dueFilter?: TaskDueFilter;
  assigneeFilter?: string;
  managementProjectFilter?: string;
  now?: Date;
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});
export function taskDayKey(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dayFormatter.formatToParts(date);
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
}

export function isTaskOverdue(task: ActionTask, now = new Date()) {
  const due = taskDayKey(task.due_date);
  const today = taskDayKey(now);
  return !task.archived && task.status !== 'completed' && due !== null && today !== null && due < today;
}

export function filterTasks({ tasks, searchTerm, statusFilter, taskTab, personalProjectFilter, userId,
  priorityFilter = 'all', dueFilter = 'all', assigneeFilter = 'all', managementProjectFilter = 'all', now = new Date(),
}: TaskFilterInput): ActionTask[] {
  const query = searchTerm.trim().toLocaleLowerCase('fa-IR');
  const today = taskDayKey(now)!;
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  const weekEnd = end.toISOString().slice(0, 10);
  return tasks.filter(task => {
    const matchesSearch = [task.title, task.description, task.assignee, ...(task.tags || [])]
      .some(value => (value || '').toLocaleLowerCase('fa-IR').includes(query));
    const matchesStatus = statusFilter === 'all' ? !task.archived
      : statusFilter === 'open' ? !task.archived && task.status !== 'completed'
      : statusFilter === 'archived' ? task.archived
      : statusFilter === 'completed' ? task.status === 'completed'
      : task.status === statusFilter && !task.archived;
    const matchesTab = taskTab === 'all' || Boolean(userId && (taskTab === 'assigned_to_me'
      ? task.current_assignee_id === userId : task.created_by_id === userId || task.user_id === userId));
    const matchesPersonal = personalProjectFilter === 'all' ||
      (personalProjectFilter === 'none' ? !task.personal_project_id : task.personal_project_id === personalProjectFilter);
    const matchesProject = managementProjectFilter === 'all' ||
      (managementProjectFilter === 'none' ? !task.project_id : task.project_id === managementProjectFilter);
    const matchesAssignee = assigneeFilter === 'all' ||
      (assigneeFilter === 'unassigned' ? !task.current_assignee_id : task.current_assignee_id === assigneeFilter);
    const due = dueFilter === 'all' ? null : taskDayKey(task.due_date);
    const actionable = !task.archived && task.status !== 'completed';
    const matchesDue = dueFilter === 'all' || actionable && (
      dueFilter === 'overdue' ? due !== null && due < today
        : dueFilter === 'no_due' ? !task.due_date
        : dueFilter === 'today' ? due === today
        : due !== null && due >= today && due <= weekEnd);
    return matchesSearch && matchesStatus && matchesTab && matchesPersonal && matchesProject && matchesAssignee
      && matchesDue && (priorityFilter === 'all' || task.priority === priorityFilter);
  });
}

export function sortTasks(tasks: ActionTask[], sort: TaskSort): ActionTask[] {
  const timestamp = (value: string | null | undefined, fallback: number) => {
    const n = value ? Date.parse(value) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const priority: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...tasks].sort((a, b) => {
    let result = 0;
    if (sort === 'due') {
      const left = timestamp(a.due_date, Infinity), right = timestamp(b.due_date, Infinity);
      result = left === right ? 0 : left < right ? -1 : 1;
    } else if (sort === 'priority') result = (priority[a.priority] ?? 3) - (priority[b.priority] ?? 3);
    else if (sort === 'oldest') result = timestamp(a.created_at, 0) - timestamp(b.created_at, 0);
    else if (sort === 'progress') result = (b.status === 'completed' ? 100 : b.progress_percent ?? 0) - (a.status === 'completed' ? 100 : a.progress_percent ?? 0);
    else if (sort === 'title') result = (a.title || '').localeCompare(b.title || '', 'fa');
    return result || timestamp(b.created_at, 0) - timestamp(a.created_at, 0) || a.id.localeCompare(b.id);
  });
}

export function getTaskCounters(tasks: ActionTask[], userId: string | null, now = new Date()) {
  const counters = { total: tasks.length, open: 0, today: 0, assignedToMe: 0, createdByMe: 0, overdue: 0, inProgress: 0, completed: 0 };
  const today = taskDayKey(now);
  for (const task of tasks) {
    if (task.status === 'completed') counters.completed++;
    if (task.archived) continue;
    if (userId && (task.created_by_id === userId || task.user_id === userId)) counters.createdByMe++;
    if (task.status === 'in_progress') counters.inProgress++;
    if (task.status === 'completed') continue;
    counters.open++;
    if (userId && task.current_assignee_id === userId) counters.assignedToMe++;
    const due = taskDayKey(task.due_date);
    if (due && today && due === today) counters.today++;
    if (due && today && due < today) counters.overdue++;
  }
  return counters;
}
