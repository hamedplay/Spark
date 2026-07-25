import React, { useState, useEffect } from 'react';
import { Plus, Search, Loader as Loader2, X, MessageSquare, ClipboardList } from 'lucide-react';
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
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  const [users, setUsers] = useState<UserProfile[]>([]);

  const { groups: orgGroups, allUsers: finalAllUsers } = useOrgUsers(userId);
  const userSelectorGroups = orgGroups.map(g => ({label: g.unit_name,users: g.users,}));

  // Modals
  const [workflowTask, setWorkflowTask] = useState<Task | null>(null);
  const [workflowSteps, setWorkflowSteps] = useState<TaskWorkflowStep[]>([]);
  const [referTask, setReferTask] = useState<Task | null>(null);
  const [addNoteTask, setAddNoteTask] = useState<Task | null>(null);
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<Task | null>(null);

  // New task form
  const [newTask, setNewTask] = useState({
    title: '',
    description: prefillDescription || '',
    priority: 'medium' as Task['priority'],
    assigneeId: '',
    assigneeName: '',
  });
  const [newDueDate, setNewDueDate] = useState<Date | null>(null);

  // Edit form
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

  // Auto-open create form with prefill
  useEffect(() => {
    if (prefillDescription) {
      setNewTask(t => ({ ...t, description: prefillDescription }));
      setNewDueDate(new Date());
      setShowCreateForm(true);
      onPrefillConsumed?.();
    }
  }, [prefillDescription]);

  const fetchUsers = async () => {
    const { data } = await supabase.from('profiles').select('user_id, full_name, email, avatar_url').not('is_hidden', 'eq', true);
    if (data) setUsers(data);
  };

  const fetchTasks = async () => {
    try {
      const { data, error } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setTasks(data || []);
    } catch { toast.error('خطا در دریافت اقدامات'); }
    finally { setLoading(false); }
  };

  const fetchWorkflow = async (taskId: string) => {
    const { data } = await supabase
      .from('task_workflow_steps').select('*').eq('task_id', taskId).order('created_at', { ascending: true });
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
          newTask.assigneeId, userId,
          `اقدام جدید برای شما: ${newTask.title}`,
          `${creatorName} یک اقدام جدید به شما اختصاص داد — سررسید: ${toJalali(newDueDate!.toISOString())}`,
          creatorName, creatorProfile?.avatar_url || undefined,
          newTask.title,
        );
      }

      toast.success('اقدام جدید ایجاد شد');
      logAudit({ module: 'tasks', action: 'task_created', entity_name: newTask.title, entity_id: inserted?.id, details: `اقدام "${newTask.title}" برای ${newTask.assigneeName} ایجاد شد`, severity: 'info' });
      setShowCreateForm(false);
      setNewTask({ title: '', description: '', priority: 'medium', assigneeId: '', assigneeName: '' });
      setNewDueDate(null);
      fetchTasks();
    } catch { toast.error('خطا در ایجاد اقدام'); }
    finally { setLoading(false); }
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
            sendTaskNotification(rid, userId,
              `تغییر وضعیت اقدام: ${fullTask.title}`,
              `${actorName}: وضعیت اقدام «${fullTask.title}» ${statusLabel}`,
              actorName, actorProfile?.avatar_url || undefined, fullTask.title
            )
          ));
        }
      }

      toast.success(shouldArchive ? 'تکمیل و بایگانی شد' : 'به‌روزرسانی شد');
      const fullTask = tasks.find(t => t.id === taskId);
      logAudit({ module: 'tasks', action: updatedData.status ? `task_${updatedData.status}` : 'task_updated', entity_name: fullTask?.title || taskId, entity_id: taskId, details: updatedData.status ? `وضعیت اقدام به "${updatedData.status}" تغییر کرد` : 'اقدام به‌روز شد', severity: 'info' });
      fetchTasks();
      setEditingTaskId(null);
      setEditingTask(null);
    } catch { toast.error('خطا در به‌روزرسانی'); }
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
      logAudit({ module: 'tasks', action: 'task_deleted', entity_name: task.title, entity_id: task.id, details: `اقدام "${task.title}" حذف شد`, severity: 'warn' });
      fetchTasks();
    } catch (e: any) {
      toast.error('خطا در حذف اقدام: ' + (e?.message || ''));
    } finally {
      setDeleteConfirmTask(null);
    }
  };

  const handleExportToExcel = async () => {    const exportData = tasks.map(task => ({
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

  const filteredTasks = tasks.filter(task => {
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

  if (!userId) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h2 className="text-2xl font-bold dark:text-white">مدیریت اقدامات</h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={handleExportToExcel}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl transition-colors text-sm">
            دریافت اکسل
          </button>
          {canCreate && (
            <button onClick={() => setShowCreateForm(v => !v)}
              className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-4 py-2 rounded-xl transition-colors text-sm">
              <Plus className="w-4 h-4" /> اقدام جدید
            </button>
          )}
        </div>
      </div>

      {/* Tabs: کارتابل */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        <button onClick={() => setTaskTab('assigned_to_me')}
          className={`relative flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${taskTab === 'assigned_to_me' ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          کارتابل من
          {assignedToMeCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-bold">
              {assignedToMeCount > 9 ? '9+' : assignedToMeCount}
            </span>
          )}
        </button>
        <button onClick={() => setTaskTab('created_by_me')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${taskTab === 'created_by_me' ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          ایجاد شده توسط من
          {createdByMeCount > 0 && (
            <span className="w-5 h-5 rounded-full bg-gray-400 text-white text-xs flex items-center justify-center font-bold">
              {createdByMeCount > 9 ? '9+' : createdByMeCount}
            </span>
          )}
        </button>
        <button onClick={() => setTaskTab('all')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${taskTab === 'all' ? 'bg-white dark:bg-gray-700 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
          همه
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <form onSubmit={handleCreateTask} className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-6 border border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white mb-5 flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-teal-500" /> ایجاد اقدام جدید
          </h3>
          {prefillDescription && (
            <div className="mb-4 p-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-xl text-sm text-teal-700 dark:text-teal-300 flex items-start gap-2">
              <MessageSquare className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>این اقدام از متن پیام چت ایجاد می‌شود</span>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">عنوان *</label>
              <input required type="text" value={newTask.title}
                onChange={e => setNewTask(t => ({ ...t, title: e.target.value }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اقدام کننده *</label>
              <UserSelector users={finalAllUsers as UserProfile[]} groups={userSelectorGroups} value={newTask.assigneeId}
                onChange={(id, name) => setNewTask(t => ({ ...t, assigneeId: id, assigneeName: name }))}
                placeholder="انتخاب کاربر" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">اولویت</label>
              <select value={newTask.priority}
                onChange={e => setNewTask(t => ({ ...t, priority: e.target.value as Task['priority'] }))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                <option value="high">بالا</option>
                <option value="medium">متوسط</option>
                <option value="low">پایین</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ سررسید شمسی *</label>
              <JalaliDateInput value={newDueDate} onChange={setNewDueDate} />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">توضیحات *</label>
              <textarea required value={newTask.description}
                onChange={e => setNewTask(t => ({ ...t, description: e.target.value }))}
                rows={4} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm resize-none" />
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button type="submit" disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-2.5 rounded-xl font-medium transition-colors disabled:opacity-50">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              ایجاد اقدام
            </button>
            <button type="button" onClick={() => setShowCreateForm(false)}
              className="px-5 flex items-center gap-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl transition-colors">
              <X className="w-4 h-4" /> انصراف
            </button>
          </div>
        </form>
      )}

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="جستجو..." className="w-full pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm" />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm">
          <option value="all">همه اقدامات</option>
          <option value="pending">در انتظار</option>
          <option value="in_progress">در حال انجام</option>
          <option value="completed">تکمیل شده</option>
          <option value="archived">بایگانی شده</option>
        </select>
      </div>

      {/* Task grid */}
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : filteredTasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
          <ClipboardList className="w-12 h-12 opacity-30" />
          <p className="text-lg">هیچ اقدامی یافت نشد</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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

      {/* Workflow flowchart modal */}
      {workflowTask && (
        <WorkflowModal task={workflowTask} steps={workflowSteps} users={users} onClose={() => setWorkflowTask(null)} />
      )}

      {/* Refer modal */}
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

      {/* Add note / log action modal */}
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

      {/* Delete confirmation modal */}
      {deleteConfirmTask && (
        <DeleteTaskModal
          task={deleteConfirmTask}
          onConfirm={() => handleDeleteTask(deleteConfirmTask)}
          onCancel={() => setDeleteConfirmTask(null)}
        />
      )}
    </div>
  );
}
