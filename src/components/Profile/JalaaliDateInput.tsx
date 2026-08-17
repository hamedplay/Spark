import { useState, useEffect } from 'react';
import moment from 'moment-jalaali';
import { JALAALI_MONTHS_FA, getJalaaliMonthDays, isoToJalali, jalaliToIso } from './jalali';

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
  const selectClass = 'min-w-0 w-full rounded-lg border border-gray-200 bg-white px-1 py-2 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white min-[390px]:px-2 min-[390px]:text-sm';

  return (
    <div className={`grid grid-cols-3 gap-1.5 ${className || ''}`} dir="rtl">
      <select
        aria-label="سال"
        value={jy || ''}
        onChange={e => { const v = Number(e.target.value); setJy(v); handleChange(v, jm, jd); }}
        className={selectClass}
      >
        <option value="">سال</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select
        aria-label="ماه"
        value={jm || ''}
        onChange={e => { const v = Number(e.target.value); setJm(v); handleChange(jy, v, jd); }}
        className={selectClass}
      >
        <option value="">ماه</option>
        {JALAALI_MONTHS_FA.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
      </select>
      <select
        aria-label="روز"
        value={jd || ''}
        onChange={e => { const v = Number(e.target.value); setJd(v); handleChange(jy, jm, v); }}
        className={selectClass}
      >
        <option value="">روز</option>
        {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}
