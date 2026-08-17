import { useState } from 'react';
import { X, CalendarDays } from 'lucide-react';
import moment from 'moment-jalaali';

export function JumpToDatePicker({
  initial,
  onConfirm,
  onClose,
}: {
  initial: { jy: number; jm: number; jd: number };
  onConfirm: (jy: number, jm: number, jd: number) => void;
  onClose: () => void;
}) {
  const [jy, setJy] = useState(initial.jy);
  const [jm, setJm] = useState(initial.jm);
  const [jd, setJd] = useState(initial.jd);

  const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const daysInMonth = jm <= 6 ? 31 : jm <= 11 ? 30 : (moment.jIsLeapYear(jy) ? 30 : 29);
  const years = Array.from({ length: 10 }, (_, i) => initial.jy - 5 + i);

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 w-72"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900 dark:text-white text-sm flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            رفتن به تاریخ
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mb-4">
          <select
            value={jy}
            onChange={e => setJy(Number(e.target.value))}
            className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={jm}
            onChange={e => setJm(Number(e.target.value))}
            className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {MONTHS.map((name, i) => <option key={i+1} value={i+1}>{name}</option>)}
          </select>
          <select
            value={jd}
            onChange={e => setJd(Number(e.target.value))}
            className="w-16 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {Array.from({ length: daysInMonth }, (_, i) => i+1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button
          onClick={() => onConfirm(jy, jm, jd)}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm py-2 rounded-xl transition-colors"
        >
          رفتن به این تاریخ
        </button>
      </div>
    </div>
  );
}
