import React from 'react';
import {
  getJalaaliFirstDayOfWeek,
  getJalaaliMonthDays,
  JALAALI_MONTHS,
  JALAALI_WEEKDAYS_SHORT,
  toFarsiDigits,
} from './utils';
import { CalendarViewProps } from './CalendarViewTypes';

export function YearView(p: CalendarViewProps) {
  return (
    <div className="mx-2 mb-2 mt-1 flex-1 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white p-3 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 dark:shadow-none sm:mx-3 sm:mb-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {JALAALI_MONTHS.map((name, index) => {
          const jm = index + 1;
          const daysInMonth = getJalaaliMonthDays(p.currentJy, jm);
          const firstDay = getJalaaliFirstDayOfWeek(p.currentJy, jm);
          const cells: Array<number | null> = [
            ...Array.from({ length: firstDay }, () => null),
            ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
          ];

          return (
            <section key={jm} className="rounded-2xl border border-slate-100 bg-slate-50/30 p-2.5 dark:border-slate-800 dark:bg-slate-900/25">
              <button
                type="button"
                onClick={() => {
                  p.setSelectedJy(p.currentJy);
                  p.setSelectedJm(jm);
                  p.setSelectedJd(1);
                  p.setViewMode('day');
                }}
                className="mb-2 w-full rounded-lg px-1 py-1 text-right text-sm font-bold text-violet-700 transition-colors hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-500/10"
                aria-label={`رفتن به ${name} ${toFarsiDigits(p.currentJy)}`}
              >
                {name} {toFarsiDigits(p.currentJy)}
              </button>

              <div className="grid grid-cols-7 text-center text-[9px] text-slate-400">
                {JALAALI_WEEKDAYS_SHORT.map((weekday, wi) => (
                  <span key={`${jm}-${weekday}-${wi}`} className={wi === 6 ? 'text-rose-400' : ''}>{weekday}</span>
                ))}

                {cells.map((day, cellIndex) => {
                  if (day === null) return <span key={`empty-${jm}-${cellIndex}`} />;
                  const today = p.isToday(p.currentJy, jm, day);
                  const hasMeeting = p.getMeetings(p.currentJy, jm, day).length > 0;
                  return (
                    <button
                      key={`${jm}-${day}`}
                      type="button"
                      onClick={() => {
                        p.setSelectedJy(p.currentJy);
                        p.setSelectedJm(jm);
                        p.setSelectedJd(day);
                        p.setViewMode('day');
                      }}
                      className={`relative mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-[10px] transition-colors ${today
                        ? 'bg-violet-600 font-bold text-white shadow-sm dark:bg-violet-500'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
                      aria-label={`${toFarsiDigits(day)} ${name} ${toFarsiDigits(p.currentJy)}`}
                    >
                      {toFarsiDigits(day)}
                      {hasMeeting && !today && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-cyan-500" />}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
