import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Loader as Loader2,
  X,
  MessageSquare,
  ClipboardList,
  Download,
  Sparkles,
  ListTodo,
  Clock3,
  AlertTriangle,
  Activity,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { Task, TaskWorkflowStep } from '../types';
import toast from 'react-hot-toast';
import * as XLSX from '../lib/xlsxCompat';
import { usePermissions } from '../context/PermissionsContext';
import { useOrgUsers } from '../lib/useOrgUsers';
import { type UserProfile, type TasksPageProps } from './Tasks/types';
import { toJalali, sendTaskNotification, getTaskRecipients } from './Tasks/utils';
import { JalaliDateInput } from './Tasks/JalaliDateInput';
import { UserSelector } from './Tasks/UserSelector';
import { AddNoteModal } from './Tasks/AddNoteModal';
import { WorkflowModal } from './Tasks/WorkflowModal';
import { ReferModal } from './Tasks/ReferModal';
import { TaskCard } from './Tasks/TaskCard';
import { DeleteTaskModal } from './Tasks/DeleteTaskModal';

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

export function TasksPage({ prefillDescription, prefillSourceMessageId, onPrefillConsumed, currentUserId: propUserId }: TasksPageProps) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('tasks_create');
  const canEdit = hasPermission('tasks_edit');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed' | 'archived'>('all');
  const [taskTab, setTaskTab] = useState<'assigned_to_me' | 'created_by_me' | 'all'>('assigned_to_me');
  const [focusTaskId, setFocusTaskId] = useState<string | null>(() => new URL(window.location.href).searchParams.get('task'));
  const [dashboardTaskView, setDashboardTaskView] = useState<DashboardTaskView | null>(() => {
    const value = new URL(window.location.href).searchParams.get('taskView') as DashboardTaskView | null;
    return value && DASHBOARD_TASK_VIEWS.has(value) ? value : null;
  });
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  const [users, setUsers] = useState<UserProfile[]>([]);

  const { groups: orgGroups, allUsers: finalAllUsers } = useOrgUsers(userId);
  const userSelectorGroups = orgGroups.map(g => ({ label: g.unit_name, users: g.users }));

  const [workflowTask, setWorkflowTask] = useState<Task | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<TaskWorkflowStep[]>([]);
  const [referTask, setReferTask] = useState<Task | null>(null);
  const [addNoteTask, setAddNoteTask] = useState<Task | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Task | null>(null);

  const [newTask, setNewTask] = useState({
    title: '',
    description: prefillDescription || '',
    priority: 'medium' as Task['priority'],
    assigneeId: '',
    assigneeName: '',
  });
  const [newDueDate, setNewDueDate] = useState<Date | null>(null);

  const [editDueDate, setEditDueDate] = useState<Date | null>(null);
  const [editAssigneeId, setEditAssigneeId] = useState('');

  useEffect(() => {
    if (!propUserId) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    }
    fetchUsers();
    fetchTasks();

    const channel = supabase
      .channel(`tasks-realtime-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => fetchTasks())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    if (!focusTaskId && !dashboardTaskView) return;
    setTaskTab('all');
    setSearchTerm('');
    setStatusFilter('all');
    const url = new URL(window.location.href);
    url.searchParams.delete('task');
    url.searchParams.delete('taskView');
    window.history.replaceState({}, '', url.toString());
    // The focus/filter stays in component state until the user explicitly clears it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (prefillDescription) {
      setNewTask(t => ({ ...t, description: prefillDescription }));
      setNewDueDate(new Date());
      setShowCreateForm(true);
      onPrefillConsumed?.();
    }
  }, [prefillDescription]);

  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles_public').select('user_id, full_name, username, avatar_url');
    if (data) setUsers(data);
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setTasks(data || []);
    } catch {
      toast.error('خطا در دریافت اقدامات');
    } finally {
      setLoading(false);
    }
  };

  const fetchWorkflow = async (taskId: string) => {
    const { data } = await supabase
      .from('task_workflow_steps')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    setWorkflowSteps((data || []) as TaskWorkflowStep[]);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { toast.error('لطفاً ابتدا وارد شوید'); return; }
    if (!newDueDate) { toast.error('تاریخ سررسید را انتخاب کنید'); return; }
    if (!newTask.assigneeId) { toast.error('اقدام کننده را انتخاب کنید'); return; }
    if (!newTask.title.trim()) { toast.error('عنوان را وارد کنید'); return; }

    setLoading(true);
    try {
      const creatorProfile = users.find(u => u.user_id === userId);

      const { data: inserted, error } = await supabase
        .from('tasks')
        .insert([{
          title: newTask.title,
          description: newTask.description,
          priority: newTask.priority,
          assignee: newTask.assigneeName,
          current_assignee_id: newTask.assigneeId,
          due_date: newDueDate.toISOString(),
          status: 'pending',
          archived: false,
          user_id: userId,
          created_by_id: userId,
          source_message_id: prefillSourceMessageId || null,
          source_message_body: prefillDescription || null,
        }])
        .select()
        .single();

      if (error) throw error;

      if (inserted) {
        const creatorName = creatorProfile?.full_name || creatorProfile?.email || 'کاربر';
        await supabase.from('task_workflow_steps').insert({
          task_id: inserted.id,
          actor_id: userId,
          action: 'created',
          to_user_id: newTask.assigneeId,
          note: prefillDescription
            ? `ایجاد شده از پیام چت — ایجادکننده: ${creatorName}`
            : `ایجادکننده: ${creatorName}`,
        });

        await sendTaskNotification(
          newTask.assigneeId,
          userId,
          `اقدام جدید برای شما: ${newTask.title}`,
          `${creatorName} یک اقدام جدید به شما اختصاص داد — سررسید: ${toJalali(newDueDate.toISOString())}`,
          creatorName,
          creatorProfile?.avatar_url || undefined,
          newTask.title,
        );
      }

      toast.success('اقدام جدید ایجاد شد');
      logAudit({
        module: 'tasks',
        action: 'task_created',
        entity_name: newTask.title,
        entity_id: inserted?.id,
        details: `اقدام "${newTask.title}" برای ${newTask.assigneeName} ایجاد شد`,
        severity: 'info',
      });
      setShowCreateForm(false);
      setNewTask({ title: '', description: '', priority: 'medium', assigneeId: '', assigneeName: '' });
      setNewDueDate(null);
      fetchTasks();
    } catch {
      toast.error('خطا در ایجاد اقدام');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTask = async (taskId: string, updatedData: Partial<Task>) => {
    try {
      const shouldArchive = updatedData.status === 'completed';
      const { error } = await supabase.from('tasks').update({ ...updatedData, archived: shouldArchive }).eq('id', taskId);
      if (error) throw error;

      if (updatedData.status && userId) {
        const actionMap: Record<string, TaskWorkflowStep['action']> = {
          completed: 'completed',
          in_progress: 'accepted',
        };
        const act = actionMap[updatedData.status];
        const statusFa: Record<string, string> = {
          completed: 'تکمیل شد',
          in_progress: 'شروع شد',
          pending: 'به حالت انتظار برگشت',
        };
        const actorProfile = users.find(u => u.user_id === userId);
        const actorName = actorProfile?.full_name || actorProfile?.email || 'کاربر';
        const fullTask = tasks.find(t => t.id === taskId);

        if (act && fullTask) {
          await supabase.from('task_workflow_steps').insert({
            task_id: taskId,
            actor_id: userId,
            action: act,
            note: `وضعیت اقدام ${statusFa[updatedData.status] || updatedData.status}`,
          });

          const recipients = getTaskRecipients(fullTask, userId);
          const statusLabel = statusFa[updatedData.status] || updatedData.status;
          await Promise.all(recipients.map(rid =>
            sendTaskNotification(
              rid,
              userId,
              `تغییر وضعیت اقدام: ${fullTask.title}`,
              `${actorName}: وضعیت اقدام «${fullTask.title}» ${statusLabel}`,
              actorName,
              actorProfile?.avatar_url || undefined,
              fullTask.title,
            )
          ));
        }
      }

      toast.success(shouldArchive ? 'تکمیل و بایگانی شد' : 'به‌روزرسانی شد');
      const fullTask = tasks.find(t => t.id === taskId);
      logAudit({
        module: 'tasks',
        action: updatedData.status ? `task_${updatedData.status}` : 'task_updated',
        entity_name: fullTask?.title || taskId,
        entity_id: taskId,
        details: updatedData.status ? `وضعیت اقدام به "${updatedData.status}" تغییر کرد` : 'اقدام به‌روز شد',
        severity: 'info',
      });
      fetchTasks();
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
      ...editingTask,
      assignee: assigneeUser ? (assigneeUser.full_name || assigneeUser.email || editingTask.assignee) : editingTask.assignee,
      current_assignee_id: editAssigneeId || editingTask.current_assignee_id,
      due_date: editDueDate ? editDueDate.toISOString() : editingTask.due_date,
    });
  };

  const handleDeleteTask = async (task: Task) => {
    try {
      const { error } = await supabase.from('tasks').delete().eq('id', task.id);
      if (error) { toast.error('خطا در حذف اقدام: ' + error.message); return; }
      toast.success('اقدام حذف شد');
      logAudit({
        module: 'tasks',
        action: 'task_deleted',
        entity_name: task.title,
        entity_id: task.id,
        details: `اقدام "${task.title}" حذف شد`,
        severity: 'warn',
      });
      fetchTasks();
    } catch (e: any) {
      toast.error('خطا در حذف اقدام: ' + (e?.message || ''));
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
      'تاریخ سررسید': toJalali(task.due_date),
      'اقدام کننده': task.assignee,
      'تاریخ ایجاد': task.created_at ? toJalali(task.created_at) : '',
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tasks');
    await XLSX.writeFile(wb, `tasks-${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('فایل اکسل دانلود شد');
  };

  const dashboardTodayKey = tehranDayKey(new Date());
  const filteredTasks = tasks.filter(task => {
    if (focusTaskId) return task.id === focusTaskId;

    if (dashboardTaskView) {
      if (task.archived) return false;
      const dueKey = task.due_date ? tehranDayKey(new Date(task.due_date)) : null;
      switch (dashboardTaskView) {
        case 'all': return true;
        case 'today': return dueKey !== null && dueKey === dashboardTodayKey;
        case 'in_progress': return task.status === 'in_progress';
        case 'completed': return task.status === 'completed';
        case 'overdue': return task.status !== 'completed' && dueKey !== null && dashboardTodayKey !== null && dueKey < dashboardTodayKey;
        case 'urgent': return task.priority === 'high' && task.status !== 'completed';
      }
    }

    const matchesSearch =
      task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      task.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'archived' ? task.archived : !task.archived && task.status === statusFilter);
    const matchesTab =
      taskTab === 'all' ? true :
      taskTab === 'assigned_to_me' ? task.current_assignee_id === userId :
      taskTab === 'created_by_me' ? (task.created_by_id === userId || task.user_id === userId) : true;
    return matchesSearch && matchesStatus && matchesTab;
  });

  const assignedToMeCount = tasks.filter(t => t.current_assignee_id === userId && !t.archived && t.status !== 'completed').length;
  const createdByMeCount = tasks.filter(t => (t.created_by_id === userId || t.user_id === userId) && !t.archived).length;
  const activeTasksCount = tasks.filter(t => !t.archived && t.status !== 'completed').length;
  const inProgressCount = tasks.filter(t => !t.archived && t.status === 'in_progress').length;
  const overdueCount = tasks.filter(t => {
    if (t.archived || t.status === 'completed') return false;
    const due = new Date(t.due_date).getTime();
    return Number.isFinite(due) && due < Date.now();
  }).length;

  if (!userId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <>
      <div
        className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/75 to-indigo-50/45 p-3 antialiased shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/15 sm:p-4"
        dir="rtl"
      >
        <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-violet-300/10 blur-3xl dark:bg-violet-600/10" />
        <div className="pointer-events-none absolute -right-20 top-32 h-56 w-56 rounded-full bg-cyan-200/15 blur-3xl dark:bg-cyan-500/10" />

        <div className="relative z-10">
          <header className="mb-3 flex flex-col justify-between gap-2.5 lg:flex-row lg:items-center">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white/85 px-2.5 py-1 text-[10px] font-bold text-indigo-700 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <Sparkles className="h-3.5 w-3.5" /> مرکز مدیریت اقدامات
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/75 px-2.5 py-1 text-[9px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                  <ListTodo className="h-3 w-3" /> {tasks.length.toLocaleString('fa-IR')} اقدام
                </span>
              </div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">مدیریت اقدامات</h1>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">ثبت، ارجاع، پیگیری و کنترل وضعیت اقدامات سازمانی</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
              <button
                onClick={handleExportToExcel}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15 sm:text-xs"
              >
                <Download className="h-4 w-4" /> دریافت اکسل
              </button>
              {canCreate && (
                <button
                  onClick={() => setShowCreateForm(v => !v)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3.5 text-[10px] font-bold text-white shadow-[0_7px_20px_rgba(79,70,229,0.18)] transition hover:from-violet-500 hover:to-indigo-500 sm:text-xs"
                >
                  <Plus className="h-4 w-4" /> {showCreateForm ? 'بستن فرم' : 'اقدام جدید'}
                </button>
              )}
            </div>
          </header>

          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-violet-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-violet-500/20 dark:bg-violet-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">اقدامات فعال</span>
                <ListTodo className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{activeTasksCount.toLocaleString('fa-IR')}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-blue-500/20 dark:bg-blue-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">در حال انجام</span>
                <Activity className="h-3.5 w-3.5 text-blue-500 dark:text-blue-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{inProgressCount.toLocaleString('fa-IR')}</p>
            </div>
            <div className={`rounded-xl border px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] ${overdueCount > 0 ? 'border-rose-200 bg-rose-50/80 ring-1 ring-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:ring-rose-400/10' : 'border-slate-200 bg-white/85 dark:border-slate-800 dark:bg-slate-900/65'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className={`text-[10px] ${overdueCount > 0 ? 'font-bold text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}`}>سررسید گذشته</span>
                <AlertTriangle className={`h-3.5 w-3.5 ${overdueCount > 0 ? 'text-rose-500' : 'text-slate-400'}`} />
              </div>
              <p className={`mt-1 text-lg font-bold ${overdueCount > 0 ? 'text-rose-700 dark:text-rose-200' : 'text-slate-900 dark:text-white'}`}>{overdueCount.toLocaleString('fa-IR')}</p>
            </div>
            <div className="rounded-xl border border-cyan-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-cyan-500/20 dark:bg-cyan-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">کارتابل من</span>
                <Clock3 className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{assignedToMeCount.toLocaleString('fa-IR')}</p>
            </div>
          </div>

          <section className="mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="grid grid-cols-3 gap-1">
              <button
                onClick={() => setTaskTab('assigned_to_me')}
                className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold transition sm:text-xs ${taskTab === 'assigned_to_me' ? 'bg-violet-50 text-violet-700 shadow-sm ring-1 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/15' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'}`}
              >
                <span className="truncate">کارتابل من</span>
                {assignedToMeCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[9px] text-white">{assignedToMeCount > 99 ? '99+' : assignedToMeCount.toLocaleString('fa-IR')}</span>}
              </button>
              <button
                onClick={() => setTaskTab('created_by_me')}
                className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[10px] font-bold transition sm:text-xs ${taskTab === 'created_by_me' ? 'bg-cyan-50 text-cyan-700 shadow-sm ring-1 ring-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/15' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'}`}
              >
                <span className="truncate">ایجادشده توسط من</span>
                {createdByMeCount > 0 && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-cyan-600 px-1.5 text-[9px] text-white">{createdByMeCount > 99 ? '99+' : createdByMeCount.toLocaleString('fa-IR')}</span>}
              </button>
              <button
                onClick={() => setTaskTab('all')}
                className={`rounded-lg px-2 py-2 text-[10px] font-bold transition sm:text-xs ${taskTab === 'all' ? 'bg-slate-100 text-slate-800 shadow-sm dark:bg-slate-800 dark:text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800'}`}
              >
                همه اقدامات
              </button>
            </div>
          </section>

          {showCreateForm && (
            <form onSubmit={handleCreateTask} className="mb-3 rounded-xl border border-violet-100 bg-white/90 p-3 shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:border-violet-500/20 dark:bg-slate-900/80 sm:p-3.5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                    <ClipboardList className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-white sm:text-sm">ایجاد اقدام جدید</h3>
                    <p className="mt-0.5 text-[9px] text-slate-400">اطلاعات اصلی اقدام و مسئول اجرا را ثبت کنید</p>
                  </div>
                </div>
                <button type="button" onClick={() => setShowCreateForm(false)} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <X className="h-4 w-4" />
                </button>
              </div>

              {prefillDescription && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-cyan-200 bg-cyan-50/80 px-3 py-2 text-[10px] text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300">
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                  <span>این اقدام از متن پیام چت ایجاد می‌شود</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">عنوان *</label>
                  <input required type="text" value={newTask.title}
                    onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">اقدام کننده *</label>
                  <UserSelector users={finalAllUsers as UserProfile[]} groups={userSelectorGroups} value={newTask.assigneeId}
                    onChange={(id, name) => setNewTask(t => ({ ...t, assigneeId: id, assigneeName: name }))}
                    placeholder="انتخاب کاربر" />
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">اولویت</label>
                  <select value={newTask.priority}
                    onChange={e => setNewTask(t => ({ ...t, priority: e.target.value as Task['priority'] }))}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
                    <option value="high">بالا</option>
                    <option value="medium">متوسط</option>
                    <option value="low">پایین</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">تاریخ سررسید شمسی *</label>
                  <JalaliDateInput value={newDueDate} onChange={setNewDueDate} />
                </div>
                <div className="md:col-span-2">
                  <label className="mb-1 block text-[10px] font-bold text-slate-600 dark:text-slate-300">توضیحات *</label>
                  <textarea required value={newTask.description}
                    onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))}
                    rows={3} className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateForm(false)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <X className="h-3.5 w-3.5" /> انصراف
                </button>
                <button type="submit" disabled={loading} className="inline-flex h-9 min-w-32 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 px-4 text-xs font-bold text-white transition hover:from-violet-500 hover:to-indigo-500 disabled:opacity-50">
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} ایجاد اقدام
                </button>
              </div>
            </form>
          )}

          {(focusTaskId || dashboardTaskView) && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50/80 px-3 py-2 text-[10px] text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300 sm:text-xs">
              <span>{focusTaskId ? 'اقدام انتخاب‌شده از داشبورد مدیریتی نمایش داده شده است.' : 'فیلتر داشبورد مدیریتی روی اقدامات فعال است.'}</span>
              <button type="button" onClick={() => { setFocusTaskId(null); setDashboardTaskView(null); }} className="flex-shrink-0 rounded-lg border border-violet-200 bg-white px-2.5 py-1 font-bold transition hover:bg-violet-100 dark:border-violet-500/25 dark:bg-slate-900/50 dark:hover:bg-violet-500/10">نمایش همه اقدامات</button>
            </div>
          )}

          <section className="mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="عنوان یا توضیحات اقدام..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-4 pr-10 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
              </div>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 sm:w-auto">
                <option value="all">همه وضعیت‌ها</option>
                <option value="pending">در انتظار</option>
                <option value="in_progress">در حال انجام</option>
                <option value="completed">تکمیل شده</option>
                <option value="archived">بایگانی شده</option>
              </select>
              <div className="flex flex-shrink-0 items-center gap-1.5 text-[9px] text-slate-400 dark:text-slate-500 sm:text-[10px]">
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                {filteredTasks.length.toLocaleString('fa-IR')} نتیجه
              </div>
            </div>
          </section>

          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100 sm:text-sm">فهرست اقدامات</h2>
              <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500 sm:text-[10px]">وضعیت، مسئول و سررسید هر اقدام در یک نگاه</p>
            </div>
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-1 text-[9px] font-bold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300">
                <AlertTriangle className="h-3 w-3" /> {overdueCount.toLocaleString('fa-IR')} عقب‌افتاده
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center rounded-xl border border-slate-200/70 bg-white/65 dark:border-slate-800 dark:bg-slate-900/50">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex min-h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-white/60 px-4 text-center dark:border-slate-800 dark:bg-slate-900/45">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
                <ClipboardList className="h-6 w-6" />
              </span>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">هیچ اقدامی یافت نشد</p>
              <p className="text-[10px] text-slate-400">فیلترها را تغییر دهید یا یک اقدام جدید ثبت کنید.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
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
                  handleEditSave={handleEditSave}
                  setEditingTaskId={setEditingTaskId}
                  setWorkflowTask={setWorkflowTask}
                  fetchWorkflow={fetchWorkflow}
                  canEdit={canEdit}
                  userId={userId}
                  setDeleteConfirmTask={setDeleteConfirmTask}
                  setAddNoteTask={setAddNoteTask}
                  setReferTask={setReferTask}
                  handleUpdateTask={handleUpdateTask}
                  finalAllUsers={finalAllUsers as UserProfile[]}
                  userSelectorGroups={userSelectorGroups}
                  users={users}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {workflowTask && (
        <WorkflowModal task={workflowTask} steps={workflowSteps} users={users} onClose={() => setWorkflowTask(null)} />
      )}

      {referTask && userId && (() => {
        const actor = users.find(u => u.user_id === userId);
        return (
          <ReferModal
            task={referTask}
            users={finalAllUsers as UserProfile[]}
            groups={userSelectorGroups}
            currentUserId={userId}
            actorName={actor?.full_name || actor?.email || 'کاربر'}
            actorAvatarUrl={actor?.avatar_url || null}
            onClose={() => setReferTask(null)}
            onReferred={fetchTasks}
          />
        );
      })()}

      {addNoteTask && userId && (() => {
        const actor = users.find(u => u.user_id === userId);
        return (
          <AddNoteModal
            task={addNoteTask}
            userId={userId}
            actorName={actor?.full_name || actor?.email || 'کاربر'}
            actorAvatarUrl={actor?.avatar_url || null}
            onClose={() => setAddNoteTask(null)}
            onSaved={fetchTasks}
          />
        );
      })()}

      {deleteConfirmTask && (
        <DeleteTaskModal
          task={deleteConfirmTask}
          onConfirm={() => handleDeleteTask(deleteConfirmTask)}
          onCancel={() => setDeleteConfirmTask(null)}
        />
      )}
    </>
  );
}
