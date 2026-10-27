import React from 'react';
import { minutesToTime, toFarsiDigits } from './utils';

export function DragSelectionLabel({ startSlot, endSlot }: { startSlot: number; endSlot: number }) {
  const start = Math.min(startSlot, endSlot) * 30;
  const end = (Math.max(startSlot, endSlot) + 1) * 30;
  const hours = Math.floor((end - start) / 60);
  const minutes = (end - start) % 60;
  const duration = [hours && `${toFarsiDigits(hours)} ساعت`, minutes && `${toFarsiDigits(minutes)} دقیقه`].filter(Boolean).join(' و ');
  return (
    <div className="relative z-30 w-max max-w-none rounded bg-violet-100 px-1 py-0.5 text-[10px] font-bold leading-tight text-violet-900 shadow-sm dark:bg-violet-950 dark:text-violet-100" dir="rtl" role="status">
      <div className="whitespace-nowrap" dir="ltr">{toFarsiDigits(minutesToTime(start))} – {toFarsiDigits(minutesToTime(end))}</div>
      <div className="whitespace-nowrap">{duration}</div>
    </div>
  );
}
