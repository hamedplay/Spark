import { useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, TextAlignJustify as AlignJustify, ChevronDown, CalendarDays } from 'lucide-react';
import { CalendarEntry, MeetingData } from './types';
import { JALAALI_MONTHS, JALAALI_WEEKDAYS_SHORT } from './utils';

interface Props {
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
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  enabledCalendarIds: Set<string>;
  onToggleCalendar: (id: string) => void;
  occasionsEnabled: boolean;
  onToggleOccasions: () => void;
  myGroupOpen: boolean;
  sharedGroupOpen: boolean;
  publicGroupOpen: boolean;
  onMyGroupToggle: () => void;
  onSharedGroupToggle: () => void;
  onPublicGroupToggle: () => void;
  showOnlyMine?: boolean;
  onShowOnlyMineChange?: (v: boolean) => void;
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

  const groupButtonClass = 'flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50 hover:text-violet-600 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-violet-300';
  const calendarRowClass = 'flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800';

  return (
    <div className="flex h-full w-64 flex-shrink-0 flex-col overflow-hidden border-l border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-950" dir="rtl">
      <div className="flex-shrink-0 border-b border-slate-100 dark:border-slate-800">
        <button
          onClick={() => setMiniCalOpen(v => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-right transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
              <CalendarDays className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">تقویم ماهانه</p>
              <p className="text-[9px] text-slate-400">انتخاب سریع روز</p>
            </div>
          </div>
          <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${miniCalOpen ? '' : 'rotate-180'}`} />
        </button>

        {miniCalOpen && (
          <div className="px-3 pb-3">
            <div className="mb-1.5 flex items-center justify-between rounded-lg bg-slate-50 p-1 dark:bg-slate-900">
              <button onClick={onSidebarPrev} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-violet-300">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
              <button onClick={onSidebarMonthClick} className="text-xs font-bold text-slate-700 transition-colors hover:text-violet-600 dark:text-slate-200 dark:hover:text-violet-300">
                {JALAALI_MONTHS[sidebarJm - 1]} {sidebarJy}
              </button>
              <button onClick={onSidebarNext} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-violet-600 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-violet-300">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-0.5">
              {JALAALI_WEEKDAYS_SHORT.map((d, i) => (
                <div key={i} className={`py-1 text-center text-[9px] ${i === 6 ? 'text-rose-400' : 'text-slate-400 dark:text-slate-500'}`}>{d}</div>
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
                    className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-lg text-[10px] transition-all ${isTd
                      ? 'bg-violet-600 font-bold text-white shadow-sm dark:bg-violet-500'
                      : isSel
                        ? 'bg-indigo-50 font-bold text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/30'
                        : `hover:bg-slate-100 dark:hover:bg-slate-800 ${isFri ? 'text-rose-400' : 'text-slate-600 dark:text-slate-300'}`}`}
                  >
                    {day}
                    {hasM && !isTd && <span className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-cyan-500" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-shrink-0 items-center gap-1 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
          <button
            onClick={() => setCalendarsOpen(v => !v)}
            className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-1.5 py-1 text-right transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
          >
            <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">تقویم‌های من</span>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform duration-200 ${calendarsOpen ? '' : 'rotate-180'}`} />
          </button>
          <button onClick={onOpenCalendarList} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600 dark:text-slate-400 dark:hover:bg-indigo-500/10 dark:hover:text-indigo-300" title="مدیریت تقویم‌ها">
            <AlignJustify className="h-3.5 w-3.5" />
          </button>
          <button onClick={onNewCalendar} className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600 transition-colors hover:bg-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:hover:bg-violet-500/15" title="تقویم جدید">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {calendarsOpen && (
          <div className="flex-1 space-y-1 overflow-y-auto p-2.5">
            <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-1 dark:border-amber-500/15 dark:bg-amber-500/5">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5">
                <input
                  type="checkbox"
                  checked={occasionsEnabled}
                  onChange={onToggleOccasions}
                  className="h-3.5 w-3.5 flex-shrink-0 rounded"
                  style={{ accentColor: '#f59e0b' }}
                />
                <CalendarDays className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-amber-700 dark:text-amber-300">مناسبت‌ها</p>
                  <p className="truncate text-[9px] text-amber-600/70 dark:text-amber-400/70">تعطیلات و مناسبت‌های شمسی و قمری</p>
                </div>
              </label>
            </div>

            {privateOwned.length > 0 && (
              <div className="pt-0.5">
                <button onClick={onMyGroupToggle} className={groupButtonClass}>
                  <span>شخصی</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${myGroupOpen ? '' : 'rotate-180'}`} />
                </button>
                {myGroupOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {privateOwned.map(cal => (
                      <label key={cal.id} className={`${calendarRowClass} cursor-pointer`}>
                        <input type="checkbox" checked={enabledCalendarIds.has(cal.id)} onChange={() => onToggleCalendar(cal.id)} className="h-3.5 w-3.5 flex-shrink-0 rounded" style={{ accentColor: cal.color }} />
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: cal.color }} />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{cal.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(sharedOwned.length > 0 || subscribedCalendars.length > 0) && (
              <div className="pt-0.5">
                <button onClick={onSharedGroupToggle} className={groupButtonClass}>
                  <span className="text-cyan-700 dark:text-cyan-300">اشتراکی</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${sharedGroupOpen ? '' : 'rotate-180'}`} />
                </button>
                {sharedGroupOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {[...sharedOwned, ...subscribedCalendars].map(cal => (
                      <label key={cal.id} className={`${calendarRowClass} cursor-pointer`}>
                        <input type="checkbox" checked={enabledCalendarIds.has(cal.id)} onChange={() => onToggleCalendar(cal.id)} className="h-3.5 w-3.5 flex-shrink-0 rounded" style={{ accentColor: cal.color }} />
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: cal.color }} />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{cal.name}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {publicOwned.length > 0 && (
              <div className="pt-0.5">
                <button onClick={onPublicGroupToggle} className={groupButtonClass}>
                  <span className="text-emerald-700 dark:text-emerald-300">عمومی</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${publicGroupOpen ? '' : 'rotate-180'}`} />
                </button>
                {publicGroupOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {publicOwned.map(cal => (
                      <label key={cal.id} className={`${calendarRowClass} cursor-pointer`}>
                        <input type="checkbox" checked={enabledCalendarIds.has(cal.id)} onChange={() => onToggleCalendar(cal.id)} className="h-3.5 w-3.5 flex-shrink-0 rounded" style={{ accentColor: cal.color }} />
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: cal.color }} />
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-600 dark:text-slate-300">{cal.name}</span>
                      </label>
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
