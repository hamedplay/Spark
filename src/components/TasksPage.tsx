import { useLiveData, LIVE_DATA } from '../shared/realtime/useLiveData';
import { formatJalaliTimestampDateOnly } from '../lib/minutesDate';
import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, ClipboardList, Loader as Loader2, SearchX, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { TaskWorkflowStep } from '../types';
import toast from 'react-hot-toast';
import * as XLSX from '../lib/xlsxCompat';
import { usePermissions } from '../context/PermissionsContext';
import { useOrgUsers } from '../lib/useOrgUsers';
import { type UserProfile, type TasksPageProps } from './Tasks/types';
import { toJalali, sendTaskNotification, getTaskRecipients } from './Tasks/utils';
import { TaskCard, type ActionTask } from './Tasks/TaskCard';
import {
  TasksWorkspaceHeader,
  TaskMetricCards,
  TaskViewTabs,
  TaskFilters,
  DEFAULT_TASK_ADVANCED_FILTERS,
  type TaskAdvancedFilters,
  type TaskMetricKey,
} from './Tasks/TasksWorkspaceChrome';
import {
  filterTasks,
  getTaskCounters,
  sortTasks,
  type TaskSort,
  type TaskStatusFilter,
  type TaskTab,
  type TaskViewMode,
} from './Tasks/taskPageSelectors';
import { loadAllTaskPages } from './Tasks/taskData';
import { readTaskView, saveTaskView } from './Tasks/taskViewPreferences';
import { ActionListView, ActionKanbanBoard } from './Tasks/ActionWorkspaceViews';
import type { ActionCreatePayload, ManagementProjectOption } from './Tasks/ActionCreateDrawer';
import type { ActionEditPayload } from './Tasks/ActionEditDrawer';
import type { PersonalTaskProject } from './Tasks/PersonalTaskProjects';

const AddNoteModal = lazy(() => import('./Tasks/AddNoteModal').then((m) => ({ default: m.AddNoteModal })));
const WorkflowModal = lazy(() => import('./Tasks/WorkflowModal').then((m) => ({ default: m.WorkflowModal })));
const ReferModal = lazy(() => import('./Tasks/ReferModal').then((m) => ({ default: m.ReferModal })));
const DeleteTaskModal = lazy(() => import('./Tasks/DeleteTaskModal').then((m) => ({ default: m.DeleteTaskModal })));
const ActionCreateDrawer = lazy(() => import('./Tasks/ActionCreateDrawer').then((m) => ({ default: m.ActionCreateDrawer })));
const ActionDetailDrawer = lazy(() => import('./Tasks/ActionDetailDrawer').then((m) => ({ default: m.ActionDetailDrawer })));
const ActionEditDrawer = lazy(() => import('./Tasks/ActionEditDrawer').then((m) => ({ default: m.ActionEditDrawer })));
const PersonalTaskProjects = lazy(() => import('./Tasks/PersonalTaskProjects').then((m) => ({ default: m.PersonalTaskProjects })));


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
  useLiveData([...LIVE_DATA.tasks, ...LIVE_DATA.people], async () => { await Promise.all([fetchTasks(), fetchManagementProjects(), fetchUsers(), userId ? fetchPersonalProjects(userId) : Promise.resolve()]); if (workflowTask) await fetchWorkflow(workflowTask.id); });
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('tasks_create');
  const canEdit = hasPermission('tasks_edit');

  const [tasks, setTasks] = useState<ActionTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingAction, setCreatingAction] = useState(false);
  const [savingAction, setSavingAction] = useState(false);
  const [showCreateDrawer, setShowCreateDrawer] = useState(false);
  const [showPersonalProjects, setShowPersonalProjects] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all');
  const [taskTab, setTaskTab] = useState<TaskTab>('assigned_to_me');
  const [viewMode, setViewMode] = useState<TaskViewMode>(() => readTaskView(propUserId ?? null).mode);
  const [taskSort, setTaskSort] = useState<TaskSort>(() => readTaskView(propUserId ?? null).sort);
  const [advancedFilters, setAdvancedFilters] = useState<TaskAdvancedFilters>({ ...DEFAULT_TASK_ADVANCED_FILTERS });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const taskRequestRef = useRef(0);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const interval = window.setInterval(() => setClock(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);
  const [personalProjectFilter, setPersonalProjectFilter] = useState('all');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('task'));
  const [dashboardTaskView, setDashboardTaskView] = useState<DashboardTaskView | null>(() => {
    const value = new URL(window.location.href).searchParams.get('taskView') as DashboardTaskView | null;
    return value && DASHBOARD_TASK_VIEWS.has(value) ? value : null;
  });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<ActionTask | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  useEffect(() => {
    const view = readTaskView(userId);
    setViewMode(view.mode); setTaskSort(view.sort);
  }, [userId]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [managementProjects, setManagementProjects] = useState<ManagementProjectOption[]>([]);
  const [personalProjects, setPersonalProjects] = useState<PersonalTaskProject[]>([]);
  const [detailTask, setDetailTask] = useState<ActionTask | null>(null);
  useEffect(() => { setDetailTask((current: ActionTask | null) => current ? (tasks.find(task => task.id === current.id) || current) : null); }, [tasks]);
  const [createInitialDescription, setCreateInitialDescription] = useState('');
  const [createSourceMessageId, setCreateSourceMessageId] = useState<string | null>(null);

  const [workflowTask, setWorkflowTask] = useState<ActionTask | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<TaskWorkflowStep[]>([]);
  const [referTask, setReferTask] = useState<ActionTask | null>(null);
  const [addNoteTask, setAddNoteTask] = useState<ActionTask | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<ActionTask | null>(null);
  const [editDueDate, setEditDueDate] = useState<Date | null>(null);
  const [editAssigneeId, setEditAssigneeId] = useState('');

  const orgDirectoryNeeded = Boolean(showCreateDrawer || editingTaskId || referTask);
  const { groups: orgGroups, allUsers: finalAllUsers } = useOrgUsers(userId, orgDirectoryNeeded);
  const userSelectorGroups = orgGroups.map(g => ({ label: g.unit_name, users: g.users }));

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
    const request = ++taskRequestRef.current;
    setRefreshing(true);
    try {
      const nextTasks = await loadAllTaskPages((from, to) => supabase.from('tasks').select('*', { count: from === 0 ? 'exact' : undefined })
        .order('created_at', { ascending: false }).order('id').range(from, to));
      if (request !== taskRequestRef.current) return;
      setTasks(nextTasks);
      setLoadError(false);
      setLastUpdated(new Date());
      setDetailTask(current => current ? nextTasks.find(task => task.id === current.id) || null : null);
    } catch {
      if (request !== taskRequestRef.current) return;
      setLoadError(true);
      toast.error('خطا در دریافت اقدامات؛ دوباره تلاش کنید');
    } finally {
      if (request === taskRequestRef.current) { setLoading(false); setRefreshing(false); }
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
    setStatusFilter(dashboardTaskView === 'completed' ? 'completed' : 'all');
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
    if (!payload.description.trim()) { toast.error('توضیحات را وارد کنید'); return; }
    if (payload.startDate && payload.startDate.getTime() > payload.dueDate.getTime()) {
      toast.error('تاریخ شروع نمی‌تواند بعد از تاریخ سررسید باشد');
      return;
    }
    if (payload.parentTaskId && payload.dependencyIds.includes(payload.parentTaskId)) {
      toast.error('اقدام والد نمی‌تواند همزمان وابستگی همان اقدام باشد');
      return;
    }

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

  const handleModernEditSave = async (payload: ActionEditPayload) => {
    if (!editingTask || !userId) return;
    if (!payload.dueDate) { toast.error('تاریخ سررسید را انتخاب کنید'); return; }
    if (!payload.assigneeId) { toast.error('اقدام کننده را انتخاب کنید'); return; }
    if (!payload.title.trim()) { toast.error('عنوان را وارد کنید'); return; }
    if (!payload.description.trim()) { toast.error('توضیحات را وارد کنید'); return; }
    if (payload.startDate && payload.startDate.getTime() > payload.dueDate.getTime()) { toast.error('تاریخ شروع نمی‌تواند بعد از تاریخ سررسید باشد'); return; }
    if (payload.parentTaskId === editingTask.id) { toast.error('اقدام نمی‌تواند والد خودش باشد'); return; }
    if (payload.parentTaskId && payload.dependencyIds.includes(payload.parentTaskId)) { toast.error('اقدام والد نمی‌تواند همزمان وابستگی همان اقدام باشد'); return; }

    const estimatedMinutes = payload.estimatedHours.trim() === '' ? null : Math.max(0, Math.round(Number(payload.estimatedHours) * 60));
    if (estimatedMinutes !== null && !Number.isFinite(estimatedMinutes)) { toast.error('زمان تخمینی معتبر نیست'); return; }

    setSavingAction(true);
    const uploadedPaths: string[] = [];
    try {
      const previousAssigneeId = editingTask.current_assignee_id;
      const previousStatus = editingTask.status;
      const assignee = users.find(user => user.user_id === payload.assigneeId);
      const taskPatch = {
        title: payload.title.trim(), description: payload.description.trim(), priority: payload.priority,
        status: payload.status, archived: payload.status === 'completed',
        progress_percent: payload.status === 'completed' ? 100 : (editingTask.progress_percent ?? 0),
        assignee: payload.assigneeName || assignee?.full_name || editingTask.assignee,
        current_assignee_id: payload.assigneeId, due_date: payload.dueDate.toISOString(),
        start_date: payload.startDate?.toISOString() || null, estimated_minutes: estimatedMinutes,
        tags: parseTags(payload.tagsText), project_id: payload.projectId || null,
        personal_project_id: payload.personalProjectId || null, reminder_at: payload.reminderAt?.toISOString() || null,
        parent_task_id: payload.parentTaskId || null,
      };
      const { error: updateError } = await supabase.from('tasks').update(taskPatch).eq('id', editingTask.id);
      if (updateError) throw updateError;

      const { error: checklistDeleteError } = await supabase.from('task_checklist_items').delete().eq('task_id', editingTask.id);
      if (checklistDeleteError) throw checklistDeleteError;
      if (payload.checklist.length) {
        const { error } = await supabase.from('task_checklist_items').insert(payload.checklist.map((title, sortOrder) => ({ task_id: editingTask.id, title, sort_order: sortOrder })));
        if (error) throw error;
      }

      const { error: dependencyDeleteError } = await supabase.from('task_dependencies').delete().eq('task_id', editingTask.id);
      if (dependencyDeleteError) throw dependencyDeleteError;
      if (payload.dependencyIds.length) {
        const { error } = await supabase.from('task_dependencies').insert(payload.dependencyIds.map(dependsOnTaskId => ({ task_id: editingTask.id, depends_on_task_id: dependsOnTaskId })));
        if (error) throw error;
      }

      if (payload.removedAttachments.length) {
        const paths = payload.removedAttachments.map(item => item.file_path);
        const { error: storageError } = await supabase.storage.from('task-attachments').remove(paths);
        if (storageError) throw storageError;
        const ids = payload.removedAttachments.map(item => item.id);
        const { error: attachmentDeleteError } = await supabase.from('task_attachments').delete().in('id', ids);
        if (attachmentDeleteError) throw attachmentDeleteError;
      }

      for (const file of payload.files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, '_');
        const path = `${userId}/${editingTask.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from('task-attachments').upload(path, file, { upsert: false });
        if (uploadError) throw uploadError;
        uploadedPaths.push(path);
        const { error: attachmentError } = await supabase.from('task_attachments').insert({ task_id: editingTask.id, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type || null });
        if (attachmentError) throw attachmentError;
      }

      const actorProfile = users.find(user => user.user_id === userId);
      const actorName = actorProfile?.full_name || 'کاربر';
      if (previousStatus !== payload.status) {
        const actionMap: Record<string, TaskWorkflowStep['action']> = { completed: 'completed', in_progress: 'accepted' };
        const workflowAction = actionMap[payload.status];
        if (workflowAction) await supabase.from('task_workflow_steps').insert({ task_id: editingTask.id, actor_id: userId, action: workflowAction, note: `وضعیت اقدام در ویرایش به «${payload.status}» تغییر کرد` });
      }
      if (previousAssigneeId !== payload.assigneeId) {
        await sendTaskNotification(payload.assigneeId, userId, `اقدام به شما اختصاص یافت: ${payload.title.trim()}`, `${actorName} اقدام «${payload.title.trim()}» را به شما اختصاص داد`, actorName, actorProfile?.avatar_url || undefined, payload.title.trim());
      }

      toast.success('اقدام به‌روزرسانی شد');
      logAudit({ module: 'tasks', action: 'task_updated', entity_name: payload.title.trim(), entity_id: editingTask.id, details: `اقدام "${payload.title.trim()}" با فرم جدید ویرایش شد`, severity: 'info' });
      setEditingTaskId(null);
      setEditingTask(null);
      await fetchTasks();
    } catch (error) {
      console.error('[tasks-v2] modern edit failed', error);
      if (uploadedPaths.length) await supabase.storage.from('task-attachments').remove(uploadedPaths);
      toast.error('خطا در به‌روزرسانی اقدام');
    } finally {
      setSavingAction(false);
    }
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
    if (!filteredTasks.length) return;
    const exportData = filteredTasks.map(task => ({
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
    await XLSX.writeFile(wb, `tasks-${formatJalaliTimestampDateOnly(new Date().toISOString()).replace(/\//g, '-')}.xlsx`);
    toast.success('فایل اکسل دانلود شد');
  };

  const clearExternalFilter = () => {
    setFocusTaskId(null);
    setDashboardTaskView(null);
  };

  const dashboardTodayKey = tehranDayKey(clock);
  const ordinaryFilteredTasks = useMemo(() => filterTasks({
    tasks,
    searchTerm,
    statusFilter,
    taskTab,
    personalProjectFilter,
    userId,
    priorityFilter: advancedFilters.priority,
    dueFilter: advancedFilters.due,
    assigneeFilter: advancedFilters.assignee,
    managementProjectFilter: advancedFilters.managementProject,
    now: clock,
  }), [tasks, searchTerm, statusFilter, taskTab, personalProjectFilter, userId, advancedFilters, clock]);

  const filteredTasks = useMemo(() => {
    let result = ordinaryFilteredTasks;
    if (focusTaskId) result = tasks.filter(task => task.id === focusTaskId);
    else if (dashboardTaskView) result = ordinaryFilteredTasks.filter(task => {
      const dueKey = task.due_date ? tehranDayKey(new Date(task.due_date)) : null;
      switch (dashboardTaskView) {
        case 'all': return !task.archived;
        case 'today': return !task.archived && task.status !== 'completed' && dueKey !== null && dueKey === dashboardTodayKey;
        case 'in_progress': return !task.archived && task.status === 'in_progress';
        case 'completed': return task.status === 'completed';
        case 'overdue': return !task.archived && task.status !== 'completed' && dueKey !== null && dashboardTodayKey !== null && dueKey < dashboardTodayKey;
        case 'urgent': return !task.archived && task.priority === 'high' && task.status !== 'completed';
      }
    });
    return sortTasks(result, taskSort);
  }, [focusTaskId, dashboardTaskView, tasks, ordinaryFilteredTasks, dashboardTodayKey, taskSort]);

  const counters = useMemo(() => getTaskCounters(tasks, userId, clock), [tasks, userId, clock]);
  const activeFilterCount = Number(Boolean(searchTerm.trim())) + Number(statusFilter !== 'all')
    + Number(personalProjectFilter !== 'all') + Object.values(advancedFilters).filter(value => value !== 'all').length;
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const visibleTasks = viewMode === 'kanban' ? filteredTasks : filteredTasks.slice((safePage - 1) * pageSize, safePage * pageSize);
  useEffect(() => { setPage(1); }, [searchTerm, statusFilter, taskTab, personalProjectFilter, advancedFilters, taskSort, pageSize, viewMode, focusTaskId, dashboardTaskView]);
  const assigneeOptions = useMemo(() => {
    const options = new Map<string, string>();
    tasks.forEach(task => {
      if (task.current_assignee_id) options.set(task.current_assignee_id, users.find(user => user.user_id === task.current_assignee_id)?.full_name || task.assignee || 'کاربر');
    });
    return [...options].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  }, [tasks, users]);

  const resetFilters = () => {
    clearExternalFilter(); setSearchTerm(''); setStatusFilter('all'); setTaskTab('all');
    setPersonalProjectFilter('all'); setAdvancedFilters({ ...DEFAULT_TASK_ADVANCED_FILTERS }); setPage(1);
  };
  const selectMetric = (key: TaskMetricKey) => {
    resetFilters();
    if (key === 'assignedToMe') setTaskTab('assigned_to_me');
    if (key === 'open' || key === 'assignedToMe') setStatusFilter('open');
    if (key === 'today') setAdvancedFilters({ ...DEFAULT_TASK_ADVANCED_FILTERS, due: 'today' });
    if (key === 'overdue') setAdvancedFilters({ ...DEFAULT_TASK_ADVANCED_FILTERS, due: 'overdue' });
    if (key === 'inProgress') setStatusFilter('in_progress');
    if (key === 'completed') setStatusFilter('completed');
  };

  const handleStatusFromWorkspace = (taskId: string, status: ActionTask['status']) => {
    const task = tasks.find(item => item.id === taskId);
    void handleUpdateTask(taskId, {
      status,
      progress_percent: status === 'completed' ? 100 : task?.progress_percent,
    });
  };

  const openTaskForEdit = (task: ActionTask) => {
    setDetailTask(null);
    setEditingTaskId(task.id);
    setEditingTask(task);
    setEditDueDate(null);
    setEditAssigneeId(task.current_assignee_id || '');
  };

  if (!userId || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl bg-slate-50/70 p-2 dark:bg-slate-950/30 sm:p-4" dir="rtl">
      <TasksWorkspaceHeader
        canCreate={canCreate}
        onOpenPersonalProjects={() => setShowPersonalProjects(true)}
        onExport={() => { void handleExportToExcel(); }}
        onCreate={openCreateDrawer}
        onRefresh={() => { void fetchTasks(); }}
        refreshing={refreshing}
        lastUpdated={lastUpdated}
        exportDisabled={!filteredTasks.length || loadError}
      />

      <p className="px-1 text-[10px] font-medium text-slate-400">نمای کلی همه اقدامات قابل دسترس شما</p>
      <TaskMetricCards counters={counters} onSelect={selectMetric} />
      {loadError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300"><AlertCircle className="h-4 w-4" />بروزرسانی اقدامات ناموفق بود؛ آمار ممکن است قدیمی باشد.<button type="button" disabled={refreshing} onClick={() => { void fetchTasks(); }} className="mr-auto rounded-lg border border-rose-200 px-3 py-1.5 font-bold">تلاش دوباره</button></div>}

      {(focusTaskId || dashboardTaskView) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/50 px-4 py-3 text-sm text-violet-700 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-300">
          <span>{focusTaskId ? 'نمایش اقدام انتخاب‌شده' : 'فیلتر داشبورد فعال است'}</span>
          <button onClick={clearExternalFilter} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 hover:bg-violet-100 dark:hover:bg-violet-900/30">
            <X className="w-4 h-4" /> حذف فیلتر
          </button>
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-4">
      <TaskViewTabs
        taskTab={taskTab}
        setTaskTab={tab => { clearExternalFilter(); setTaskTab(tab); }}
        createdByMeCount={counters.createdByMe}
        viewMode={viewMode}
        setViewMode={mode => { setViewMode(mode); saveTaskView(userId, { mode }); }}
      />

      <TaskFilters
        searchTerm={searchTerm}
        setSearchTerm={value => { clearExternalFilter(); setSearchTerm(value); }}
        statusFilter={statusFilter}
        setStatusFilter={value => { clearExternalFilter(); setStatusFilter(value); }}
        personalProjectFilter={personalProjectFilter}
        setPersonalProjectFilter={value => { clearExternalFilter(); setPersonalProjectFilter(value); }}
        personalProjects={personalProjects}
        advanced={advancedFilters}
        onAdvancedChange={patch => { clearExternalFilter(); setAdvancedFilters(current => ({ ...current, ...patch })); }}
        managementProjects={managementProjects}
        assignees={assigneeOptions}
        sort={taskSort}
        onSortChange={sort => { setTaskSort(sort); saveTaskView(userId, { sort }); }}
        onReset={resetFilters}
        activeCount={activeFilterCount}
      />
      </section>
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span><strong className="text-slate-800 dark:text-slate-200">{filteredTasks.length.toLocaleString('fa-IR')}</strong> نتیجه از {counters.total.toLocaleString('fa-IR')} اقدام قابل دسترس</span>
        <span>{lastUpdated ? `آخرین بروزرسانی ${lastUpdated.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
      </div>

      {filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-16 text-center dark:border-slate-700 dark:bg-slate-900">
          <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 dark:bg-slate-800">{tasks.length ? <SearchX className="h-6 w-6" /> : <ClipboardList className="h-6 w-6" />}</span>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{loadError ? 'دریافت اقدامات ناموفق بود' : tasks.length ? 'نتیجه‌ای در این نما پیدا نشد' : 'هنوز اقدامی ثبت نشده است'}</h3>
          <p className="mt-2 text-xs text-slate-400">{tasks.length ? 'محدوده یا فیلترها را تغییر دهید تا اقدامات دیگر را ببینید.' : 'با ثبت اولین اقدام، پیگیری کارها را از همین‌جا شروع کنید.'}</p>
          <div className="mt-4 flex gap-2">{tasks.length > 0 && <button type="button" onClick={resetFilters} className="rounded-xl border border-slate-200 px-4 py-2 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">نمایش همه اقدامات</button>}{canCreate && !loadError && <button type="button" onClick={openCreateDrawer} className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-bold text-white">اقدام جدید</button>}</div>
        </div>
      ) : viewMode === 'list' ? (
        <ActionListView tasks={visibleTasks} onOpen={setDetailTask} onStatus={handleStatusFromWorkspace} />
      ) : viewMode === 'kanban' ? (
        <ActionKanbanBoard tasks={filteredTasks} onOpen={setDetailTask} onStatus={handleStatusFromWorkspace} onCreate={canCreate ? openCreateDrawer : undefined} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {visibleTasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              isEditing={false}
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
              onEditTask={openTaskForEdit}
            />
          ))}
        </div>
      )}

      {filteredTasks.length > 0 && viewMode !== 'kanban' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <label className="flex items-center gap-2">تعداد در صفحه<select aria-label="تعداد اقدامات در صفحه" value={pageSize} onChange={event => setPageSize(Number(event.target.value))} className="rounded-lg border border-slate-200 bg-transparent px-2 py-1 dark:border-slate-700">{[12, 24, 48].map(size => <option key={size} value={size}>{size.toLocaleString('fa-IR')}</option>)}</select></label>
          <div className="flex items-center gap-3"><button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} aria-label="صفحه قبل" className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30 dark:border-slate-700"><ChevronRight className="h-4 w-4" /></button><span>صفحه {safePage.toLocaleString('fa-IR')} از {pageCount.toLocaleString('fa-IR')}</span><button type="button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} aria-label="صفحه بعد" className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30 dark:border-slate-700"><ChevronLeft className="h-4 w-4" /></button></div>
        </div>
      )}

      {showCreateDrawer && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {editingTask && (
        <Suspense fallback={null}>
          <ActionEditDrawer
          task={editingTask}
          users={users}
          groups={userSelectorGroups}
          tasks={tasks}
          managementProjects={managementProjects}
          personalProjects={personalProjects}
          busy={savingAction}
          onClose={() => { setEditingTaskId(null); setEditingTask(null); }}
          onSave={payload => { void handleModernEditSave(payload); }}
          onManagePersonalProjects={() => setShowPersonalProjects(true)}
          />
        </Suspense>
      )}

      {showPersonalProjects && (
        <Suspense fallback={null}>
          <PersonalTaskProjects
          userId={userId}
          onClose={() => setShowPersonalProjects(false)}
          onChanged={() => { void fetchPersonalProjects(userId); }}
          />
        </Suspense>
      )}

      {detailTask && (
        <Suspense fallback={null}>
          <ActionDetailDrawer
          task={detailTask}
          users={users}
          onClose={() => setDetailTask(null)}
          onEdit={openTaskForEdit}
          onAddNote={task => { setDetailTask(null); setAddNoteTask(task); }}
          onRefer={task => { setDetailTask(null); setReferTask(task); }}
          />
        </Suspense>
      )}

      {workflowTask && (
        <Suspense fallback={null}>
          <WorkflowModal
          task={workflowTask}
          steps={workflowSteps}
          users={users}
          onClose={() => { setWorkflowTask(null); setWorkflowSteps([]); }}
          />
        </Suspense>
      )}

      {referTask && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}

      {addNoteTask && (
        <Suspense fallback={null}>
          <AddNoteModal
          task={addNoteTask}
          userId={userId}
          actorName={users.find(user => user.user_id === userId)?.full_name || 'کاربر'}
          actorAvatarUrl={users.find(user => user.user_id === userId)?.avatar_url}
          onClose={() => setAddNoteTask(null)}
          onSaved={() => { void fetchTasks(); }}
          />
        </Suspense>
      )}

      {deleteConfirmTask && (
        <Suspense fallback={null}>
          <DeleteTaskModal
          task={deleteConfirmTask}
          onConfirm={() => { void handleDeleteTask(deleteConfirmTask); }}
          onCancel={() => setDeleteConfirmTask(null)}
          />
        </Suspense>
      )}
    </div>
  );
}