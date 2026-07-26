import { useState } from 'react';
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react';
import moment from 'moment-jalaali';

export function toJalali(iso: string): string {
  return moment(iso).format('jYYYY/jMM/jDD HH:mm');
}

export function JalaliCalendarPicker({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const today = moment();
  const initM = value ? moment(value) : today.clone();
  const [viewYear, setViewYear] = useState(initM.jYear());
  const [viewMonth, setViewMonth] = useState(initM.jMonth());
  const [hour, setHour] = useState<number>(value ? moment(value).hour() : 9);
  const [minute, setMinute] = useState<number>(value ? moment(value).minute() : 0);

  const monthStart = moment(`${viewYear}/${viewMonth + 1}/1`, 'jYYYY/jM/jD');
  const firstDow = (monthStart.day() + 1) % 7;
  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const DAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);

  const selectedM = value ? moment(value) : null;

  const buildDate = (day: number, h: number, mn: number) =>
    moment(`${viewYear}/${viewMonth + 1}/${day}`, 'jYYYY/jM/jD').hour(h).minute(mn).second(0).toDate();

  const selectDay = (day: number) => onChange(buildDate(day, hour, minute));

  const changeTime = (h: number, mn: number) => {
    setHour(h);
    setMinute(mn);
    if (selectedM) {
      onChange(moment(value!).hour(h).minute(mn).second(0).toDate());
    }
  };

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = Array.from({ length: 60 }, (_, i) => i);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 p-3 w-full shadow-xl" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <button type="button" onClick={nextMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronRight className="w-4 h-4 text-gray-500" /></button>
        <span className="text-sm font-semibold text-gray-700 dark:text-white">{MONTHS[viewMonth]} {viewYear}</span>
        <button type="button" onClick={prevMonth} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronLeft className="w-4 h-4 text-gray-500" /></button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1">
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} />;
          const isSelected = selectedM && selectedM.jYear() === viewYear && selectedM.jMonth() === viewMonth && selectedM.jDate() === day;
          const isToday = today.jYear() === viewYear && today.jMonth() === viewMonth && today.jDate() === day;
          return (
            <button type="button" key={day} onClick={() => selectDay(day)}
              className={`text-center text-xs py-1 rounded-lg transition-colors
                ${isSelected ? 'bg-blue-500 text-white font-bold' : isToday ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-center gap-2" dir="ltr">
        <select
          value={hour}
          onChange={e => changeTime(Number(e.target.value), minute)}
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          {hours.map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}</option>)}
        </select>
        <span className="text-gray-400 font-bold">:</span>
        <select
          value={minute}
          onChange={e => changeTime(hour, Number(e.target.value))}
          className="px-2 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
        >
          {minutes.map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </select>
        <span className="text-[10px] text-gray-400 mr-1">ساعت</span>
      </div>
    </div>
  );
}

export function JalaliDateInput({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          readOnly
          value={value ? toJalali(value.toISOString()) : ''}
          onClick={() => setOpen(v => !v)}
          placeholder="انتخاب تاریخ و ساعت"
          className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm cursor-pointer"
          dir="ltr"
        />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>

      {open && (
        <div className="absolute z-50 top-full mb-1 left-0 right-0">
          <JalaliCalendarPicker value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef } from 'react';
