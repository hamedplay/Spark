import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, TextAlignJustify as AlignJustify, ChevronDown, CalendarDays } from 'lucide-react';
import { CalendarEntry, MeetingData } from './types';
import { JALAALI_MONTHS, JALAALI_WEEKDAYS_SHORT } from './utils';

interface Props {
  // Mini calendar
  sidebarJy: number;
  sidebarJm: number;
  sidebarMonthDays: (number | null)[];
  onSidebarPrev: () => void;
  onSidebarNext: () => void;
  onSidebarMonthClick: () => void;
  onDayClick: (day: number) => void;
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  getMeetingsForDay: (jy: number, jm: number, jd: number) => MeetingData[];

  // Calendars
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  enabledCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;

  // Occasions calendar enabled state
  occasionsEnabled: boolean;
  onToggleOccasions: () => void;

  // Group open state
  myGroupOpen: boolean;
  sharedGroupOpen: boolean;
  publicGroupOpen: boolean;
  onMyGroupToggle: () => void;
  onSharedGroupToggle: () => void;
  onPublicGroupToggle: () => void;

  // Filter
  showOnlyMine?: boolean;
  onShowOnlyMineChange?: (v: boolean) => void;

  // Actions
  onNewCalendar: () => void;
  onOpenCalendarList: () => void;
  onShareCalendar: (cal: CalendarEntry) => void;
  onEditCalendar: (cal: CalendarEntry) => void;
  onDeleteCalendar: (id: string) => void;
}

export function CalendarSidebar({
  sidebarJy, sidebarJm, sidebarMonthDays,
  onSidebarPrev, onSidebarNext, onSidebarMonthClick, onDayClick,
  isToday, isSelected, getMeetingsForDay,
  calendars, subscribedCalendars, enabledCalendarIds, onToggleCalendar,
  occasionsEnabled, onToggleOccasions,
  myGroupOpen, sharedGroupOpen, publicGroupOpen,
  onMyGroupToggle, onSharedGroupToggle, onPublicGroupToggle,
  onNewCalendar, onOpenCalendarList,
}: Props) {
  const [miniCalOpen, setMiniCalOpen] = useState(true);
  const [calendarsOpen, setCalendarsOpen] = useState(true);
  const privateOwned = calendars.filter(c => c.type === 'private');
  const sharedOwned = calendars.filter(c => c.type === 'shared');
  const publicOwned = calendars.filter(c => c.type === 'public');

  return (
    <div className="w-64 flex-shrink-0 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 flex flex-col overflow-hidden shadow-sm" dir="rtl">
      {/* Mini calendar */}
      <div className="border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <button onClick={() => setMiniCalOpen(v => !v)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">تقویم ماهانه</span>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${miniCalOpen ? '' : 'rotate-180'}`} />
        </button>
        {miniCalOpen && (
          <div className="px-3 pb-3">
            <div className="flex items-center justify-between mb-2">
              <button onClick={onSidebarPrev} className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                <ChevronRight className="w-4 h-4 dark:text-white" />
              </button>
              <button onClick={onSidebarMonthClick} className="text-sm font-semibold dark:text-white hover:text-blue-500">
                {JALAALI_MONTHS[sidebarJm - 1]} {sidebarJy}
              </button>
              <button onClick={onSidebarNext} className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700">
                <ChevronLeft className="w-4 h-4 dark:text-white" />
              </button>
            </div>
            <div className="grid grid-cols-7">
              {JALAALI_WEEKDAYS_SHORT.map((d, i) => (
                <div key={i} className={`text-center text-[10px] font-medium py-1 ${i === 6 ? 'text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>{d}</div>
              ))}
              {sidebarMonthDays.map((day, idx) => {
                if (day === null) return <div key={`e${idx}`} />;
                const isTd = isToday(sidebarJy, sidebarJm, day);
                const isSel = isSelected(sidebarJy, sidebarJm, day);
                const hasM = getMeetingsForDay(sidebarJy, sidebarJm, day).length > 0;
                const isFri = idx % 7 === 6;
                return (
                  <button
                    key={day}
                    onClick={() => onDayClick(day)}
                    className={`relative text-[11px] w-7 h-7 mx-auto flex items-center justify-center rounded-full transition-colors font-medium ${isTd ? 'bg-blue-500 text-white' : isSel ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 ' + (isFri ? 'text-red-400' : 'text-gray-700 dark:text-gray-300')}`}
                  >
                    {day}
                    {hasM && !isTd && <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-blue-400" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Calendars section with collapsible toggle */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <button onClick={() => setCalendarsOpen(v => !v)}
          className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">تقویم‌های موجود</span>
          <div className="flex items-center gap-1">
            <button onClick={e => { e.stopPropagation(); onOpenCalendarList(); }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" title="لیست تقویم‌ها">
              <AlignJustify className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            </button>
            <button onClick={e => { e.stopPropagation(); onNewCalendar(); }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg" title="تقویم جدید">
              <Plus className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
            </button>
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${calendarsOpen ? '' : 'rotate-180'}`} />
          </div>
        </button>
        {calendarsOpen && (
          <div className="flex-1 p-3 space-y-1 overflow-y-auto">

            {/* ── Occasions calendar ───────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/10">
                <input
                  type="checkbox"
                  checked={occasionsEnabled}
                  onChange={onToggleOccasions}
                  className="w-4 h-4 rounded flex-shrink-0"
                  style={{ accentColor: '#f59e0b' }}
                />
                <CalendarDays className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                <span className="flex-1 text-sm dark:text-gray-300 font-medium text-amber-700 dark:text-amber-400">مناسبت‌ها</span>
              </div>
              <p className="text-[10px] text-gray-400 px-2 pb-1 leading-tight">تعطیلات و مناسبت‌های شمسی و قمری</p>
            </div>

            <div className="border-t border-gray-100 dark:border-gray-700 pt-1" />

            {/* My personal calendars */}
            {privateOwned.length > 0 && (
              <div>
                <button onClick={onMyGroupToggle} className="w-full flex items-center justify-between py-1.5 text-sm font-semibold dark:text-white hover:text-blue-500">
                  <span>تقویم‌های شخصی</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${myGroupOpen ? '' : 'rotate-180'}`} />
                </button>
                {myGroupOpen && (
                  <div className="space-y-0.5 mt-1">
                    {privateOwned.map(cal => (
                      <div key={cal.id} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group/cal">
                        <input type="checkbox" checked={enabledCalendarIds.has(cal.id)} onChange={() => onToggleCalendar(cal.id)} className="w-4 h-4 rounded flex-shrink-0" style={{ accentColor: cal.color }} />
                        <span className="flex-1 text-sm dark:text-gray-300 truncate">{cal.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Shared calendars */}
            {(sharedOwned.length > 0 || subscribedCalendars.length > 0) && (
              <div>
                <button onClick={onSharedGroupToggle} className="w-full flex items-center justify-between py-1.5 text-sm font-semibold dark:text-white hover:text-blue-500">
                  <span>تقویم‌های اشتراکی</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${sharedGroupOpen ? '' : 'rotate-180'}`} />
                </button>
                {sharedGroupOpen && (
                  <div className="space-y-0.5 mt-1">
                    {[...sharedOwned, ...subscribedCalendars].map(cal => (
                      <div key={cal.id} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group/cal">
                        <input type="checkbox" checked={enabledCalendarIds.has(cal.id)} onChange={() => onToggleCalendar(cal.id)} className="w-4 h-4 rounded flex-shrink-0" style={{ accentColor: cal.color }} />
                        <span className="flex-1 text-sm dark:text-gray-300 truncate">{cal.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Public calendars */}
            {publicOwned.length > 0 && (
              <div>
                <button onClick={onPublicGroupToggle} className="w-full flex items-center justify-between py-1.5 text-sm font-semibold dark:text-white hover:text-blue-500">
                  <span>تقویم‌های عمومی</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${publicGroupOpen ? '' : 'rotate-180'}`} />
                </button>
                {publicGroupOpen && (
                  <div className="space-y-0.5 mt-1">
                    {publicOwned.map(cal => (
                      <div key={cal.id} className="flex items-center gap-2 px-1 py-1 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 group/cal">
                        <input type="checkbox" checked={enabledCalendarIds.has(cal.id)} onChange={() => onToggleCalendar(cal.id)} className="w-4 h-4 rounded flex-shrink-0" style={{ accentColor: cal.color }} />
                        <span className="flex-1 text-sm dark:text-gray-300 truncate">{cal.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
