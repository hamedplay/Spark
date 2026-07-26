import React from 'react';
import { CalendarPlus } from 'lucide-react';
import { MeetingData } from './types';
import { JALAALI_WEEKDAYS } from './utils';

export interface MonthViewProps {
  currentJy: number; currentJm: number;
  mainMonthDays: Array<number | null>;
  getMeetings: (jy: number, jm: number, jd: number) => MeetingData[];
  getMeetingColor: (m: MeetingData) => string;
  isToday: (jy: number, jm: number, jd: number) => boolean;
  isSelected: (jy: number, jm: number, jd: number) => boolean;
  toFarsiTime: (t: string) => string;
  getOccasionsForDay: (jy: number, jm: number, jd: number) => any[];
  setSelectedJy: (v: number) => void;
  setSelectedJm: (v: number) => void;
  setSelectedJd: (v: number) => void;
  setMonthDayPopup: (v: any) => void;
  onCreateMeetingForDay?: (jy: number, jm: number, jd: number) => void;
}

export function MonthView(p: MonthViewProps) {
  const {
    currentJy, currentJm, mainMonthDays, getMeetings, getMeetingColor,
    isToday, isSelected, toFarsiTime, getOccasionsForDay,
    setSelectedJy, setSelectedJm, setSelectedJd, setMonthDayPopup, onCreateMeetingForDay,
  } = p;

  return (
    <div className="flex flex-col flex-1 overflow-hidden mx-3 mb-3 mt-1 border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-900 shadow-sm">
      <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        {JALAALI_WEEKDAYS.map((d, i) => (
          <div key={d} className={`text-center text-[10px] sm:text-xs font-medium py-1.5 sm:py-2 ${i === 6 ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>{d}</div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto bg-white dark:bg-gray-900">
        <div className="grid grid-cols-7">
          {mainMonthDays.map((day, idx) => {
            if (day === null) return <div key={`e${idx}`} className="min-h-[60px] sm:min-h-[90px] bg-gray-50/50 dark:bg-gray-800/50 border-b border-r border-gray-100 dark:border-gray-700" />;
            const dm = getMeetings(currentJy, currentJm, day);
            const isTd = isToday(currentJy, currentJm, day);
            const isSel = isSelected(currentJy, currentJm, day);
            const isFri = idx % 7 === 6;
            const dayOcc = getOccasionsForDay(currentJy, currentJm, day);
            const hasHoliday = dayOcc.some((o: any) => o.is_holiday);
            return (
              <div key={day}
                onClick={e => {
                  setSelectedJy(currentJy); setSelectedJm(currentJm); setSelectedJd(day);
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  setMonthDayPopup({ jy: currentJy, jm: currentJm, jd: day, x: rect.left, y: rect.bottom });
                }}
                className={`min-h-[60px] sm:min-h-[90px] p-0.5 sm:p-1 border-b border-r border-gray-100 dark:border-gray-700 cursor-pointer transition-colors hover:bg-blue-50/40 dark:hover:bg-blue-900/10 ${isSel ? 'bg-blue-50 dark:bg-blue-900/20' : hasHoliday ? 'bg-red-50/40 dark:bg-red-900/10' : ''}`}>
                <div className="relative flex items-center justify-between">
                  <button type="button" aria-label={`اقدامات روز ${day}`} title="مشاهده و ایجاد برنامه‌های این روز"
                    onClick={e => { e.stopPropagation(); setSelectedJy(currentJy); setSelectedJm(currentJm); setSelectedJd(day); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setMonthDayPopup({ jy: currentJy, jm: currentJm, jd: day, x: rect.left, y: rect.bottom }); }}
                    className={`text-[10px] sm:text-xs font-medium w-5 h-5 sm:w-6 sm:h-6 inline-flex items-center justify-center rounded-full transition-colors hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${isTd ? 'bg-blue-500 text-white' : (isFri || hasHoliday) ? 'text-red-500 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}`}>{day}</button>
                  {onCreateMeetingForDay && (
                    <button type="button" title="تنظیم جلسه" aria-label={`تنظیم جلسه برای روز ${day}`}
                      onClick={e => { e.stopPropagation(); onCreateMeetingForDay(currentJy, currentJm, day); }}
                      className="absolute top-0 left-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-gray-300 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                      <CalendarPlus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {dayOcc.length > 0 && (
                  <div className="space-y-0.5 mt-0.5">
                    {dayOcc.slice(0, 1).map((o: any) => (
                      <div key={o.id} title={o.title} className={`text-[8px] sm:text-[9px] px-0.5 sm:px-1 py-0.5 rounded truncate font-medium leading-tight ${o.is_holiday ? 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' : o.is_celebration ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>{o.title}</div>
                    ))}
                  </div>
                )}
                <div className="space-y-0.5 mt-0.5">
                  {dm.slice(0, 2).map(m => {
                    const c = getMeetingColor(m);
                    return (
                      <div key={m.id} className="text-[7px] sm:text-[10px] px-1 sm:px-1.5 py-0.5 rounded text-white truncate font-medium" style={{ backgroundColor: c }}>
                        <span className="hidden sm:inline">{m.start_time ? toFarsiTime(m.start_time) + ' ' : ''}</span>
                        {m.subject}
                      </div>
                    );
                  })}
                  {dm.length > 2 && <div className="text-[9px] sm:text-[10px] text-blue-500 dark:text-blue-400 px-0.5 sm:px-1 font-medium">+{dm.length - 2}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
