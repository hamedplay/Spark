import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import moment from 'moment-jalaali';

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

function JalaliCalendarPicker({ value, onChange, onClose }: {
  value: Date | null;
  onChange: (d: Date) => void;
  onClose: () => void;
}) {
  const now = value ? moment(value) : moment();
  const [viewYear, setViewYear] = useState(Number(now.format('jYYYY')));
  const [viewMonth, setViewMonth] = useState(Number(now.format('jMM')) - 1);
  const [hour, setHour] = useState(value ? value.getHours() : 0);
  const [minute, setMinute] = useState(value ? Math.floor(value.getMinutes() / 15) * 15 : 0);

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;
  const firstDay = moment(`${viewYear}/${viewMonth + 1}/01`, 'jYYYY/jMM/jDD').day();
  const offset = (firstDay + 1) % 7;

  const selectedJY = value ? Number(moment(value).format('jYYYY')) : null;
  const selectedJM = value ? Number(moment(value).format('jMM')) - 1 : null;
  const selectedJD = value ? Number(moment(value).format('jDD')) : null;

  const handleDayClick = (day: number) => {
    const m = moment(`${viewYear}/${viewMonth + 1}/${day} ${hour}:${minute}`, 'jYYYY/jMM/jDD HH:mm');
    onChange(m.toDate());
  };

  const handleConfirm = () => {
    if (value) {
      const m = moment(value);
      const updated = moment(`${Number(m.format('jYYYY'))}/${Number(m.format('jMM'))}/${Number(m.format('jDD'))} ${hour}:${minute}`, 'jYYYY/jMM/jDD HH:mm');
      onChange(updated.toDate());
    }
    onClose();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 p-4 w-72" dir="rtl">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="font-bold text-sm dark:text-white">{JALALI_MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {WEEKDAYS.map(d => (
          <div key={d} className="text-center text-xs text-gray-400 dark:text-gray-500 py-1 font-medium">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: offset }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
          const isSelected = selectedJY === viewYear && selectedJM === viewMonth && selectedJD === day;
          const isToday = Number(moment().format('jYYYY')) === viewYear &&
            Number(moment().format('jMM')) - 1 === viewMonth &&
            Number(moment().format('jDD')) === day;
          return (
            <button key={day} onClick={() => handleDayClick(day)}
              className={`h-8 w-full rounded-lg text-sm transition-colors
                ${isSelected ? 'bg-teal-500 text-white font-bold' :
                  isToday ? 'border border-teal-400 text-teal-600 dark:text-teal-400' :
                  'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
              {day}
            </button>
          );
        })}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex items-center gap-2 justify-center">
        <span className="text-xs text-gray-500 dark:text-gray-400">ساعت:</span>
        <select value={hour} onChange={e => setHour(Number(e.target.value))}
          className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 dark:bg-gray-700 dark:text-white">
          {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
        </select>
        <span className="text-gray-400">:</span>
        <select value={minute} onChange={e => setMinute(Number(e.target.value))}
          className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 dark:bg-gray-700 dark:text-white">
          {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
        </select>
      </div>

      <button onClick={handleConfirm}
        className="mt-3 w-full bg-teal-500 hover:bg-teal-600 text-white py-2 rounded-xl text-sm font-medium transition-colors">
        تایید
      </button>
    </div>
  );
}

export { JalaliCalendarPicker };
