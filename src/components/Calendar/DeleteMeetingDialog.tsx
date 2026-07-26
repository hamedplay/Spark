import { RotateCcw, Trash2 } from 'lucide-react';
import type { MeetingData } from './types';

function DeleteMeetingDialog({ meeting, isOwner, onRevert, onFull, onClose }: {
  meeting: MeetingData | undefined;
  isOwner: boolean;
  onRevert: () => void;
  onFull: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-red-600 px-5 py-4">
          <h3 className="text-white font-bold text-base">حذف جلسه</h3>
          {meeting && <p className="text-red-100 text-xs mt-1 truncate">«{meeting.subject}»</p>}
        </div>
        <div className="p-5 space-y-3">
          {isOwner ? (
            <>
              <button
                onClick={onRevert}
                className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-right group"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 transition-colors">
                  <RotateCcw className="w-4 h-4 text-blue-600 dark:text-blue-400 group-hover:text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 dark:text-white text-sm">حذف و برگشت به درخواست جلسه</p>
                  <p className="text-xs text-gray-400 mt-0.5">جلسه حذف می‌شود و یک درخواست جلسه جدید با همان اطلاعات ایجاد می‌گردد</p>
                </div>
              </button>
              <button
                onClick={onFull}
                className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group"
              >
                <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
                  <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 dark:text-white text-sm">حذف کامل برای همه</p>
                  <p className="text-xs text-gray-400 mt-0.5">جلسه به طور کامل حذف می‌شود و هیچ رکوردی باقی نمی‌ماند</p>
                </div>
              </button>
            </>
          ) : (
            <button
              onClick={onFull}
              className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group"
            >
              <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
                <Trash2 className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 dark:text-white text-sm">حذف از تقویم من</p>
                <p className="text-xs text-gray-400 mt-0.5">جلسه فقط از تقویم شما حذف می‌شود</p>
              </div>
            </button>
          )}
          <button onClick={onClose} className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

export { DeleteMeetingDialog };
