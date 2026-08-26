import React from 'react';
import { JALAALI_WEEKDAYS, toFarsiDigits } from './utils';
import { CalendarViewProps } from './CalendarViewTypes';

export function MonthView(p: CalendarViewProps) {
  const {
    mainMonthDays, currentJy, currentJm,
    isToday, isSelected, getOccasionsForDay, getMeetings, getMeetingColor, toFarsiTime,
    setSelectedJy, setSelectedJm, setSelectedJd, setMonthDayPopup, onCreateMeetingForDay,
  } = p;

  return (
    <div className="mx-2 mb-2 mt-1 flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none sm:mx-3 sm:mb-3">
      <div className="grid flex-shrink-0 grid-cols-7 border-b border-slate-200/80 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-900/70">
        {JALAALI_WEEKDAYS.map((d, i) => (
          <div key={d} className={`py-2 text-center text-[10px] sm:text-[11px] ${i === 6 ? 'font-bold text-rose-500 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400'}`}>{d}</div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto bg-white dark:bg-slate-950">
        <div className="grid grid-cols-7">
          {mainMonthDays.map((day, idx) => {
            if (day === null) {
              return <div key={`e${idx}`} className="min-h-[72px] border-b border-r border-slate-100 bg-slate-50/45 dark:border-slate-800/80 dark:bg-slate-900/45 sm:min-h-[96px]" />;
            }

            const dm = getMeetings(currentJy, currentJm, day);
            const isTd = isToday(currentJy, currentJm, day);
            const isSel = isSelected(currentJy, currentJm, day);
            const isFri = idx % 7 === 6;
            const dayOcc = getOccasionsForDay(currentJy, currentJm, day);
            const hasHoliday = dayOcc.some((o: any) => o.is_holiday);

            return (
              <div
                key={day}
                onClick={e => {
                  setSelectedJy(currentJy); setSelectedJm(currentJm); setSelectedJd(day);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMonthDayPopup({ jy: currentJy, jm: currentJm, jd: day, x: rect.left, y: rect.bottom });
                }}
                className={`group relative min-h-[72px] min-w-0 cursor-pointer overflow-hidden border-b border-r border-slate-100 p-1 transition-colors dark:border-slate-800/80 sm:min-h-[96px] sm:p-1.5 ${isSel
                  ? 'bg-indigo-50/80 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/10 dark:ring-indigo-500/20'
                  : hasHoliday
                    ? 'bg-rose-50/35 hover:bg-rose-50/65 dark:bg-rose-500/5 dark:hover:bg-rose-500/10'
                    : 'hover:bg-violet-50/35 dark:hover:bg-violet-500/5'}`}
              >
                <div className="relative flex items-center justify-between">
                  <button
                    type="button"
                    aria-label={`اقدامات روز ${toFarsiDigits(day)}`}
                    title="مشاهده برنامه‌های این روز"
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedJy(currentJy); setSelectedJm(currentJm); setSelectedJd(day);
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setMonthDayPopup({ jy: currentJy, jm: currentJm, jd: day, x: rect.left, y: rect.bottom });
                    }}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded-full text-[10px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 sm:h-8 sm:w-8 sm:text-xs ${isTd
                      ? 'bg-violet-600 font-bold text-white shadow-sm dark:bg-violet-500'
                      : (isFri || hasHoliday)
                        ? 'font-bold text-rose-500 dark:text-rose-400'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                  >
                    {toFarsiDigits(day)}
                  </button>

                </div>

                {dayOcc.length > 0 && (
                  <div className="mt-0.5 min-w-0 space-y-0.5 overflow-hidden">
                    {dayOcc.slice(0, 1).map((o: any) => (
                      <div
                        key={o.id}
                        title={o.title}
                        className={`block w-full min-w-0 max-w-full truncate px-0.5 py-0.5 text-[8px] leading-tight sm:text-[9px] ${o.is_holiday
                          ? 'text-rose-700 dark:text-rose-300'
                          : o.is_celebration
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-slate-500 dark:text-slate-400'}`}
                      >
                        {o.title}
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-0.5 space-y-0.5">
                  {dm.slice(0, 3).map(m => {
                    const c = getMeetingColor(m);
                    return (
                      <div
                        key={m.id}
                        className="truncate rounded-md px-1 py-0.5 text-[8px] font-medium leading-tight text-white shadow-sm sm:px-1.5 sm:text-[10px]"
                        style={{ backgroundColor: c }}
                        title={m.subject}
                      >
                        <span className="hidden sm:inline">{m.start_time ? toFarsiTime(m.start_time) + ' ' : ''}</span>
                        {m.subject}
                      </div>
                    );
                  })}
                  {dm.length > 3 && (
                    <div className="px-1 text-[9px] font-bold text-violet-600 dark:text-violet-300 sm:text-[10px]">
                      +{toFarsiDigits(dm.length - 3)} مورد دیگر
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
