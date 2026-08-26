import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Calendar, X } from 'lucide-react';
import moment from 'moment-jalaali';
import {
  gregorianToJalaliDate,
  jalaliToGregorianDate,
  toEnglishDigits,
  toPersianDigits,
} from '../../../lib/minutesDate';

const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

export interface JalaliDatePickerProps {
  /** Gregorian `YYYY-MM-DD` (backend contract). Display is Jalali. */
  value: string | null;
  /** Receives a Gregorian `YYYY-MM-DD` string, or null when cleared/invalid. */
  onChange: (gregorianDate: string | null) => void;
  disabled?: boolean;
  readOnly?: boolean;
  /** Minimum selectable Gregorian `YYYY-MM-DD`; earlier dates are disabled. */
  minDate?: string | null;
  placeholder?: string;
  /** Validation message shown under the field. */
  error?: string;
  /** Optional id for the text input. */
  id?: string;
}

/**
 * Shared Jalali date picker for the Minutes module.
 *
 * Contract: `value` and `onChange` are Gregorian `YYYY-MM-DD` (the backend
 * storage format). The user sees and types a Jalali date (`YYYY/MM/DD`, Persian
 * or Latin digits, `/` or `-` separators). Typing a valid Jalali date emits the
 * corresponding Gregorian value; invalid input keeps the previous value so the
 * field is never silently corrupted. Round-tripping Gregorian → Jalali →
 * Gregorian is idempotent.
 */
export function JalaliDatePicker({
  value,
  onChange,
  disabled,
  readOnly,
  minDate,
  placeholder = 'انتخاب تاریخ',
  error,
  id,
}: JalaliDatePickerProps) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  // Sync the typed text whenever the external Gregorian value changes.
  const jalaliDisplay = useMemo(() => (value ? gregorianToJalaliDate(value) : null), [value]);

  useEffect(() => {
    setTyped(jalaliDisplay ? toPersianDigits(jalaliDisplay) : '');
  }, [jalaliDisplay]);

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

  // Re-sync the calendar view when the value changes while the picker is open.
  useEffect(() => {
    if (value) {
      const m = moment(value);
      if (m.isValid()) {
        setViewYear(m.jYear());
        setViewMonth(m.jMonth());
      }
    }
  }, [value]);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const daysInMonth = viewMonth < 6 ? 31 : viewMonth < 11 ? 30 : 29;
  const firstDow = (moment(`${viewYear}/${viewMonth + 1}/01`, 'jYYYY/jMM/jDD').day() + 1) % 7;

  const selectedJY = value ? moment(value).jYear() : null;
  const selectedJM = value ? moment(value).jMonth() : null;
  const selectedJD = value ? moment(value).jDate() : null;

  const minJalali = minDate ? gregorianToJalaliDate(minDate) : null;
  const minMoment = minJalali ? moment(minJalali, 'jYYYY/jMM/jDD') : null;

  const isDayDisabled = (gregIso: string): boolean => {
    if (!minMoment) return false;
    const dayMoment = moment(gregIso);
    return dayMoment.isBefore(minMoment, 'day');
  };

  const handleDayClick = (day: number) => {
    const m = moment(`${viewYear}/${viewMonth + 1}/${day}`, 'jYYYY/jMM/jDD');
    const greg = m.format('YYYY-MM-DD');
    if (isDayDisabled(greg)) return;
    onChange(greg);
    setOpen(false);
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setTyped(raw);
    if (!raw.trim()) {
      onChange(null);
      return;
    }
    const greg = jalaliToGregorianDate(toEnglishDigits(raw));
    if (greg) onChange(greg);
    // If invalid, keep the previous value silently — the field text still
    // reflects what the user typed, but the stored value is unchanged.
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(null);
    setTyped('');
  };

  const inputClass = [
    'w-full px-3 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white',
    error ? 'border-red-400 dark:border-red-500' : 'border-gray-200 dark:border-gray-600',
    disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
    value && !disabled && !readOnly ? 'pl-16' : 'pl-9',
  ].join(' ');

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <input
          id={id}
          type="text"
          value={typed}
          onChange={handleTyping}
          onClick={() => !disabled && !readOnly && setOpen(o => !o)}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          className={inputClass}
          dir="ltr"
          inputMode="numeric"
        />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-0" />
        {value && !disabled && !readOnly && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute left-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-400 z-10"
            aria-label="پاک کردن تاریخ"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {error && (
        <p className="mt-1 text-xs text-red-500 dark:text-red-400">{error}</p>
      )}

      {open && !disabled && !readOnly && (
        <div className="absolute z-50 top-full mt-1 right-0 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 p-3 w-72 max-w-[calc(100vw-2rem)] shadow-xl" dir="rtl">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
              <ChevronRight className="w-4 h-4" />
            </button>
            <span className="font-bold text-sm dark:text-white">{JALALI_MONTHS[viewMonth]} {toPersianDigits(String(viewYear))}</span>
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
              const gregIso = moment(`${viewYear}/${viewMonth + 1}/${day}`, 'jYYYY/jMM/jDD').format('YYYY-MM-DD');
              const dayDisabled = isDayDisabled(gregIso);
              return (
                <button
                  type="button"
                  key={day}
                  onClick={() => handleDayClick(day)}
                  disabled={dayDisabled}
                  className={`h-8 w-full rounded-lg text-sm transition-colors
                    ${isSelected ? 'bg-blue-500 text-white font-bold' :
                      isToday ? 'border border-blue-400 text-blue-600 dark:text-blue-300' :
                      'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'}
                    ${dayDisabled ? 'opacity-30 cursor-not-allowed line-through' : ''}`}
                >
                  {toPersianDigits(String(day))}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
