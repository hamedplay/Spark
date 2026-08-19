import type { ActionTask } from './TaskCard';

export type TaskStatusFilter = 'all' | 'pending' | 'in_progress' | 'completed' | 'archived';
export type TaskTab = 'assigned_to_me' | 'created_by_me' | 'all';
export type TaskViewMode = 'cards' | 'list' | 'kanban';

export interface TaskFilterInput {
  tasks: ActionTask[];
  searchTerm: string;
  statusFilter: TaskStatusFilter;
  taskTab: TaskTab;
  personalProjectFilter: string;
  userId: string | null;
}

export function filterTasks({
  tasks,
  searchTerm,
  statusFilter,
  taskTab,
  personalProjectFilter,
  userId,
}: TaskFilterInput): ActionTask[] {
  const query = searchTerm.toLowerCase();
  return tasks.filter(task => {
    const matchesSearch =
      (task.title || '').toLowerCase().includes(query) ||
      (task.description || '').toLowerCase().includes(query) ||
      (task.tags || []).some(tag => tag.toLowerCase().includes(query));
    const matchesStatus = statusFilter === 'all'
      ? !task.archived
      : statusFilter === 'archived'
        ? task.archived
        : statusFilter === 'completed'
          ? task.status === 'completed'
          : task.status === statusFilter && !task.archived;
    const matchesTab = taskTab === 'all' ||
      (taskTab === 'assigned_to_me'
        ? task.current_assignee_id === userId
        : task.created_by_id === userId || task.user_id === userId);
    const personalProjectId = (task as ActionTask & { personal_project_id?: string | null }).personal_project_id;
    const matchesPersonal = personalProjectFilter === 'all' ||
      (personalProjectFilter === 'none' ? !personalProjectId : personalProjectId === personalProjectFilter);
    return matchesSearch && matchesStatus && matchesTab && matchesPersonal;
  });
}

export function getTaskCounters(tasks: ActionTask[], userId: string | null) {
  return {
    assignedToMe: tasks.filter(t => t.current_assignee_id === userId && !t.archived && t.status !== 'completed').length,
    createdByMe: tasks.filter(t => (t.created_by_id === userId || t.user_id === userId) && !t.archived).length,
    overdue: tasks.filter(t => !t.archived && t.status !== 'completed' && t.due_date && new Date(t.due_date).getTime() < Date.now()).length,
    inProgress: tasks.filter(t => !t.archived && t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
  };
}
