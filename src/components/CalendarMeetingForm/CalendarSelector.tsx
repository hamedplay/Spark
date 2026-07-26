import type { CalendarEntry } from './types';

export function CalendarSelector(props: {
  calendars: CalendarEntry[];
  selectedCalendarId: string;
  setSelectedCalendarId: (v: string) => void;
  setMembersOnly: (fn: (v: boolean) => boolean) => void;
  selectedCalendar: CalendarEntry | undefined;
  membersOnly: boolean;
}) {
  const { calendars, selectedCalendarId, setSelectedCalendarId, setMembersOnly, selectedCalendar, membersOnly } = props;

  return (
    <div className="p-3 bg-teal-50 dark:bg-teal-900/20 rounded-xl border border-teal-200 dark:border-teal-700 space-y-3">
      <div>
        <label className="block text-sm font-medium text-teal-700 dark:text-teal-300 mb-1.5">نوع تقویم</label>
        <select value={selectedCalendarId} onChange={e => { setSelectedCalendarId(e.target.value); if (!e.target.value) setMembersOnly(false); }}
          className="w-full p-2 border border-teal-200 dark:border-teal-600 rounded-lg bg-white dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
          {calendars.filter(c => c.type !== 'private').map(c => <option key={c.id} value={c.id}>{c.name} ({c.type === 'shared' ? 'اشتراکی' : 'عمومی'})</option>)}
        </select>
        {selectedCalendarId && selectedCalendar && (
          <div className="flex items-center gap-2 mt-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: selectedCalendar.color }} />
            <span className="text-xs text-teal-600 dark:text-teal-400">{selectedCalendar.name}</span>
          </div>
        )}
      </div>

      {/* members_only toggle — only for shared calendars */}
      {selectedCalendarId && selectedCalendar?.type === 'shared' && (
        <div className="flex items-center justify-between gap-3 p-2.5 bg-white dark:bg-gray-800 rounded-lg border border-teal-100 dark:border-teal-800">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">نمایش فقط برای اعضای جلسه</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              {membersOnly
                ? 'فقط شرکت‌کنندگان و مطلعین این جلسه را می‌بینند'
                : 'تمام اعضای تقویم این جلسه را می‌بینند'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMembersOnly(v => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${membersOnly ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${membersOnly ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
      )}
    </div>
  );
}
