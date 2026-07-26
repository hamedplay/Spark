import { useState, useEffect } from 'react';
import { getJalaaliMonthDays, isoToJalali, jalaliToIso } from './utils';
import { JALAALI_MONTHS_FA } from './types';
import moment from 'moment-jalaali';

export function JalaaliDateInput({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  const parsed = isoToJalali(value);
  const currentJYear = moment().jYear();
  const [jy, setJy] = useState(parsed?.jy ?? 0);
  const [jm, setJm] = useState(parsed?.jm ?? 0);
  const [jd, setJd] = useState(parsed?.jd ?? 0);

  useEffect(() => {
    const p = isoToJalali(value);
    if (p) { setJy(p.jy); setJm(p.jm); setJd(p.jd); }
    else { setJy(0); setJm(0); setJd(0); }
  }, [value]);

  const handleChange = (newJy: number, newJm: number, newJd: number) => {
    if (!newJy || !newJm || !newJd) { onChange(''); return; }
    const iso = jalaliToIso(newJy, newJm, newJd);
    onChange(iso);
  };

  const daysInMonth = jy && jm ? getJalaaliMonthDays(jy, jm) : 31;
  const years = Array.from({ length: 120 }, (_, i) => currentJYear - i);

  return (
    <div className={`flex gap-1 ${className || ''}`} dir="rtl">
      <select
        value={jy || ''}
        onChange={e => { const v = Number(e.target.value); setJy(v); handleChange(v, jm, jd); }}
        className="flex-1 py-2.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <option value="">سال</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        value={jm || ''}
        onChange={e => { const v = Number(e.target.value); setJm(v); handleChange(jy, v, jd); }}
        className="flex-1 py-2.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <option value="">ماه</option>
        {JALAALI_MONTHS_FA.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
      </select>
      <select
        value={jd || ''}
        onChange={e => { const v = Number(e.target.value); setJd(v); handleChange(jy, jm, v); }}
        className="flex-1 py-2.5 px-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      >
        <option value="">روز</option>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}
