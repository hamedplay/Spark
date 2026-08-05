import { History } from 'lucide-react';
import type { RoleHistoryEntry } from '../types/securityAdministration';

interface Props {
  history: RoleHistoryEntry[];
}

export function SecurityAdminHistory({ history }: Props) {
  if (history.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5" dir="rtl">
        <h3 className="font-bold text-gray-800 dark:text-white text-sm mb-3 flex items-center gap-2">
          <History className="w-4 h-4 text-blue-500" />
          تاریخچه تغییر نقش‌های امنیتی
        </h3>
        <p className="text-sm text-gray-400 text-center py-4">تغییری ثبت نشده است.</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5" dir="rtl">
      <h3 className="font-bold text-gray-800 dark:text-white text-sm mb-3 flex items-center gap-2">
        <History className="w-4 h-4 text-blue-500" />
        تاریخچه تغییر نقش‌های امنیتی (حداکثر ۵۰ تغییر اخیر)
      </h3>
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {history.map((entry) => (
          <div key={entry.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl text-sm">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${entry.new_value ? 'bg-blue-500' : 'bg-red-500'}`} />
              <div>
                <div className="font-medium text-gray-800 dark:text-white">
                  {entry.target_display_name}
                  <span className={`mr-2 text-xs ${entry.new_value ? 'text-blue-500' : 'text-red-500'}`}>
                    {entry.new_value ? 'اعطا' : 'حذف'}
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  توسط {entry.actor_display_name ?? 'نامشخص'} — {new Date(entry.changed_at).toLocaleString('fa-IR')}
                </div>
              </div>
            </div>
            <div className="text-xs text-gray-400 max-w-xs truncate">
              {entry.change_reason ?? 'بدون دلیل'}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
