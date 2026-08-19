import React from 'react';
import { Save, X, GitFork, User, Calendar, MessageSquare, ClipboardList, Trash2, ArrowLeft, CreditCard as Edit2, Archive, PanelLeftOpen, Clock3 } from 'lucide-react';
import { Task } from '../../types';
import { type UserProfile } from './types';
import { type OrgUserProfile } from '../../lib/useOrgUsers';
import { toJalali } from './utils';
import { JalaliDateInput } from './JalaliDateInput';
import { UserSelector } from './UserSelector';

export type ActionTask = Task & {
  start_date?: string | null;
  progress_percent?: number | null;
  estimated_minutes?: number | null;
  tags?: string[] | null;
};

const priorityBadge: Record<string, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  low: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};
const statusBadge: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  completed: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};
const statusLabel: Record<string, string> = { pending: 'در انتظار', in_progress: 'در حال انجام', completed: 'تکمیل شده' };

interface TaskCardProps {
  task: ActionTask;
  isEditing: boolean;
  editingTask: ActionTask | null;
  setEditingTask: (t: ActionTask | null) => void;
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
  handleUpdateTask: (id: string, data: Partial<ActionTask>) => void;
  finalAllUsers: UserProfile[];
  userSelectorGroups: { label: string; users: OrgUserProfile[] }[];
  users: UserProfile[];
  onOpenDetails?: (task: ActionTask) => void;
}

function TaskCard({
  task, isEditing, editingTask, setEditingTask, editAssigneeId, setEditAssigneeId,
  editDueDate, setEditDueDate, handleEditSave, setEditingTaskId, setWorkflowTask,
  fetchWorkflow, canEdit, userId, setDeleteConfirmTask, setAddNoteTask, setReferTask,
  handleUpdateTask, finalAllUsers, userSelectorGroups, users, onOpenDetails,
}: TaskCardProps) {
  const getCreatorName = (t: Task) => {
    if (!t.created_by_id) return '—';
    const u = users.find(u => u.user_id === t.created_by_id);
    return u?.full_name || u?.email || '—';
  };

  const progress = task.status === 'completed' ? 100 : Math.max(0, Math.min(100, task.progress_percent ?? 0));

  return (
    <div key={task.id} id={`task-${task.id}`}
      className={`bg-white dark:bg-gray-800 rounded-2xl shadow-md border border-gray-100 dark:border-gray-700 p-5 hover:shadow-lg transition-all ${task.archived ? 'opacity-70' : ''}`}>
      {isEditing ? (
        <div className="space-y-3">
          <input type="text" value={editingTask?.title || ''}
            onChange={e => setEditingTask(t => t ? { ...t, title: e.target.value } : null)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" placeholder="عنوان" />
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">اقدام کننده</label>
            <UserSelector users={finalAllUsers} groups={userSelectorGroups} value={editAssigneeId}
              onChange={(id) => setEditAssigneeId(id)}
              placeholder={editingTask?.assignee || 'انتخاب کاربر'} />
          </div>
          <select value={editingTask?.priority || 'medium'}
            onChange={e => setEditingTask(t => t ? { ...t, priority: e.target.value as Task['priority'] } : null)}
            className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
            <option value="high">بالا</option>
            <option value="medium">متوسط</option>
            <option value="low">پایین</option>
          </select>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تاریخ سررسید</label>
            <JalaliDateInput
              value={editDueDate || (editingTask?.due_date ? new Date(editingTask.due_date) : null)}
              onChange={setEditDueDate} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">پیشرفت</label>
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="100" step="5" value={editingTask?.progress_percent ?? 0}
                onChange={e => setEditingTask(t => t ? { ...t, progress_percent: Number(e.target.value) } : null)}
                className="flex-1" />
              <span className="text-xs font-semibold text-teal-600 dark:text-teal-400 w-10 text-left">{editingTask?.progress_percent ?? 0}%</span>
            </div>
          </div>
          <textarea value={editingTask?.description || ''}
            onChange={e => setEditingTask(t => t ? { ...t, description: e.target.value } : null)}
            rows={3} className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm resize-none" />
          <div className="flex gap-2">
            <button onClick={handleEditSave}
              className="flex-1 flex items-center justify-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-white py-2 rounded-xl text-sm transition-colors">
              <Save className="w-4 h-4" /> ذخیره
            </button>
            <button onClick={() => { setEditingTaskId(null); setEditingTask(null); }}
              className="flex-1 flex items-center justify-center gap-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-xl text-sm transition-colors">
              <X className="w-4 h-4" /> انصراف
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2 mb-3">
            <button type="button" onClick={() => onOpenDetails?.(task)} className="text-right flex-1 group">
              <h3 className="font-bold text-gray-800 dark:text-white text-base leading-snug group-hover:text-teal-600 dark:group-hover:text-teal-400 transition-colors">{task.title}</h3>
            </button>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onOpenDetails && (
                <button onClick={() => onOpenDetails(task)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
                  title="جزئیات اقدام">
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={async () => { setWorkflowTask(task); await fetchWorkflow(task.id); }}
                className="p-1.5 rounded-lg text-gray-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors"
                title="مسیر اقدام">
                <GitFork className="w-4 h-4" />
              </button>
              {canEdit && (
                <button
                  onClick={() => { setEditingTaskId(task.id); setEditingTask(task); setEditDueDate(null); setEditAssigneeId(task.current_assignee_id || ''); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
              {(task.user_id === userId || task.created_by_id === userId) && (
                <button
                  onClick={() => setDeleteConfirmTask(task)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="حذف اقدام">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-3">
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${priorityBadge[task.priority]}`}>
              {task.priority === 'high' ? 'اولویت بالا' : task.priority === 'medium' ? 'متوسط' : 'پایین'}
            </span>
            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${statusBadge[task.status]}`}>
              {statusLabel[task.status]}
            </span>
            {task.current_assignee_id === userId && (task.created_by_id !== userId && task.user_id !== userId) && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 flex items-center gap-1">
                <ArrowLeft className="w-3 h-3" /> ارجاع به من
              </span>
            )}
            {task.current_assignee_id === userId && (task.created_by_id === userId || task.user_id === userId) && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex items-center gap-1">
                <User className="w-3 h-3" /> اقدام‌کننده: من
              </span>
            )}
            {task.source_message_id && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300 flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> از چت/کانال
              </span>
            )}
            {task.archived && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400 flex items-center gap-1">
                <Archive className="w-3 h-3" /> بایگانی
              </span>
            )}
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-3">{task.description}</p>

          <div className="mb-4">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              <span>پیشرفت</span><span className="font-semibold">{progress}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>

          <div className="space-y-1.5 text-sm text-gray-500 dark:text-gray-400 mb-4">
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 flex-shrink-0 text-gray-400" />
              <span>ایجادکننده: <span className="text-gray-700 dark:text-gray-300 font-medium">{getCreatorName(task)}</span></span>
            </div>
            <div className="flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 flex-shrink-0 text-teal-500" />
              <span>اقدام‌کننده: <span className="text-gray-700 dark:text-gray-300 font-medium">{task.assignee || '—'}</span></span>
            </div>
            {task.start_date && (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                <span>شروع: <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{toJalali(task.start_date)}</span></span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
              <span>سررسید: <span className="text-gray-700 dark:text-gray-300 font-medium" dir="ltr">{task.due_date ? toJalali(task.due_date) : '—'}</span></span>
            </div>
            {!!task.estimated_minutes && (
              <div className="flex items-center gap-1.5">
                <Clock3 className="w-3.5 h-3.5 flex-shrink-0" />
                <span>زمان تخمینی: <span className="text-gray-700 dark:text-gray-300 font-medium">{Math.round(task.estimated_minutes / 60 * 10) / 10} ساعت</span></span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <select value={task.status}
              onChange={e => handleUpdateTask(task.id, { status: e.target.value as Task['status'], progress_percent: e.target.value === 'completed' ? 100 : task.progress_percent })}
              className="flex-1 px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm dark:bg-gray-700 dark:text-white">
              <option value="pending">در انتظار</option>
              <option value="in_progress">در حال انجام</option>
              <option value="completed">تکمیل شده</option>
            </select>
            {userId && (
              <button onClick={() => setAddNoteTask(task)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-50 hover:bg-teal-100 dark:bg-teal-900/20 dark:hover:bg-teal-900/40 text-teal-600 dark:text-teal-400 rounded-xl text-sm border border-teal-200 dark:border-teal-700 transition-colors"
                title="ثبت اقدام">
                <ClipboardList className="w-3.5 h-3.5" /> ثبت
              </button>
            )}
            {userId && (
              <button onClick={() => setReferTask(task)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-600 dark:text-amber-400 rounded-xl text-sm border border-amber-200 dark:border-amber-700 transition-colors"
                title="ارجاع">
                <ArrowLeft className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export { TaskCard };
