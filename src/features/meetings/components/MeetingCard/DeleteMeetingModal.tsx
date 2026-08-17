import { useState } from 'react';
import { Trash2, X, Loader as Loader2, TriangleAlert as AlertTriangle } from 'lucide-react';
import { Meeting } from '../../../../types';

interface DeleteMeetingModalProps {
  meeting: Meeting;
  onClose: () => void;
  onPermanentDelete: () => void;
  loading: boolean;
}

export function DeleteMeetingModal({ meeting, onClose, onPermanentDelete, loading }: DeleteMeetingModalProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white text-base flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-red-500" />
            حذف جلسه
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!confirmDelete ? (
          <div className="p-5 space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center pb-1">
              آیا می‌خواهید جلسه «{meeting.subject}» را حذف کنید؟
            </p>

            {/* Permanent delete */}
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={loading}
              className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-400 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group disabled:opacity-50"
            >
              <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-800 dark:text-white">حذف کامل برای همه</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  جلسه به طور دائمی حذف می‌شود و هیچ رکوردی باقی نمی‌ماند
                </p>
              </div>
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-500" />
              </div>
              <p className="text-sm font-semibold text-gray-800 dark:text-white text-center">آیا مطمئن هستید؟</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                این عمل غیرقابل بازگشت است. جلسه «{meeting.subject}» برای همیشه حذف خواهد شد.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                className="py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                انصراف
              </button>
              <button
                onClick={() => { onPermanentDelete(); onClose(); }}
                disabled={loading}
                className="py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                حذف کامل
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
