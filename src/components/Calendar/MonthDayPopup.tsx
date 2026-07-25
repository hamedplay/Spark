import React from 'react';
import { CalendarPlus, Plus, X } from 'lucide-react';
import { JALAALI_MONTHS } from './utils';
import type { MeetingData } from './types';

interface Occasion {
  id: string;
  title: string;
  is_holiday: boolean;
  is_celebration: boolean;
}

interface AllDayEvent {
  id: string;
  title: string;
  type: string;
}

function MonthDayPopup({
  jy, jm, jd, x, y, meetings, occasions, dayEvents, isToday, toFarsiTime, getMeetingColor,
  popupRef,
  onCreateMeeting, onCreateAllDay, onDeleteAllDay, onMeetingClick, onDayView, onClose,
}: {
  jy: number; jm: number; jd: number; x: number; y: number;
  meetings: MeetingData[]; occasions: Occasion[]; dayEvents: AllDayEvent[];
  isToday: (jy: number, jm: number, jd: number) => boolean;
  toFarsiTime: (t: string) => string;
  getMeetingColor: (m: MeetingData) => string;
  popupRef: React.RefObject<HTMLDivElement | null>;
  onCreateMeeting: () => void;
  onCreateAllDay: () => void;
  onDeleteAllDay: (id: string) => void;
  onMeetingClick: (m: MeetingData) => void;
  onDayView: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[55] pointer-events-none" dir="rtl">
      <div
        ref={popupRef}
        className="pointer-events-auto absolute bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 w-72 max-h-80 flex flex-col overflow-hidden"
        style={{
          top: Math.min(y + 4, window.innerHeight - 340),
          left: Math.min(x, window.innerWidth - 300),
        }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${isToday(jy, jm, jd) ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-white'}`}>{jd}</div>
            <div>
              <p className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[jm - 1]} {jy}</p>
              <p className="text-xs text-gray-400">{meetings.length} جلسه</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={onCreateMeeting}
              title="تنظیم جلسه" aria-label="تنظیم جلسه برای این روز"
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-blue-500 transition-colors">
              <CalendarPlus className="w-4 h-4" />
            </button>
            <button type="button" onClick={onCreateAllDay}
              title="ایجاد برنامه روزانه" aria-label="ایجاد برنامه روزانه برای این روز"
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-blue-500 transition-colors">
              <Plus className="w-4 h-4" />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
          {occasions.map(o => (
            <div key={o.id} className={`px-3 py-1.5 rounded-xl text-xs font-medium ${o.is_holiday ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300' : o.is_celebration ? 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>{o.title}</div>
          ))}
          {dayEvents.map(ev => (
            <div key={ev.id} className={`px-3 py-1.5 rounded-xl text-xs font-medium flex items-center justify-between ${ev.type === 'leave' ? 'bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>
              <span>{ev.title}</span>
              <button type="button" onClick={() => onDeleteAllDay(ev.id)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
            </div>
          ))}
          {meetings.length === 0 && occasions.length === 0 && dayEvents.length === 0 && (
            <div className="text-center py-6 text-gray-400 text-xs">جلسه‌ای ندارد</div>
          )}
          {meetings.map(m => {
            const c = getMeetingColor(m);
            return (
              <button type="button" key={m.id} onClick={() => onMeetingClick(m)}
                className="w-full text-right flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold dark:text-white truncate">{m.subject}</p>
                  {m.start_time && <p className="text-[10px] text-gray-400 mt-0.5">{toFarsiTime(m.start_time)}{m.end_time ? ` – ${toFarsiTime(m.end_time)}` : ''}</p>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-3 py-2.5 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button type="button" onClick={onDayView}
            className="w-full py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition-colors">
            نمایش روزانه
          </button>
        </div>
      </div>
    </div>
  );
}

export { MonthDayPopup };
