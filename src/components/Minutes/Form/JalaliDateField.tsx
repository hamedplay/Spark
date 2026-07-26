import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';
import moment from 'moment-jalaali';

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

function isoToJalali(iso: string): string {
  if (!iso) return '';
  const m = moment(iso);
  return m.isValid() ? m.format('jYYYY/jMM/jDD') : '';
}

function jalaliToIso(jy: number, jm: number, jd: number): string {
  const m = moment(`${jy}/${jm + 1}/${jd}`, 'jYYYY/jMM/jDD');
  return m.isValid() ? m.format('YYYY-MM-DD') : '';
}

interface JalaliDateFieldProps {
  id: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function JalaliDateField({ id, value, onChange, placeholder = 'انتخاب تاریخ', disabled }: JalaliDateFieldProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const initM = value ? moment(value) : moment();
  const [viewYear, setViewYear] = useState(initM.jYear());
  const [viewMonth, setViewMonth] = useState(initM.jMonth());

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;
  const firstDow = (moment(`${viewYear}/${viewMonth + 1}/01`, 'jYYYY/jMM/jDD').day() + 1) % 7;

  const selectedJY = value ? moment(value).jYear() : null;
  const selectedJM = value ? moment(value).jMonth() : null;
  const selectedJD = value ? moment(value).jDate() : null;

  const handleDayClick = (day: number) => {
    onChange(jalaliToIso(viewYear, viewMonth, day));
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          id={id}
          readOnly
          value={isoToJalali(value)}
          onClick={() => !disabled && setOpen(o => !o)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-3 py-2.5 pl-9 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          dir="ltr"
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(''); }}
            className="absolute left-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {open && !disabled && (
        <div className="absolute z-50 top-full mt-1 right-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 p-3 w-72 shadow-xl" dir="rtl">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="font-bold text-sm dark:text-white">{JALALI_MONTHS[viewMonth]} {viewYear}</span>
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {WEEKDAYS.map(d => (
              <div key={d} className="text-center text-xs text-gray-400 dark:text-gray-500 py-1 font-medium">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const isSelected = selectedJY === viewYear && selectedJM === viewMonth && selectedJD === day;
              const isToday = moment().jYear() === viewYear && moment().jMonth() === viewMonth && moment().jDate() === day;
              return (
                <button type="button" key={day} onClick={() => handleDayClick(day)}
                  className={`h-8 w-full rounded-lg text-sm transition-colors
                    ${isSelected ? 'bg-blue-500 text-white font-bold' :
                      isToday ? 'border border-blue-400 text-blue-600 dark:text-blue-300' :
                      'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}`}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
