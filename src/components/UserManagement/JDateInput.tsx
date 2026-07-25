import React, { useState, useEffect } from 'react';
import moment from 'moment-jalaali';
import { JALALI_MONTHS_ADMIN, getJMDays, isoToJ, jToIso } from './utils';

function JDateInput({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) {
  const parsed = isoToJ(value);
  const currentJYear = moment().jYear();
  const [jy, setJy] = useState(parsed.jy);
  const [jm, setJm] = useState(parsed.jm);
  const [jd, setJd] = useState(parsed.jd);

  useEffect(() => {
    const p = isoToJ(value);
    setJy(p.jy); setJm(p.jm); setJd(p.jd);
  }, [value]);

  const emit = (y: number, m: number, d: number) => onChange(jToIso(y, m, d));
  const days = jy && jm ? getJMDays(jy, jm) : 31;
  const years = Array.from({ length: 120 }, (_, i) => currentJYear - i);

  const cls = 'flex-1 py-2 px-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
  return (
    <div className="flex gap-1" dir="rtl">
      <select value={jy || ''} onChange={e => { const v = Number(e.target.value); setJy(v); emit(v, jm, jd); }} className={cls}>
        <option value="">سال</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={jm || ''} onChange={e => { const v = Number(e.target.value); setJm(v); emit(jy, v, jd); }} className={cls}>
        <option value="">ماه</option>
        {JALALI_MONTHS_ADMIN.map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
      </select>
      <select value={jd || ''} onChange={e => { const v = Number(e.target.value); setJd(v); emit(jy, jm, v); }} className={cls}>
        <option value="">روز</option>
        {Array.from({ length: days }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

export { JDateInput };
