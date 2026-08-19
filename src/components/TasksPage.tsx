import React, { useEffect, useMemo, useState } from 'react';
import { Loader as Loader2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { TaskWorkflowStep } from '../types';
import toast from 'react-hot-toast';
import * as XLSX from '../lib/xlsxCompat';
import { usePermissions } from '../context/PermissionsContext';
import { useOrgUsers } from '../lib/useOrgUsers';
import { type UserProfile, type TasksPageProps } from './Tasks/types';
import { toJalali, sendTaskNotification, getTaskRecipients } from './Tasks/utils';
import { AddNoteModal } from './Tasks/AddNoteModal';
import { WorkflowModal } from './Tasks/WorkflowModal';
import { ReferModal } from './Tasks/ReferModal';
import { TaskCard, type ActionTask } from './Tasks/TaskCard';
import { DeleteTaskModal } from './Tasks/DeleteTaskModal';
import {
  TasksWorkspaceHeader,
  TaskMetricCards,
  TaskViewTabs,
  TaskFilters,
} from './Tasks/TasksWorkspaceChrome';
import {
  filterTasks,
  getTaskCounters,
  type TaskStatusFilter,
  type TaskTab,
  type TaskViewMode,
} from './Tasks/taskPageSelectors';
import { ActionListView, ActionKanbanBoard } from './Tasks/ActionWorkspaceViews';
import {
  ActionCreateDrawer,
  type ActionCreatePayload,
  type ManagementProjectOption,
} from './Tasks/ActionCreateDrawer';
import { ActionDetailDrawer } from './Tasks/ActionDetailDrawer';
import { PersonalTaskProjects, type PersonalTaskProject } from './Tasks/PersonalTaskProjects';

type DashboardTaskView = 'all' | 'today' | 'in_progress' | 'completed' | 'overdue' | 'urgent';
const DASHBOARD_TASK_VIEWS = new Set<DashboardTaskView>(['all', 'today', 'in_progress', 'completed', 'overdue', 'urgent']);
const tehranDayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
});

function tehranDayKey(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = tehranDayFormatter.formatToParts(date);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function parseTags(value: string): string[] {
  return Array.from(new Set(value.split(/[,،]/).map(tag => tag.trim()).filter(Boolean)));
}

export function TasksPage({ prefillDescription, prefillSourceMessageId, onPrefillConsumed, currentUserId: propUserId }: TasksPageProps) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('tasks_create');
  const canEdit = hasPermission('tasks_edit');

  const [tasks, setTasks] = useState<ActionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingAction, setCreatingAction] = useState(false);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [showPersonalProjects, setShowPersonalProjects] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all');
  const [taskTab, setTaskTab] = useState<TaskTab>('assigned_to_me');
  const [viewMode, setViewMode] = useState<TaskViewMode>('cards');
  const [personalProjectFilter, setPersonalProjectFilter] = useState('all');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('task'));
  const [dashboardTaskView, setDashboardTaskView] = useState<DashboardTaskView | null>(() => {
    const value = new URL(window.location.href).searchParams.get('taskView') as DashboardTaskView | null;
    return value && DASHBOARD_TASK_VIEWS.has(value) ? value : null;
  });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<ActionTask | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [managementProjects, setManagementProjects] = useState<ManagementProjectOption[]>([]);
  const [personalProjects, setPersonalProjects] = useState<PersonalTaskProject[]>([]);
  const [detailTask, setDetailTask] = useState<ActionTask | null>(null);
  const [createInitialDescription, setCreateInitialDescription] = useState('');
  const [createSourceMessageId, setCreateSourceMessageId] = useState<string | null>(null);

  const { groups: orgGroups, allUsers: finalAllUsers } = useOrgUsers(userId);
  const userSelectorGroups = orgGroups.map(g => ({ label: g.unit_name, users: g.users }));

  const [workflowTask, setWorkflowTask] = useState<ActionTask | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<TaskWorkflowStep[]>([]);
  const [referTask, setReferTask] = useState<ActionTask | null>(null);
  const [addNoteTask, setAddNoteTask] = useState<ActionTask | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<ActionTask | null>(null);
  const [editDueDate, setEditDueDate] = useState<Date | null>(null);
  const [editAssigneeId, setEditAssigneeId] = useState('');

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('profiles_public')
      .select('user_id, full_name, avatar_url, position, primary_unit_name');
    if (error) return;
    setUsers((data || []).map(profile => ({
      user_id: profile.user_id,
      full_name: profile.full_name,
      email: null,
      avatar_url: profile.avatar_url,
      position: profile.position,
      unit_name: profile.primary_unit_name,
    })));
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      const nextTasks = (data || []) as ActionTask[];
      setTasks(nextTasks);
      setDetailTask(current => current ? nextTasks.find(task => task.id === current.id) || null : null);
    } catch {
      toast.error('خطا در دریافت اقدامات');
    } finally {
      setLoading(false);
    }
  };

  const fetchManagementProjects = async () => {
    const { data, error } = await supabase.from('projects').select('id,name,code').order('name');
    if (!error) setManagementProjects((data || []) as ManagementProjectOption[]);
  };

  const fetchPersonalProjects = async (ownerId: string) => {
    const { data, error } = await supabase
      .from('task_personal_projects')
      .select('*')
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false });
    if (!error) setPersonalProjects((data || []) as PersonalTaskProject[]);
  };

  const fetchWorkflow = async (taskId: string) => {
    const { data } = await supabase
      .from('task_workflow_steps')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setWorkflowSteps((data || []) as TaskWorkflowStep[]);
  };

  useEffect(() => {
    if (!propUserId) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    }
    void fetchUsers();
    void fetchTasks();
    void fetchManagementProjects();

    const channel = supabase
      .channel(`tasks-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => { void fetchTasks(); })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (userId) void fetchPersonalProjects(userId);
  }, [userId]);

  useEffect(() => {
    if (!focusTaskId && !dashboardTaskView) return;
    setTaskTab('all');
    setSearchTerm('');
    setStatusFilter('all');
    setPersonalProjectFilter('all');
    const url = new URL(window.location.href);
    url.searchParams.delete('task');
    url.searchParams.delete('taskView');
    window.history.replaceState({}, '', url.toString());
  }, []);

  useEffect(() => {
    if (!prefillDescription && !prefillSourceMessageId) return;
    setCreateInitialDescription(prefillDescription || '');
    setCreateSourceMessageId(prefillSourceMessageId || null);
    setShowCreateDrawer(true);
    onPrefillConsumed?.();
  }, [prefillDescription, prefillSourceMessageId, onPrefillConsumed]);

  const openCreateDrawer = () => {
    setCreateInitialDescription('');
    setCreateSourceMessageId(null);
    setShowCreateDrawer(true);
  };

  const handleCreateAction = async (payload: ActionCreatePayload) => {
    if (!userId) { toast.error('لطفاً ابتدا وارد شوید'); return; }
    if (!payload.dueDate) { toast.error('تاریخ سررسید را انتخاب کنید'); return; }
    if (!payload.assigneeId) { toast.error('اقدام کننده را انتخاب کنید'); return; }
    if (!payload.title.trim()) { toast.error('عنوان را وارد کنید'); return; }

    setCreatingAction(true);
    const uploadedPaths: string[] = [];
    let insertedTaskId: string | null = null;

    try {
      const creatorProfile = users.find(u => u.user_id === userId);
      const tags = parseTags(payload.tagsText);
      const estimatedMinutes = payload.estimatedHours.trim() === ''
        ? null
        : Math.max(0, Math.round(Number(payload.estimatedHours) * 60));

      if (estimatedMinutes !== null && !Number.isFinite(estimatedMinutes)) {
        toast.error('زمان تخمینی معتبر نیست');
        return;
      }
      const { data: inserted, error } = await supabase
        .from('tasks')
        .insert({
          title: payload.title.trim(),
          description: payload.description.trim(),
          priority: payload.priority,
          assignee: payload.assigneeName,
          current_assignee_id: payload.assigneeId,
          due_date: payload.dueDate.toISOString(),
          start_date: payload.startDate?.toISOString() || null,
          estimated_minutes: estimatedMinutes,
          actual_minutes: null,
          progress_percent: payload.status === 'completed' ? 100 : 0,
          tags,
          project_id: payload.projectId || null,
          personal_project_id: payload.personalProjectId || null,
          reminder_at: payload.reminderAt?.toISOString() || null,
          parent_task_id: payload.parentTaskId || null,
          status: payload.status,
          archived: payload.status === 'completed',
          user_id: userId,
          created_by_id: userId,
          source_message_id: createSourceMessageId,
          source_message_body: createInitialDescription || null,
        })
        .select()
        .single();

      if (error || !inserted) throw error || new Error('task-insert-failed');
      insertedTaskId = inserted.id;

      if (payload.checklist.length) {
        const { error: checklistError } = await supabase.from('task_checklist_items').insert(
          payload.checklist.map((title, sortOrder) => ({ task_id: inserted.id, title, sort_order: sortOrder }))
        );
        if (checklistError) throw checklistError;
      }

      if (payload.dependencyIds.length) {
        const { error: dependencyError } = await supabase.from('task_dependencies').insert(
          payload.dependencyIds.map(dependsOnTaskId => ({ task_id: inserted.id, depends_on_task_id: dependsOnTaskId }))
        );
        if (dependencyError) throw dependencyError;
      }

      for (const file of payload.files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, '_');
        const path = `${userId}/${inserted.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from('task-attachments').upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);

        const { error: attachmentError } = await supabase.from('task_attachments').insert({
          task_id: inserted.id,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || null,
        });
        if (attachmentError) throw attachmentError;
      }

      const creatorName = creatorProfile?.full_name || 'کاربر';
      const { error: workflowError } = await supabase.from('task_workflow_steps').insert({
        task_id: inserted.id,
        actor_id: userId,
        action: 'created',
        to_user_id: payload.assigneeId,
        note: createInitialDescription
          ? `ایجاد شده از پیام چت — ایجادکننده: ${creatorName}`
          : `ایجادکننده: ${creatorName}`,
      });
      if (workflowError) throw workflowError;

      await sendTaskNotification(
        payload.assigneeId,
        userId,
        `اقدام جدید برای شما: ${payload.title.trim()}`,
        `${creatorName} یک اقدام جدید به شما اختصاص داد — سررسید: ${toJalali(payload.dueDate.toISOString())}`,
        creatorName,
        creatorProfile?.avatar_url || undefined,
        payload.title.trim(),
      );

      toast.success('اقدام جدید ایجاد شد');
      logAudit({
        module: 'tasks',
        action: 'task_created',
        entity_name: payload.title.trim(),
        entity_id: inserted.id,
        details: `اقدام "${payload.title.trim()}" برای ${payload.assigneeName} ایجاد شد`,
        severity: 'info',
      });
      setShowCreateDrawer(false);
      setCreateInitialDescription('');
      setCreateSourceMessageId(null);
      await fetchTasks();
    } catch (error) {
      console.error('[tasks-v2] create failed', error);
      if (uploadedPaths.length) await supabase.storage.from('task-attachments').remove(uploadedPaths);
      if (insertedTaskId) await supabase.from('tasks').delete().eq('id', insertedTaskId);
      toast.error('خطا در ایجاد اقدام');
    } finally {
      setCreatingAction(false);
    }
  };

  const handleUpdateTask = async (taskId: string, updatedData: Partial<ActionTask>) => {
    try {
      const patch: Partial<ActionTask> = { ...updatedData };
      if (updatedData.status) {
        patch.archived = updatedData.status === 'completed';
        if (updatedData.status === 'completed' && updatedData.progress_percent === undefined) patch.progress_percent = 100;
      }

      const { error } = await supabase.from('tasks').update(patch).eq('id', taskId);
      if (error) throw error;

      if (updatedData.status && userId) {
        const actionMap: Record<string, TaskWorkflowStep['action']> = {
          completed: 'completed',
          in_progress: 'accepted',
        };
        const action = actionMap[updatedData.status];
        const statusFa: Record<string, string> = {
          completed: 'تکمیل شد',
          in_progress: 'شروع شد',
          pending: 'به حالت انتظار برگشت',
        };
        const actorProfile = users.find(u => u.user_id === userId);
        const actorName = actorProfile?.full_name || 'کاربر';
        const fullTask = tasks.find(t => t.id === taskId);

        if (action && fullTask) {
          await supabase.from('task_workflow_steps').insert({
            task_id: taskId,
            actor_id: userId,
            action,
            note: `وضعیت اقدام ${statusFa[updatedData.status] || updatedData.status}`,
          });

          const recipients = getTaskRecipients(fullTask, userId);
          const statusLabel = statusFa[updatedData.status] || updatedData.status;
          await Promise.all(recipients.map(recipientId => sendTaskNotification(
            recipientId,
            userId,
            `تغییر وضعیت اقدام: ${fullTask.title}`,
            `${actorName}: وضعیت اقدام «${fullTask.title}» ${statusLabel}`,
            actorName,
            actorProfile?.avatar_url || undefined,
            fullTask.title,
          )));
        }
      }

      toast.success(updatedData.status === 'completed' ? 'تکمیل و بایگانی شد' : 'به‌روزرسانی شد');
      const fullTask = tasks.find(t => t.id === taskId);
      logAudit({
        module: 'tasks',
        action: updatedData.status ? `task_${updatedData.status}` : 'task_updated',
        entity_name: fullTask?.title || taskId,
        entity_id: taskId,
        details: updatedData.status ? `وضعیت اقدام به "${updatedData.status}" تغییر کرد` : 'اقدام به‌روز شد',
        severity: 'info',
      });
      await fetchTasks();
      setEditingTaskId(null);
      setEditingTask(null);
    } catch {
      toast.error('خطا در به‌روزرسانی');
    }
  };

  const handleEditSave = async () => {
    if (!editingTask) return;
    const assigneeUser = users.find(u => u.user_id === editAssigneeId);
    await handleUpdateTask(editingTask.id, {
      title: editingTask.title,
      description: editingTask.description,
      priority: editingTask.priority,
      progress_percent: editingTask.progress_percent,
      assignee: assigneeUser ? (assigneeUser.full_name || editingTask.assignee) : editingTask.assignee,
      current_assignee_id: editAssigneeId || editingTask.current_assignee_id,
      due_date: editDueDate ? editDueDate.toISOString() : editingTask.due_date,
    });
  };

  const handleDeleteTask = async (task: ActionTask) => {
    try {
      const { data: attachments, error: attachmentLookupError } = await supabase
        .from('task_attachments')
        .select('file_path')
        .eq('task_id', task.id);
      if (attachmentLookupError) throw attachmentLookupError;

      const paths = (attachments || []).map(item => item.file_path);
      if (paths.length) {
        const { error: storageError } = await supabase.storage.from('task-attachments').remove(paths);
        if (storageError) throw storageError;
      }

      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) throw error;
      toast.success('اقدام حذف شد');
      logAudit({
        module: 'tasks',
        action: 'task_deleted',
        entity_name: task.title,
        entity_id: task.id,
        details: `اقدام "${task.title}" حذف شد`,
        severity: 'warn',
      });
      if (detailTask?.id === task.id) setDetailTask(null);
      await fetchTasks();
    } catch (error) {
      console.error('[tasks-v2] delete failed', error);
      toast.error('خطا در حذف اقدام');
    } finally {
      setDeleteConfirmTask(null);
    }
  };

  const handleExportToExcel = async () => {
    const exportData = tasks.map(task => ({
      'عنوان': task.title,
      'توضیحات': task.description,
      'وضعیت': task.status === 'pending' ? 'در انتظار' : task.status === 'in_progress' ? 'در حال انجام' : 'تکمیل شده',
      'اولویت': task.priority === 'high' ? 'بالا' : task.priority === 'medium' ? 'متوسط' : 'پایین',
      'تاریخ شروع': task.start_date ? toJalali(task.start_date) : '',
      'تاریخ سررسید': task.due_date ? toJalali(task.due_date) : '',
      'اقدام کننده': task.assignee,
      'پیشرفت': `${task.status === 'completed' ? 100 : (task.progress_percent ?? 0)}%`,
      'زمان تخمینی (دقیقه)': task.estimated_minutes ?? '',
      'برچسب‌ها': (task.tags || []).join('، '),
      'تاریخ ایجاد': task.created_at ? toJalali(task.created_at) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
    await XLSX.writeFile(wb, `tasks-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('فایل اکسل دانلود شد');
  };

  const clearExternalFilter = () => {
    setFocusTaskId(null);
    setDashboardTaskView(null);
  };

  const dashboardTodayKey = tehranDayKey(new Date());
  const ordinaryFilteredTasks = useMemo(() => filterTasks({
    tasks,
    searchTerm,
    statusFilter,
    taskTab,
    personalProjectFilter,
    userId,
  }), [tasks, searchTerm, statusFilter, taskTab, personalProjectFilter, userId]);

  const filteredTasks = useMemo(() => {
    if (focusTaskId) return tasks.filter(task => task.id === focusTaskId);
    if (!dashboardTaskView) return ordinaryFilteredTasks;

    return tasks.filter(task => {
      const dueKey = task.due_date ? tehranDayKey(new Date(task.due_date)) : null;
      switch (dashboardTaskView) {
        case 'all': return !task.archived;
        case 'today': return !task.archived && dueKey !== null && dueKey === dashboardTodayKey;
        case 'in_progress': return !task.archived && task.status === 'in_progress';
        case 'completed': return task.status === 'completed';
        case 'overdue': return !task.archived && task.status !== 'completed' && dueKey !== null && dashboardTodayKey !== null && dueKey < dashboardTodayKey;
        case 'urgent': return !task.archived && task.priority === 'high' && task.status !== 'completed';
      }
    });
  }, [focusTaskId, dashboardTaskView, tasks, ordinaryFilteredTasks, dashboardTodayKey]);

  const counters = getTaskCounters(tasks, userId);

  const handleStatusFromWorkspace = (taskId: string, status: ActionTask['status']) => {
    const task = tasks.find(item => item.id === taskId);
    void handleUpdateTask(taskId, {
      status,
      progress_percent: status === 'completed' ? 100 : task?.progress_percent,
    });
  };

  const openTaskForEdit = (task: ActionTask) => {
    setDetailTask(null);
    setViewMode('cards');
    setEditingTaskId(task.id);
    setEditingTask(task);
    setEditDueDate(null);
    setEditAssigneeId(task.current_assignee_id || '');
    requestAnimationFrame(() => document.getElementById(`task-${task.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  };

  if (!userId || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <TasksWorkspaceHeader
        canCreate={canCreate}
        onOpenPersonalProjects={() => setShowPersonalProjects(true)}
        onExport={() => { void handleExportToExcel(); }}
        onCreate={openCreateDrawer}
      />

      <TaskMetricCards
        assignedToMe={counters.assignedToMe}
        inProgress={counters.inProgress}
        overdue={counters.overdue}
        completed={counters.completed}
        onAssignedToMe={() => { clearExternalFilter(); setTaskTab('assigned_to_me'); setStatusFilter('all'); }}
        onInProgress={() => { clearExternalFilter(); setTaskTab('all'); setStatusFilter('in_progress'); }}
        onOverdue={() => { setFocusTaskId(null); setDashboardTaskView('overdue'); setTaskTab('all'); setStatusFilter('all'); }}
        onCompleted={() => { setFocusTaskId(null); setDashboardTaskView('completed'); setTaskTab('all'); setStatusFilter('all'); }}
      />

      {(focusTaskId || dashboardTaskView) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3 text-sm text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-300">
          <span>{focusTaskId ? 'نمایش اقدام انتخاب‌شده' : 'فیلتر داشبورد فعال است'}</span>
          <button onClick={clearExternalFilter} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-violet-100 dark:hover:bg-violet-900/30">
            <X className="w-4 h-4" /> حذف فیلتر
          </button>
        </div>
      )}

      <TaskViewTabs
        taskTab={taskTab}
        setTaskTab={tab => { clearExternalFilter(); setTaskTab(tab); }}
        createdByMeCount={counters.createdByMe}
        viewMode={viewMode}
        setViewMode={setViewMode}
      />

      <TaskFilters
        searchTerm={searchTerm}
        setSearchTerm={value => { clearExternalFilter(); setSearchTerm(value); }}
        statusFilter={statusFilter}
        setStatusFilter={value => { clearExternalFilter(); setStatusFilter(value); }}
        personalProjectFilter={personalProjectFilter}
        setPersonalProjectFilter={value => { clearExternalFilter(); setPersonalProjectFilter(value); }}
        personalProjects={personalProjects}
      />

      {filteredTasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 dark:border-gray-700 py-16 text-center text-sm text-gray-400">
          اقدامی با فیلترهای انتخاب‌شده یافت نشد.
        </div>
      ) : viewMode === 'list' ? (
        <ActionListView tasks={filteredTasks} onOpen={setDetailTask} onStatus={handleStatusFromWorkspace} />
      ) : viewMode === 'kanban' ? (
        <ActionKanbanBoard tasks={filteredTasks} onOpen={setDetailTask} onStatus={handleStatusFromWorkspace} onCreate={openCreateDrawer} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filteredTasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              isEditing={editingTaskId === task.id}
              editingTask={editingTask}
              setEditingTask={setEditingTask}
              editAssigneeId={editAssigneeId}
              setEditAssigneeId={setEditAssigneeId}
              editDueDate={editDueDate}
              setEditDueDate={setEditDueDate}
              handleEditSave={() => { void handleEditSave(); }}
              setEditingTaskId={setEditingTaskId}
              setWorkflowTask={setWorkflowTask}
              fetchWorkflow={fetchWorkflow}
              canEdit={canEdit}
              userId={userId}
              setDeleteConfirmTask={setDeleteConfirmTask}
              setAddNoteTask={setAddNoteTask}
              setReferTask={setReferTask}
              handleUpdateTask={(id, data) => { void handleUpdateTask(id, data); }}
              finalAllUsers={finalAllUsers}
              userSelectorGroups={userSelectorGroups}
              users={users}
              onOpenDetails={setDetailTask}
            />
          ))}
        </div>
      )}

      {showCreateDrawer && (
        <ActionCreateDrawer
          users={users}
          groups={userSelectorGroups}
          tasks={tasks}
          managementProjects={managementProjects}
          personalProjects={personalProjects}
          sourceFromChat={Boolean(createSourceMessageId || createInitialDescription)}
          initialDescription={createInitialDescription}
          busy={creatingAction}
          onClose={() => setShowCreateDrawer(false)}
          onCreate={payload => { void handleCreateAction(payload); }}
          onManagePersonalProjects={() => setShowPersonalProjects(true)}
        />
      )}

      {showPersonalProjects && (
        <PersonalTaskProjects
          userId={userId}
          onClose={() => setShowPersonalProjects(false)}
          onChanged={() => { void fetchPersonalProjects(userId); }}
        />
      )}

      {detailTask && (
        <ActionDetailDrawer
          task={detailTask}
          users={users}
          onClose={() => setDetailTask(null)}
          onEdit={openTaskForEdit}
          onAddNote={task => { setDetailTask(null); setAddNoteTask(task); }}
          onRefer={task => { setDetailTask(null); setReferTask(task); }}
        />
      )}

      {workflowTask && (
        <WorkflowModal
          task={workflowTask}
          steps={workflowSteps}
          users={users}
          onClose={() => { setWorkflowTask(null); setWorkflowSteps([]); }}
        />
      )}

      {referTask && (
        <ReferModal
          task={referTask}
          users={users}
          groups={userSelectorGroups}
          currentUserId={userId}
          actorName={users.find(user => user.user_id === userId)?.full_name || 'کاربر'}
          actorAvatarUrl={users.find(user => user.user_id === userId)?.avatar_url}
          onClose={() => setReferTask(null)}
          onReferred={() => { void fetchTasks(); }}
        />
      )}

      {addNoteTask && (
        <AddNoteModal
          task={addNoteTask}
          userId={userId}
          actorName={users.find(user => user.user_id === userId)?.full_name || 'کاربر'}
          actorAvatarUrl={users.find(user => user.user_id === userId)?.avatar_url}
          onClose={() => setAddNoteTask(null)}
          onSaved={() => { void fetchTasks(); }}
        />
      )}

      {deleteConfirmTask && (
        <DeleteTaskModal
          task={deleteConfirmTask}
          onConfirm={() => { void handleDeleteTask(deleteConfirmTask); }}
          onCancel={() => setDeleteConfirmTask(null)}
        />
      )}
    </div>
  );
}