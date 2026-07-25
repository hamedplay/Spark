import React, { useState, useEffect, useRef } from 'react';
import { Calendar } from 'lucide-react';
import { JalaliCalendarPicker } from './JalaliCalendarPicker';
import { toJalali } from './utils';

function JalaliDateInput({ value, onChange }: { value: Date | null; onChange: (d: Date) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <input readOnly value={value ? toJalali(value.toISOString()) : ''}
          onClick={() => setOpen(v => !v)}
          placeholder="انتخاب تاریخ و ساعت"
          className="w-full p-2 pl-9 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm cursor-pointer"
          dir="ltr" />
        <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
      </div>
      {open && (
        <div className="absolute z-50 top-full mt-1 left-0">
          <JalaliCalendarPicker
            value={value}
            onChange={(d) => { onChange(d); }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

export { JalaliDateInput };
