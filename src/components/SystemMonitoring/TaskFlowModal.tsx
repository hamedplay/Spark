import React from 'react';
import { GitBranch, X, CircleCheck as CheckCircle, ArrowRight, Circle, SquareCheck as CheckSquare, Hash } from 'lucide-react';
import { type TaskRow } from './types';
import { toJalaliTime } from './utils';

function TaskFlowModal({ task, onClose }: { task: TaskRow; onClose: () => void }) {
  const actionLabel: Record<string, string> = {
    created: 'ایجاد اقدام', referred: 'ارجاع شده', accepted: 'پذیرفته شده',
    completed: 'تکمیل شده', rejected: 'رد شده', note_added: 'یادداشت اضافه شد',
  };
  const actionColor: Record<string, string> = {
    created: 'bg-blue-500', referred: 'bg-amber-500', accepted: 'bg-teal-500',
    completed: 'bg-green-500', rejected: 'bg-red-500', note_added: 'bg-gray-400',
  };
  const ActionIcon: Record<string, React.ElementType> = {
    created: Circle, referred: ArrowRight, accepted: CheckCircle,
    completed: CheckSquare, rejected: Circle, note_added: Hash,
  };

  const steps = task.workflow || [];

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
              <GitBranch className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">فلوچارت اقدام</h3>
              <p className="text-xs text-gray-400 truncate max-w-xs">{task.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5">
          {steps.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <GitBranch className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">تاریخچه‌ای ثبت نشده</p>
              <p className="text-xs mt-1 text-gray-300 dark:text-gray-600">مراحل اقدام هنوز ثبت نشده‌اند</p>
            </div>
          ) : steps.map((step, i) => {
            const Icon = ActionIcon[step.action] || Circle;
            const color = actionColor[step.action] || 'bg-gray-400';
            return (
              <div key={step.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${color}`}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>
                  {i < steps.length - 1 && <div className="w-0.5 flex-1 my-1 bg-gray-200 dark:bg-gray-700 rounded-full" style={{ minHeight: '28px' }} />}
                </div>
                <div className={`pb-4 flex-1 ${i === steps.length - 1 ? 'pb-0' : ''}`}>
                  <p className="font-semibold text-sm text-gray-900 dark:text-white">{actionLabel[step.action] || step.action}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{toJalaliTime(step.created_at)}</p>
                  {step.actor_name && <p className="text-xs text-blue-500 mt-0.5">توسط: {step.actor_name}</p>}
                  {step.from_name && <p className="text-xs text-gray-500 mt-0.5">از: {step.from_name}</p>}
                  {step.to_name && <p className="text-xs text-teal-500 mt-0.5">به: {step.to_name}</p>}
                  {step.note && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 bg-gray-50 dark:bg-gray-700/50 px-2 py-1 rounded-lg">{step.note}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { TaskFlowModal };
