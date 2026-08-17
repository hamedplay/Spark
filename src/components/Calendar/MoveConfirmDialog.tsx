import { toJalaali, JALAALI_MONTHS } from './utils';
import type { MeetingData } from './types';

export function MoveConfirmDialog({
  pendingMove,
  onConfirm,
  onCancel,
}: {
  pendingMove: {
    meeting: MeetingData;
    updates: Record<string, string>;
    oldDateIso: string;
    newDateIso: string;
  } | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!pendingMove) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-6 mx-4 w-full max-w-sm">
        <h3 className="text-base font-bold text-gray-800 dark:text-white mb-1">تأیید جابجایی جلسه</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">آیا از جابجایی این جلسه اطمینان دارید؟</p>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 mb-5 space-y-2">
          <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">{pendingMove.meeting.subject}</p>
          <div className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 w-10 flex-shrink-0 mt-0.5">قبل:</span>
            <span className="text-gray-600 dark:text-gray-300">
              {(() => { const d = new Date(pendingMove.oldDateIso + 'T12:00:00'); const j = toJalaali(d); return `${j.jd} ${JALAALI_MONTHS[j.jm - 1]} ${j.jy}`; })()}
              {' — '}
              <span dir="ltr">{pendingMove.meeting.start_time} تا {pendingMove.meeting.end_time}</span>
            </span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="text-gray-400 w-10 flex-shrink-0 mt-0.5">بعد:</span>
            <span className="text-teal-600 dark:text-teal-400 font-medium">
              {(() => { const d = new Date(pendingMove.newDateIso + 'T12:00:00'); const j = toJalaali(d); return `${j.jd} ${JALAALI_MONTHS[j.jm - 1]} ${j.jy}`; })()}
              {' — '}
              <span dir="ltr">{pendingMove.updates.start_time} تا {pendingMove.updates.end_time}</span>
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
            تأیید جابجایی
          </button>
        </div>
      </div>
    </div>
  );
}
