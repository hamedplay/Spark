import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatJalaliTimestamp } from '../../lib/minutesDate';

type Details = {
  creator_name?: string | null; sender_name?: string | null; reminder_creator_name?: string | null;
  created_at?: string; note_created_at?: string; remind_at?: string | null;
  recipient_name?: string; recipients?: { id: string; name: string }[];
};
export function NoteMessageDetails({ noteId, snapshot, revision }: { noteId?: string; snapshot?: Details; revision?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Details | null>(snapshot ?? null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open || !noteId || snapshot) return;
    let active = true;
    setData(null); setError(false);
    supabase.rpc('get_note_message_details', { p_note_id: noteId }).then(({ data, error }) => {
      if (active) { setData(error ? null : data as Details); setError(Boolean(error)); }
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [open, noteId, snapshot, revision]);
  const details = snapshot ?? data;
  return <details className="mt-2 text-[11px] leading-6 text-slate-500 dark:text-slate-400"
    onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer">جزئیات یادداشت و گیرندگان</summary>
    {error ? <p role="alert">جزئیات یادداشت دریافت نشد؛ دوباره باز کنید.</p> : !details ? <p>در حال دریافت...</p> :
      <dl className="mt-1 space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
        <div><dt className="inline font-bold">ایجادکننده / فرستنده: </dt><dd className="inline">{details.creator_name || details.sender_name || 'برای این یادداشت قدیمی ثبت نشده است'}</dd></div>
        {details.remind_at && <div><dt className="inline font-bold">ایجادکننده یادآوری: </dt><dd className="inline">{details.reminder_creator_name || details.sender_name}</dd></div>}
        <div><dt className="inline font-bold">گیرنده: </dt><dd className="inline">{details.recipients?.map(user => user.name).join('، ') || details.recipient_name || 'ثبت نشده'}</dd></div>
        <div><dt className="inline font-bold">تاریخ ثبت: </dt><dd className="inline">{formatJalaliTimestamp(details.note_created_at || details.created_at) || '—'}</dd></div>
        {details.remind_at && <div><dt className="inline font-bold">زمان یادآوری (تهران): </dt><dd className="inline">{formatJalaliTimestamp(details.remind_at)}</dd></div>}
      </dl>}
  </details>;
}
