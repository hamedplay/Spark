import { X, Search, Share2, Trash2, CreditCard as Edit2 } from 'lucide-react';
import { CalendarEntry, MeetingData, ProfileEntry } from './types';

interface Props {
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  meetings: MeetingData[];
  allProfiles: ProfileEntry[];
  search: string;
  onSearchChange: (v: string) => void;
  onShare: (cal: CalendarEntry) => void;
  onEdit: (cal: CalendarEntry) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function CalendarListModal({
  calendars, subscribedCalendars, meetings, allProfiles,
  search, onSearchChange, onShare, onEdit, onDelete, onClose,
}: Props) {
  const allCals = [...calendars, ...subscribedCalendars];
  const filtered = search.trim()
    ? allCals.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : allCals;

  return (
    <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose}>
      <div
        className="absolute inset-y-0 left-0 w-full max-w-2xl bg-white dark:bg-gray-900 shadow-2xl flex flex-col animate-slideInLeft"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="text-base font-bold dark:text-white">لیست تقویم‌ها</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-red-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => onSearchChange(e.target.value)}
              placeholder="جستجو..."
              className="w-full pl-4 pr-10 py-2 border border-gray-200 dark:border-gray-600 rounded-xl text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0">
              <tr>
                <th className="text-right text-xs text-gray-500 dark:text-gray-400 font-medium px-4 py-2.5">ردیف</th>
                <th className="text-right text-xs text-gray-500 dark:text-gray-400 font-medium px-4 py-2.5">عنوان تقویم</th>
                <th className="text-right text-xs text-gray-500 dark:text-gray-400 font-medium px-4 py-2.5">تعداد رویدادها</th>
                <th className="text-right text-xs text-gray-500 dark:text-gray-400 font-medium px-4 py-2.5">ایجاد کننده</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((cal, idx) => {
                const isOwned = calendars.some(c => c.id === cal.id);
                const eventCount = meetings.filter(m => m.calendar_id === cal.id).length;
                const owner = allProfiles.find(p => p.user_id === cal.user_id);
                return (
                  <tr key={cal.id} className="border-b border-gray-50 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-sm text-gray-400">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: cal.color }} />
                        <span className="text-sm dark:text-white font-medium">{cal.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{eventCount}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">{owner?.full_name || owner?.email || '—'}</td>
                    <td className="px-4 py-3">
                      {isOwned && (
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => onShare(cal)} className="p-1.5 text-gray-400 hover:text-green-500 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20" title="اشتراک‌گذاری">
                            <Share2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => onEdit(cal)} className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => onDelete(cal.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-gray-400 text-sm">تقویمی یافت نشد</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
