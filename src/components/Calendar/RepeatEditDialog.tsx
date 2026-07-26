import { Calendar, RefreshCw, Users } from 'lucide-react';
import type { MeetingData } from './types';

function RepeatEditDialog({ meeting, onEditSingle, onEditFollowing, onEditAll, onClose }: {
  meeting: MeetingData;
  onEditSingle: () => void;
  onEditFollowing: () => void;
  onEditAll: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
        <div className="bg-blue-600 px-5 py-4">
          <h3 className="text-white font-bold">ویرایش جلسه تکراری</h3>
          <p className="text-blue-100 text-xs mt-1">کدام جلسات تغییر کنند؟</p>
        </div>
        <div className="p-5 space-y-3">
          <button onClick={onEditSingle}
            className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all text-right group">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-blue-500 transition-colors">
              <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400 group-hover:text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 dark:text-white text-sm">فقط این جلسه</p>
              <p className="text-xs text-gray-400 mt-0.5">تنها همین جلسه تغییر می‌کند</p>
            </div>
          </button>
          <button onClick={onEditFollowing}
            className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-orange-500 dark:hover:border-orange-500 hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all text-right group">
            <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-orange-500 transition-colors">
              <RefreshCw className="w-4 h-4 text-orange-600 dark:text-orange-400 group-hover:text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 dark:text-white text-sm">این و جلسات بعدی</p>
              <p className="text-xs text-gray-400 mt-0.5">از این جلسه به بعد تغییر می‌کنند</p>
            </div>
          </button>
          <button onClick={onEditAll}
            className="w-full flex items-start gap-3 p-4 rounded-xl border-2 border-gray-200 dark:border-gray-600 hover:border-red-500 dark:hover:border-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all text-right group">
            <div className="w-9 h-9 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-red-500 transition-colors">
              <Users className="w-4 h-4 text-red-600 dark:text-red-400 group-hover:text-white" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 dark:text-white text-sm">همه جلسات</p>
              <p className="text-xs text-gray-400 mt-0.5">تمام جلسات تکراری تغییر می‌کنند</p>
            </div>
          </button>
          <button onClick={onClose} className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

export { RepeatEditDialog };
