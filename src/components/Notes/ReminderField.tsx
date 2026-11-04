import { Bell } from 'lucide-react';
import { JalaliDatePicker } from '../Minutes/Form/JalaliDatePicker';
import { quickNoteReminder, reminderDateTime } from './reminderTime';

export function ReminderField({ value, onChange, disabled = false }: {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}) {
  const parts = reminderDateTime(value);
  const update = (date: string, time: string) => {
    if (!date) { onChange(null); return; }
    const next = new Date(`${date}T${time || '09:00'}:00`);
    if (Number.isFinite(next.getTime())) onChange(next.toISOString());
  };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/25 dark:bg-amber-500/5">
      <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
        <input type="checkbox" checked={Boolean(value)} disabled={disabled}
          onChange={event => onChange(event.target.checked ? quickNoteReminder(2) : null)} />
        <Bell className="h-3.5 w-3.5" /> یادآوری
      </label>
      {value && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2">
            {[{ days: 1, label: 'فردا' }, { days: 2, label: 'دو روز بعد' }, { days: 7, label: 'یک هفته بعد' }].map(option => (
              <button key={option.days} type="button" disabled={disabled} onClick={() => onChange(quickNoteReminder(option.days))}
                className="rounded-md border border-amber-200 px-2 py-1 text-[10px] text-amber-800 dark:border-amber-500/30 dark:text-amber-200">{option.label}</button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <span className="mb-1 block text-[10px] text-slate-500">تاریخ یادآوری</span>
              <JalaliDatePicker value={parts.date || null} disabled={disabled}
                minDate={reminderDateTime(new Date().toISOString()).date}
                onChange={date => update(date || '', parts.time)} />
            </div>
            <label className="text-[10px] text-slate-500">ساعت یادآوری
              <input type="time" value={parts.time} disabled={disabled} aria-label="ساعت یادآوری" dir="ltr"
                onChange={event => { if (event.target.value) update(parts.date, event.target.value); }}
                className="mt-1 block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
            </label>
          </div>
          <p className="text-[10px] leading-5 text-slate-500">براساس ساعت دستگاه شما ({Intl.DateTimeFormat().resolvedOptions().timeZone})؛ یادآوری در اعلان‌های سایت ثبت می‌شود.</p>
        </div>
      )}
    </div>
  );
}
