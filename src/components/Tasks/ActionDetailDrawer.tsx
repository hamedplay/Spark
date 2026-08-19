import React, { useEffect, useState } from 'react';
import { X, Calendar, User, Clock3, GitFork, MessageSquare, ClipboardList, ArrowLeft, CircleCheck as CheckCircle2 } from 'lucide-react';
import moment from 'moment-jalaali';
import { supabase } from '../../lib/supabase';
import { TaskWorkflowStep } from '../../types';
import { type UserProfile } from './types';
import { type ActionTask } from './TaskCard';
import { ActionCapabilitiesPanel } from './ActionCapabilitiesPanel';
import { toJalali } from './utils';

interface ActionDetailDrawerProps {
  task: ActionTask;
  users: UserProfile[];
  onClose: () => void;
  onEdit: (task: ActionTask) => void;
  onAddNote: (task: ActionTask) => void;
  onRefer: (task: ActionTask) => void;
}

const statusLabel: Record<string, string> = {
  pending: 'در انتظار',
  in_progress: 'در حال انجام',
  completed: 'تکمیل شده',
};

const priorityLabel: Record<string, string> = {
  high: 'بالا',
  medium: 'متوسط',
  low: 'پایین',
};

const actionLabel: Record<string, string> = {
  created: 'ایجاد شد',
  referred: 'ارجاع داده شد',
  accepted: 'شروع شد',
  completed: 'تکمیل شد',
  rejected: 'رد شد',
  note_added: 'گزارش اقدام ثبت شد',
};

export function ActionDetailDrawer({ task, users, onClose, onEdit, onAddNote, onRefer }: ActionDetailDrawerProps) {
  const [steps, setSteps] = useState<TaskWorkflowStep[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase.from('task_workflow_steps').select('*').eq('task_id', task.id).order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!cancelled) {
          setSteps((data || []) as TaskWorkflowStep[]);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [task.id]);

  const nameOf = (id?: string | null) => {
    if (!id) return '—';
    const user = users.find(u => u.user_id === id);
    return user?.full_name || user?.email || '—';
  };

  const progress = task.status === 'completed' ? 100 : Math.max(0, Math.min(100, task.progress_percent ?? 0));

  return (
    <div className="fixed inset-0 z-[9998] flex justify-start bg-black/40 backdrop-blur-[1px]" dir="rtl" onMouseDown={e => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <aside className="h-full w-full sm:w-[560px] bg-white dark:bg-gray-900 shadow-2xl overflow-y-auto border-r border-gray-200 dark:border-gray-700">
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-700 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">{statusLabel[task.status] || task.status}</span>
                <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">اولویت {priorityLabel[task.priority] || task.priority}</span>
                {task.source_message_id && <span className="text-xs px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">از چت/کانال</span>}
              </div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-8">{task.title}</h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 dark:hover:text-gray-200">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={() => onEdit(task)} className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium">ویرایش</button>
            <button onClick={() => onAddNote(task)} className="px-3 py-2 rounded-xl border border-teal-200 text-teal-700 dark:text-teal-300 dark:border-teal-800 text-sm flex items-center gap-1.5"><ClipboardList className="w-4 h-4" /> ثبت</button>
            <button onClick={() => onRefer(task)} className="px-3 py-2 rounded-xl border border-amber-200 text-amber-700 dark:text-amber-300 dark:border-amber-800 text-sm flex items-center gap-1.5"><ArrowLeft className="w-4 h-4" /> ارجاع</button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-bold text-gray-800 dark:text-white mb-4">مشخصات اقدام</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="flex items-start gap-2"><User className="w-4 h-4 mt-0.5 text-teal-500" /><div><div className="text-gray-400 text-xs">اقدام‌کننده</div><div className="font-medium text-gray-800 dark:text-gray-200">{task.assignee || nameOf(task.current_assignee_id)}</div></div></div>
              <div className="flex items-start gap-2"><User className="w-4 h-4 mt-0.5 text-gray-400" /><div><div className="text-gray-400 text-xs">ایجادکننده</div><div className="font-medium text-gray-800 dark:text-gray-200">{nameOf(task.created_by_id || task.user_id)}</div></div></div>
              <div className="flex items-start gap-2"><Calendar className="w-4 h-4 mt-0.5 text-violet-500" /><div><div className="text-gray-400 text-xs">تاریخ شروع</div><div className="font-medium text-gray-800 dark:text-gray-200">{task.start_date ? toJalali(task.start_date) : '—'}</div></div></div>
              <div className="flex items-start gap-2"><Calendar className="w-4 h-4 mt-0.5 text-red-400" /><div><div className="text-gray-400 text-xs">سررسید</div><div className="font-medium text-gray-800 dark:text-gray-200">{task.due_date ? toJalali(task.due_date) : '—'}</div></div></div>
              <div className="flex items-start gap-2"><Clock3 className="w-4 h-4 mt-0.5 text-blue-500" /><div><div className="text-gray-400 text-xs">زمان تخمینی</div><div className="font-medium text-gray-800 dark:text-gray-200">{task.estimated_minutes ? `${Math.round(task.estimated_minutes / 60 * 10) / 10} ساعت` : '—'}</div></div></div>
              <div className="flex items-start gap-2"><GitFork className="w-4 h-4 mt-0.5 text-purple-500" /><div><div className="text-gray-400 text-xs">مراحل ثبت‌شده</div><div className="font-medium text-gray-800 dark:text-gray-200">{steps.length}</div></div></div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-2"><span>پیشرفت</span><span className="font-bold text-teal-600 dark:text-teal-400">{progress}%</span></div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${progress}%` }} /></div>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="font-bold text-gray-800 dark:text-white mb-3">توضیحات</h3>
            <p className="text-sm leading-7 text-gray-600 dark:text-gray-300 whitespace-pre-wrap">{task.description || 'توضیحی ثبت نشده است.'}</p>
          </section>

          {!!task.tags?.length && (
            <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="font-bold text-gray-800 dark:text-white mb-3">برچسب‌ها</h3>
              <div className="flex flex-wrap gap-2">{task.tags.map(tag => <span key={tag} className="text-xs px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300">{tag}</span>)}</div>
            </section>
          )}

          <ActionCapabilitiesPanel task={task} />

          <section className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-800 dark:text-white">تاریخچه و جریان اقدام</h3>
              <MessageSquare className="w-4 h-4 text-gray-400" />
            </div>
            {loading ? (
              <div className="text-sm text-gray-400 py-6 text-center">در حال بارگذاری...</div>
            ) : steps.length === 0 ? (
              <div className="text-sm text-gray-400 py-6 text-center">هیچ رویدادی ثبت نشده است.</div>
            ) : (
              <div className="space-y-4">
                {steps.map(step => (
                  <div key={step.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center flex-shrink-0"><CheckCircle2 className="w-4 h-4 text-teal-500" /></div>
                    <div className="min-w-0 flex-1 border-b border-gray-100 dark:border-gray-800 pb-4">
                      <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-gray-800 dark:text-gray-200">{actionLabel[step.action] || step.action}</span><span className="text-[11px] text-gray-400" dir="ltr">{moment(step.created_at).format('jYYYY/jMM/jDD HH:mm')}</span></div>
                      <div className="text-xs text-gray-500 mt-1">توسط {nameOf(step.actor_id)}{step.to_user_id ? ` ← ${nameOf(step.to_user_id)}` : ''}</div>
                      {step.note && <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-6 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-2">{step.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}
