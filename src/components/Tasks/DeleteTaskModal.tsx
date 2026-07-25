import React from 'react';
import { Trash2 } from 'lucide-react';
import { Task } from '../../types';

function DeleteTaskModal({ task, onConfirm, onCancel }: {
  task: Task;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
            <Trash2 className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h3 className="font-bold dark:text-white">حذف اقدام</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">این عملیات قابل بازگشت نیست</p>
          </div>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          آیا از حذف اقدام <span className="font-semibold">«{task.title}»</span> اطمینان دارید؟
        </p>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors"
          >
            حذف
          </button>
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

export { DeleteTaskModal };
