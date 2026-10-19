import { lazy, Suspense, useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { usePermissions } from '../../context/PermissionsContext';
import { ADMIN_MINUTES_STATUSES } from './AdminMinutesControls';
import type { MinutesStatus } from './types';
const MinutesFormPage = lazy(() => import('./MinutesFormPage').then(m => ({ default: m.MinutesFormPage })));
type MinuteRow = { id: string; meeting_title_snapshot: string; meeting_date_snapshot: string; status: string };
const PAGE_SIZE = 25;

export function AdminMinutesPanel() {
  const { isAdmin } = usePermissions();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [rows, setRows] = useState<MinuteRow[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!isAdmin || !open || editing) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      let query = supabase.from('minutes').select('id,meeting_title_snapshot,meeting_date_snapshot,status')
        .order('updated_at', { ascending: false }).order('id').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      if (search.trim()) query = query.ilike('meeting_title_snapshot', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`);
      void query.then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) { setError('بارگذاری اسناد ناموفق بود. دوباره تلاش کنید.'); setRows([]); }
        else { setRows((data ?? []).slice(0, PAGE_SIZE)); setHasMore((data?.length ?? 0) > PAGE_SIZE); }
        setLoading(false);
      });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [isAdmin, open, editing, search, page, refresh]);
  if (!isAdmin) return null;
  return <section className="rounded-2xl border border-blue-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-5 space-y-4" dir="rtl">
    <button type="button" className="font-bold text-blue-700 dark:text-blue-300" onClick={() => setOpen(v => !v)} aria-expanded={open}>مدیریت و اصلاح صورت‌جلسات و مصوبات</button>
    {open && (editing ? <>
      <button type="button" className="text-sm text-blue-600" onClick={() => setEditing(null)}>بازگشت به فهرست اسناد</button>
      <Suspense fallback={<p>در حال بارگذاری فرم...</p>}>
        <MinutesFormPage key={editing} mode="edit" minuteId={editing} adminCorrection onNavigate={() => { setEditing(null); setRefresh(v => v + 1); }} />
      </Suspense>
    </> : <>
      <p className="text-sm text-gray-500 dark:text-gray-300">ویرایش تمام بخش‌های سند و وضعیت مصوبات، شامل اسناد تأییدشده و منتشرشده، با ثبت دلیل اصلاح.</p>
      <label className="block text-sm dark:text-gray-200">جستجوی عنوان صورت‌جلسه
        <input className="w-full mt-1 rounded-xl border dark:border-gray-600 p-2 bg-transparent" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
      </label>
      {loading ? <p role="status">در حال بارگذاری...</p> : error ? <p role="alert" className="text-red-600">{error}</p> : <div className="divide-y dark:divide-gray-700">
        {rows.map(row => <div key={row.id} className="flex items-center justify-between gap-3 py-3">
          <div className="min-w-0 dark:text-gray-200"><p className="font-medium truncate">{row.meeting_title_snapshot}</p>
            <small>{row.meeting_date_snapshot} · {ADMIN_MINUTES_STATUSES[row.status as MinutesStatus] ?? row.status}</small></div>
          <button type="button" className="px-3 py-2 rounded-xl bg-blue-600 text-white text-sm shrink-0" onClick={() => setEditing(row.id)}>اصلاح مدیریتی</button>
        </div>)}
        {!rows.length && <p className="py-4 text-sm text-gray-500">صورت‌جلسه‌ای پیدا نشد.</p>}
      </div>}
      <div className="flex gap-3 text-sm dark:text-gray-200">
        <button type="button" disabled={loading || page === 0} onClick={() => setPage(v => v - 1)}>قبلی</button>
        <span>صفحه {page + 1}</span>
        <button type="button" disabled={loading || !hasMore} onClick={() => setPage(v => v + 1)}>بعدی</button>
        <button type="button" disabled={loading} onClick={() => setRefresh(v => v + 1)}>بازآوری</button>
      </div>
    </>)}
  </section>;
}
