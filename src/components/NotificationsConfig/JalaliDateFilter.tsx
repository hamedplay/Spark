import { useState, useEffect, useRef } from 'react';
import { Calendar, X } from 'lucide-react';
import moment from 'moment-jalaali';

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

/**
 * A lightweight, date-only Jalali (Persian) date picker.
 * Reuses the same moment-jalaali library used elsewhere in the project.
 * Returns a Jalali date string "jYYYY/jMM/jDD" or empty string when cleared.
 */
export function JalaliDateFilter({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ',
}: {
  value: string;
  onChange: (jalaliDate: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const now = value ? moment(value, 'jYYYY/jMM/jDD') : moment();
  const [viewYear, setViewYear] = useState(Number(now.format('jYYYY')));
  const [viewMonth, setViewMonth] = useState(Number(now.format('jMM')) - 1);

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;
  const firstDay = moment(
    `${viewYear}/${viewMonth + 1}/01`,
    'jYYYY/jMM/jDD',
  ).day();
  const offset = (firstDay + 1) % 7;

  const selectedJY = value
    ? Number(moment(value, 'jYYYY/jMM/jDD').format('jYYYY'))
    : null;
  const selectedJM = value
    ? Number(moment(value, 'jYYYY/jMM/jDD').format('jMM')) - 1
    : null;
  const selectedJD = value
    ? Number(moment(value, 'jYYYY/jMM/jDD').format('jDD'))
    : null;

  const handleDayClick = (day: number) => {
    const formatted = `${viewYear}/${String(viewMonth + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
    onChange(formatted);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input
          readOnly
          value={value}
          onClick={() => setOpen((v) => !v)}
          placeholder={placeholder}
          className="w-full text-sm px-3 py-2 pl-9 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
          dir="ltr"
        />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        {value && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange('');
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0">
          <div
            className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 p-4 w-72"
            dir="rtl"
          >
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={prevMonth}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              >
                ‹
              </button>
              <span className="font-bold text-sm dark:text-white">
                {JALALI_MONTHS[viewMonth]} {viewYear}
              </span>
              <button
                onClick={nextMonth}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              >
                ›
              </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {WEEKDAYS.map((d) => (
                <div
                  key={d}
                  className="text-center text-xs text-gray-400 dark:text-gray-500 py-1 font-medium"
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {Array.from({ length: offset }).map((_, i) => (
                <div key={`e${i}`} />
              ))}
              {Array.from(
                { length: daysInMonth },
                (_, i) => i + 1,
              ).map((day) => {
                const isSelected =
                  selectedJY === viewYear &&
                  selectedJM === viewMonth &&
                  selectedJD === day;
                const isToday =
                  Number(moment().format('jYYYY')) === viewYear &&
                  Number(moment().format('jMM')) - 1 === viewMonth &&
                  Number(moment().format('jDD')) === day;
                return (
                  <button
                    key={day}
                    onClick={() => handleDayClick(day)}
                    className={`h-8 w-full rounded-lg text-sm transition-colors ${
                      isSelected
                        ? 'bg-amber-500 text-white font-bold'
                        : isToday
                          ? 'border border-amber-400 text-amber-600 dark:text-amber-400'
                          : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
