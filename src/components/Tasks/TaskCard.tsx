import React from 'react';
import { Save, X, GitFork, User, Calendar, MessageSquare, ClipboardList, Trash2, ArrowLeft, CreditCard as Edit2, Archive, AlertTriangle } from 'lucide-react';
import { Task } from '../../types';
import { type UserProfile } from './types';
import { type OrgUserProfile } from '../../lib/useOrgUsers';
import { toJalali } from './utils';
import { JalaliDateInput } from './JalaliDateInput';
import { UserSelector } from './UserSelector';

const priorityBadge: Record<string, string> = {
  high: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
  medium: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
};
const statusBadge: Record<string, string> = {
  pending: 'border-amber-200 bg-amber-50/80 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  in_progress: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
};
const statusLabel: Record<string, string> = { pending: 'در انتظار', in_progress: 'در حال انجام', completed: 'تکمیل شده' };

interface TaskCardProps {
  task: Task;
  isEditing: boolean;
  editingTask: Task | null;
  setEditingTask: (t: Task | null) => void;
  editAssigneeId: string;
  setEditAssigneeId: (id: string) => void;
  editDueDate: Date | null;
  setEditDueDate: (d: Date | null) => void;
  handleEditSave: () => void;
  setEditingTaskId: (id: string | null) => void;
  setWorkflowTask: (t: Task) => void;
  fetchWorkflow: (id: string) => Promise<void>;
  canEdit: boolean;
  userId: string | null;
  setDeleteConfirmTask: (t: Task) => void;
  setAddNoteTask: (t: Task) => void;
  setReferTask: (t: Task) => void;
  handleUpdateTask: (id: string, data: Partial<Task>) => void;
  finalAllUsers: UserProfile[];
  userSelectorGroups: { label: string; users: OrgUserProfile[] }[];
  users: UserProfile[];
}

function TaskCard({
  task, isEditing, editingTask, setEditingTask, editAssigneeId, setEditAssigneeId,
  editDueDate, setEditDueDate, handleEditSave, setEditingTaskId, setWorkflowTask,
  fetchWorkflow, canEdit, userId, setDeleteConfirmTask, setAddNoteTask, setReferTask,
  handleUpdateTask, finalAllUsers, userSelectorGroups, users,
}: TaskCardProps) {
  const getCreatorName = (t: Task) => {
    if (!t.created_by_id) return '—';
    const u = users.find(u => u.user_id === t.created_by_id);
    return u?.full_name || u?.email || '—';
  };

  const dueAt = new Date(task.due_date).getTime();
  const isOverdue = !task.archived && task.status !== 'completed' && Number.isFinite(dueAt) && dueAt < Date.now();
  const cardSurface = task.archived
    ? 'border-slate-200 bg-white/75 dark:border-slate-800 dark:bg-slate-900/65'
    : isOverdue
      ? 'border-rose-200 bg-gradient-to-br from-white to-rose-50/55 ring-1 ring-rose-100 dark:border-rose-500/30 dark:from-slate-900 dark:to-rose-950/20 dark:ring-rose-400/10'
      : task.status === 'in_progress'
        ? 'border-blue-100 bg-gradient-to-br from-white to-blue-50/35 dark:border-blue-500/20 dark:from-slate-900 dark:to-blue-950/15'
        : task.status === 'completed'
          ? 'border-emerald-100 bg-gradient-to-br from-white to-emerald-50/35 dark:border-emerald-500/20 dark:from-slate-900 dark:to-emerald-950/15'
          : 'border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-900/80';

  const iconActionClass = 'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors';

  return (
    <article
      key={task.id}
      id={`task-${task.id}`}
      className={`relative overflow-hidden rounded-2xl border p-3 shadow-[0_6px_20px_rgba(15,23,42,0.04)] transition-all hover:shadow-[0_10px_28px_rgba(15,23,42,0.065)] sm:p-3.5 ${cardSurface} ${task.archived ? 'opacity-75' : ''}`}
    >
      {isOverdue && <span className="absolute inset-y-0 right-0 w-1 bg-rose-400" />}

      {isEditing ? (
        <div className="space-y-2.5">
          <input type="text" value={editingTask?.title || ''}
            onChange={e => setEditingTask(t => t ? { ...t, title: e.target.value } : null)}
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="عنوان" />
          <div>
            <label className="mb-1 block text-[10px] text-slate-500 dark:text-slate-400">اقدام کننده</label>
            <UserSelector users={finalAllUsers} groups={userSelectorGroups} value={editAssigneeId}
              onChange={(id) => setEditAssigneeId(id)}
              placeholder={editingTask?.assignee || 'انتخاب کاربر'} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={editingTask?.priority || 'medium'}
              onChange={e => setEditingTask(t => t ? { ...t, priority: e.target.value as Task['priority'] } : null)}
              className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="high">بالا</option>
              <option value="medium">متوسط</option>
              <option value="low">پایین</option>
            </select>
            <JalaliDateInput
              value={editDueDate || (editingTask ? new Date(editingTask.due_date) : null)}
              onChange={setEditDueDate} />
          </div>
          <textarea value={editingTask?.description || ''}
            onChange={e => setEditingTask(t => t ? { ...t, description: e.target.value } : null)}
            rows={3} className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={handleEditSave}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 text-xs font-bold text-white transition hover:from-violet-500 hover:to-indigo-500">
              <Save className="h-3.5 w-3.5" /> ذخیره
            </button>
            <button onClick={() => { setEditingTaskId(null); setEditingTask(null); }}
              className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">
              <X className="h-3.5 w-3.5" /> انصراف
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3 className="mobile-line-clamp-2 text-sm font-bold leading-5 text-slate-800 dark:text-white">{task.title}</h3>
              {isOverdue && (
                <div className="mt-1 flex items-center gap-1 text-[9px] font-bold text-rose-600 dark:text-rose-300">
                  <AlertTriangle className="h-3 w-3" /> سررسید گذشته
                </div>
              )}
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                onClick={async () => { setWorkflowTask(task); await fetchWorkflow(task.id); }}
                className={`${iconActionClass} border-violet-200 bg-violet-50 text-violet-600 hover:bg-violet-100 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300`}
                title="مسیر اقدام" aria-label="مسیر اقدام">
                <GitFork className="h-3.5 w-3.5" />
              </button>
              {canEdit && (
                <button
                  onClick={() => { setEditingTaskId(task.id); setEditingTask(task); setEditDueDate(null); setEditAssigneeId(task.current_assignee_id || ''); }}
                  className={`${iconActionClass} border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300`}
                  title="ویرایش" aria-label="ویرایش">
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              )}
              {(task.user_id === userId || task.created_by_id === userId) && (
                <button
                  onClick={() => setDeleteConfirmTask(task)}
                  className={`${iconActionClass} border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300`}
                  title="حذف اقدام" aria-label="حذف اقدام">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="mb-2 flex flex-wrap gap-1">
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${priorityBadge[task.priority]}`}>
              {task.priority === 'high' ? 'اولویت بالا' : task.priority === 'medium' ? 'اولویت متوسط' : 'اولویت پایین'}
            </span>
            <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${statusBadge[task.status]}`}>
              {statusLabel[task.status]}
            </span>
            {task.current_assignee_id === userId && (task.created_by_id !== userId && task.user_id !== userId) && (
              <span className="flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300" title="ارجاع شده به من">
                <ArrowLeft className="h-3 w-3" /> ارجاع به من
              </span>
            )}
            {task.current_assignee_id === userId && (task.created_by_id === userId || task.user_id === userId) && (
              <span className="flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[9px] font-bold text-cyan-700 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300">
                <User className="h-3 w-3" /> مسئول: من
              </span>
            )}
            {task.source_message_id && (
              <span className="flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700 dark:border-violet-500/25 dark:bg-violet-500/10 dark:text-violet-300" title="ایجادشده از چت">
                <MessageSquare className="h-3 w-3" /> از چت
              </span>
            )}
            {task.archived && (
              <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                <Archive className="h-3 w-3" /> بایگانی
              </span>
            )}
          </div>

          {task.description && (
            <p className="mobile-line-clamp-2 mb-2 text-[11px] leading-5 text-slate-600 dark:text-slate-400" title={task.description}>{task.description}</p>
          )}

          <div className="mb-2.5 grid grid-cols-2 gap-x-2 gap-y-1 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2 text-[9px] text-slate-500 dark:border-slate-800 dark:bg-slate-800/45 dark:text-slate-400">
            <div className="col-span-2 hidden min-w-0 items-center gap-1.5 sm:flex">
              <User className="h-3 w-3 flex-shrink-0 text-slate-400" />
              <span className="truncate">ایجادکننده: <span className="font-bold text-slate-700 dark:text-slate-300">{getCreatorName(task)}</span></span>
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
              <User className="h-3 w-3 flex-shrink-0 text-cyan-500" />
              <span className="truncate">{task.assignee || 'بدون مسئول'}</span>
            </div>
            <div className={`flex min-w-0 items-center gap-1.5 ${isOverdue ? 'font-bold text-rose-600 dark:text-rose-300' : ''}`}>
              <Calendar className="h-3 w-3 flex-shrink-0" />
              <span className="truncate" dir="ltr">{toJalali(task.due_date)}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
            <select value={task.status}
              onChange={e => handleUpdateTask(task.id, { status: e.target.value as Task['status'] })}
              className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-[10px] text-slate-700 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white">
              <option value="pending">در انتظار</option>
              <option value="in_progress">در حال انجام</option>
              <option value="completed">تکمیل شده</option>
            </select>
            {userId && (
              <button onClick={() => setAddNoteTask(task)}
                className="inline-flex h-8 flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
                title="ثبت اقدام">
                <ClipboardList className="h-3.5 w-3.5" /> ثبت
              </button>
            )}
            {userId && (
              <button onClick={() => setReferTask(task)}
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-600 transition hover:bg-amber-100 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300"
                title="ارجاع" aria-label="ارجاع">
                <ArrowLeft className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </>
      )}
    </article>
  );
}

export { TaskCard };
