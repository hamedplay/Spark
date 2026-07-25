import React from 'react';
import { X, GitFork, ArrowLeft, CircleCheck as CheckCircle, MessageSquare, ClipboardList } from 'lucide-react';
import moment from 'moment-jalaali';
import { Task, TaskWorkflowStep } from '../../types';
import { type UserProfile } from './types';

function WorkflowModal({ task, steps, users, onClose }: {
  task: Task;
  steps: TaskWorkflowStep[];
  users: UserProfile[];
  onClose: () => void;
}) {
  const getName = (id?: string | null) => {
    if (!id) return '—';
    const u = users.find(u => u.user_id === id);
    return u?.full_name || u?.email;
  };

  const actionMeta: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    created: { label: 'ایجاد شد', color: 'bg-blue-100 border-blue-400 text-blue-700 dark:bg-blue-900/30 dark:border-blue-500 dark:text-blue-300', icon: <ClipboardList className="w-4 h-4" /> },
    referred: { label: 'ارجاع داده شد', color: 'bg-amber-100 border-amber-400 text-amber-700 dark:bg-amber-900/30 dark:border-amber-500 dark:text-amber-300', icon: <ArrowLeft className="w-4 h-4" /> },
    accepted: { label: 'شروع شد', color: 'bg-teal-100 border-teal-400 text-teal-700 dark:bg-teal-900/30 dark:border-teal-500 dark:text-teal-300', icon: <CheckCircle className="w-4 h-4" /> },
    completed: { label: 'تکمیل شد', color: 'bg-green-100 border-green-400 text-green-700 dark:bg-green-900/30 dark:border-green-500 dark:text-green-300', icon: <CheckCircle className="w-4 h-4" /> },
    rejected: { label: 'رد شد', color: 'bg-red-100 border-red-400 text-red-700 dark:bg-red-900/30 dark:border-red-500 dark:text-red-300', icon: <X className="w-4 h-4" /> },
    note_added: { label: 'اقدام ثبت شد', color: 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-gray-300', icon: <MessageSquare className="w-4 h-4" /> },
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-bold dark:text-white flex items-center gap-2">
              <GitFork className="w-5 h-5 text-teal-500" /> مسیر اقدام
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{task.title}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-6">
          {steps.length === 0 ? (
            <p className="text-center text-gray-400 py-8">هیچ مرحله‌ای ثبت نشده است</p>
          ) : (
            <div className="relative">
              <div className="absolute right-5 top-5 bottom-5 w-0.5 bg-gray-200 dark:bg-gray-700" />
              <div className="space-y-5">
                {steps.map(step => {
                  const meta = actionMeta[step.action] || actionMeta.note_added;
                  const iconBg = meta.color.split(' ')[0];
                  const iconBorder = meta.color.split(' ')[1];
                  return (
                    <div key={step.id} className="flex gap-4 relative">
                      <div className={`w-10 h-10 rounded-full border-2 flex items-center justify-center flex-shrink-0 relative z-10 ${iconBg} ${iconBorder}`}>
                        {meta.icon}
                      </div>
                      <div className={`flex-1 rounded-xl border p-3 ${meta.color}`}>
                        <div className="flex items-center justify-between flex-wrap gap-1">
                          <span className="font-semibold text-sm">{meta.label}</span>
                          <span className="text-xs opacity-70" dir="ltr">{moment(step.created_at).format('jYYYY/jMM/jDD HH:mm')}</span>
                        </div>
                        <p className="text-sm mt-1">
                          <span className="opacity-70">توسط: </span>
                          <span className="font-medium">{getName(step.actor_id)}</span>
                          {step.to_user_id && (
                            <>
                              <span className="opacity-70"> ← ارجاع به: </span>
                              <span className="font-medium">{getName(step.to_user_id)}</span>
                            </>
                          )}
                        </p>
                        {step.note && <p className="text-xs mt-1.5 opacity-80 bg-white/50 dark:bg-black/20 rounded-lg p-2">{step.note}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { WorkflowModal };
