import { useState } from 'react';
import { Bell, UsersRound, X } from 'lucide-react';
import { JalaliDatePicker } from '../Minutes/Form/JalaliDatePicker';
import { ReminderDeliveryStatus } from './ReminderDeliveryStatus';
import { quickNoteReminder, reminderDateTime } from './reminderTime';

export interface ReminderUser { user_id: string; full_name: string | null; }
export function ReminderField({ value, onChange, disabled = false, recipientIds = [], onRecipientsChange, users = [], usersLoading = false, usersError = false, noteId, ownerId }: {
  value: string | null;
  noteId?: string;
  ownerId?: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  recipientIds?: string[];
  onRecipientsChange?: (ids: string[]) => void;
  users?: ReminderUser[];
  usersLoading?: boolean;
  usersError?: boolean;
}) {
  const [search, setSearch] = useState('');
  const parts = reminderDateTime(value);
  const update = (date: string, time: string) => {
    if (!date) { onChange(null); return; }
    const next = new Date(`${date}T${time || '09:00'}:00`);
    if (Number.isFinite(next.getTime())) onChange(next.toISOString());
  };
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/25 dark:bg-amber-500/5">
      <button type="button" disabled={disabled} aria-pressed={Boolean(value)}
        onClick={() => onChange(value ? null : quickNoteReminder(2))}
        className="inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-bold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <Bell className="h-3.5 w-3.5" />{value ? 'حذف یادآوری' : 'تعیین یادآوری'}
      </button>
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
          {onRecipientsChange && <div className="space-y-2 border-t border-amber-200/60 pt-2 dark:border-amber-500/20">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-200"><UsersRound className="h-3.5 w-3.5" />گیرندگان دیگر یادآوری</label>
            <p className="text-[10px] leading-5 text-slate-500">خود شما همیشه دریافت‌کننده هستید. عنوان و متن یادداشت برای افراد انتخاب‌شده نیز ارسال می‌شود.</p>
            <div className="flex flex-wrap gap-1.5">{recipientIds.map(id => <span key={id} className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 text-[10px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              {users.find(user => user.user_id === id)?.full_name || 'کاربر انتخاب‌شده'}
              <button type="button" disabled={disabled} aria-label={`حذف گیرنده ${users.find(user => user.user_id === id)?.full_name || id}`} onClick={() => onRecipientsChange(recipientIds.filter(value => value !== id))}><X className="h-3 w-3" /></button>
            </span>)}</div>
            <input aria-label="جستجوی گیرنده یادآوری" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} placeholder="جستجوی نام کاربر..." className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white" />
            <select aria-label="افزودن گیرنده یادآوری" value="" disabled={disabled || usersLoading || recipientIds.length >= 20} onChange={event => { if (event.target.value) onRecipientsChange([...recipientIds, event.target.value]); }} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-600 dark:bg-slate-700 dark:text-white">
              <option value="">{usersLoading ? 'در حال دریافت کاربران...' : 'افزودن کاربر (حداکثر ۲۰ نفر)'}</option>
              {users.filter(user => !recipientIds.includes(user.user_id) && (user.full_name || '').toLocaleLowerCase('fa-IR').includes(search.trim().toLocaleLowerCase('fa-IR'))).map(user => <option key={user.user_id} value={user.user_id}>{user.full_name || 'کاربر سازمان'}</option>)}
            </select>
            {usersError && <p role="alert" className="text-[10px] text-rose-600">دریافت فهرست کاربران ناموفق بود؛ فرم را دوباره باز کنید.</p>}
          </div>}
          <ReminderDeliveryStatus noteId={noteId} ownerId={ownerId} users={users} />
          <p className="text-[10px] leading-5 text-slate-500">ارسال پیامک مطابق تنظیمات گروه کاربری و سرویس پیامک انجام می‌شود؛ دریافت در بله نیاز به اتصال حساب بله دارد.</p>
          <p className="text-[10px] leading-5 text-slate-500">براساس ساعت دستگاه شما ({Intl.DateTimeFormat().resolvedOptions().timeZone})؛ یادآوری در اعلان‌های سایت ثبت می‌شود.</p>
        </div>
      )}
    </div>
  );
}
