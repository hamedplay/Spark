import type { MeetingData } from './types';

export function ResizeConfirmDialog({
  pendingResize,
  onConfirm,
  onCancel,
}: {
  pendingResize: { meeting: MeetingData; newEndTime: string } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!pendingResize) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 mx-4 w-full max-w-sm">
        <h3 className="text-base font-bold text-gray-800 dark:text-white mb-1">تأیید تغییر مدت جلسه</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">آیا از تغییر زمان پایان این جلسه اطمینان دارید؟</p>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 mb-5 space-y-2">
          <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{pendingResize.meeting.subject}</p>
          <div className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 w-10 flex-shrink-0 mt-0.5">قبل:</span>
            <span className="text-gray-600 dark:text-gray-300" dir="ltr">
              {pendingResize.meeting.start_time} تا {pendingResize.meeting.end_time}
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 w-10 flex-shrink-0 mt-0.5">بعد:</span>
            <span className="text-teal-600 dark:text-teal-400 font-medium" dir="ltr">
              {pendingResize.meeting.start_time} تا {pendingResize.newEndTime}
            </span>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            انصراف
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors"
          >
            تأیید تغییر
          </button>
        </div>
      </div>
    </div>
  );
}
