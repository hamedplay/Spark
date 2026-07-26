import type { AgendaResultRow } from './types';
import { EmptyState } from '../MinutesShared';
import { AgendaResultBadge } from './Badges';

export function TabAgenda({ items }: { items: AgendaResultRow[] }) {
  if (items.length === 0) {
    return <EmptyState title="هنوز ثبت نشده" description="دستور جلسه‌ای ثبت نشده است." />;
  }
  return (
    <div className="space-y-4">
      {items.map(item => (
        <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
              {item.sort_order_snapshot}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.agenda_title_snapshot}</p>
              {item.agenda_description_snapshot && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.agenda_description_snapshot}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {item.presenter_snapshot && <span>ارائه‌دهنده: {item.presenter_snapshot}</span>}
                {item.allocated_minutes_snapshot != null && <span>زمان: {item.allocated_minutes_snapshot} دقیقه</span>}
              </div>
              {item.discussion_result && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">نتیجه:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{item.discussion_result}</p>
                </div>
              )}
            </div>
            <AgendaResultBadge type={item.result_type} />
          </div>
        </div>
      ))}
    </div>
  );
}
