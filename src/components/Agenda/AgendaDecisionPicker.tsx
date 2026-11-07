import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { PickerDecision } from '../../lib/linkedAgendaDecisions';
import { linkedDecisionAgendaTitle } from '../../lib/linkedAgendaDecisions';

type PickerResponse = { items: PickerDecision[]; total: number };
const PAGE_SIZE = 25;
const STATUS_OPTIONS = [
  ['','همه وضعیت‌ها'], ['not_started','شروع‌نشده'], ['planned','برنامه‌ریزی‌شده'],
  ['in_progress','در جریان'],['waiting_coordination','در انتظار هماهنگی'],
  ['waiting_approval','در انتظار تأیید'],['completed','تکمیل‌شده'],['stopped','متوقف‌شده'],
] as const;
const statusName = (status: string) => STATUS_OPTIONS.find(([key]) => key === status)?.[1] || status;

export function AgendaDecisionPicker({ existingIds, onSelect, onClose }: {
  existingIds: string[];
  onSelect: (decisions: PickerDecision[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [response, setResponse] = useState<PickerResponse>({ items: [], total: 0 });
  const [selected, setSelected] = useState<Record<string, PickerDecision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const existing = useMemo(() => new Set(existingIds), [existingIds]);
  const normalizeDigits = (v: string) => v.replace(/[۰-۹٠-٩]/g, c =>
    String('۰۱۲۳۴۵۶۷۸۹'.indexOf(c) >= 0 ? '۰۱۲۳۴۵۶۷۸۹'.indexOf(c) : '٠١٢٣٤٥٦٧٨٩'.indexOf(c)));

  useEffect(() => { setOffset(0); }, [query, status, dateFrom, dateTo]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: requestError } = await (supabase as any).rpc('pick_meeting_agenda_decisions_v1', {
          p_search: normalizeDigits(query.trim()) || null,
          p_status: status || null,
          p_owner_user_id: null,
          p_date_from: normalizeDigits(dateFrom.trim()) || null,
          p_date_to: normalizeDigits(dateTo.trim()) || null,
          p_limit: PAGE_SIZE, p_offset: offset,
        });
        if (requestError) throw requestError;
        if (!data || !Array.isArray(data.items) || typeof data.total !== 'number') throw Error('INVALID_PICKER_RESPONSE');
        if (!cancelled) setResponse(data as PickerResponse);
      } catch {
        if (!cancelled) { setError('دریافت مصوبات مجاز ناموفق بود.'); setResponse({ items: [], total: 0 }); }
      } finally { if (!cancelled) setLoading(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, status, dateFrom, dateTo, offset]);

  return createPortal(
    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/50 p-3" dir="rtl" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label="افزودن از پیگیری مصوبات" className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900">
        <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 dark:border-gray-700">
          <h3 className="font-bold text-gray-900 dark:text-white">افزودن از پیگیری مصوبات</h3>
          <button type="button" onClick={onClose} aria-label="بستن"><X className="h-5 w-5" /></button>
        </header>
        <div className="grid shrink-0 grid-cols-1 gap-2 border-b p-3 dark:border-gray-700 sm:grid-cols-4">
          <label className="relative sm:col-span-2">
            <Search className="absolute right-2 top-2.5 h-4 w-4 text-gray-400" />
            <input aria-label="جستجوی موضوع، مسئول، شماره و جلسه" value={query} onChange={e => setQuery(e.target.value)} placeholder="موضوع، شماره، عنوان جلسه، مسئول…" maxLength={180}
              className="w-full rounded-lg border p-2 pr-8 text-sm dark:border-gray-600 dark:bg-gray-800" />
          </label>
          <select aria-label="وضعیت مصوبه" value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border p-2 text-sm dark:border-gray-600 dark:bg-gray-800">
            {STATUS_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <div className="flex gap-1">
            <input aria-label="تاریخ از به شمسی" value={dateFrom} onChange={e => setDateFrom(e.target.value)} placeholder="از ۱۴۰۵/۰۸/۰۱" className="w-1/2 min-w-0 rounded-lg border p-2 text-xs dark:border-gray-600 dark:bg-gray-800" />
            <input aria-label="تاریخ تا به شمسی" value={dateTo} onChange={e => setDateTo(e.target.value)} placeholder="تا ۱۴۰۵/۰۸/۳۰" className="w-1/2 min-w-0 rounded-lg border p-2 text-xs dark:border-gray-600 dark:bg-gray-800" />
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {loading && <div role="status" className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری…</div>}
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          {!loading && !error && response.items.length === 0 && <p className="p-4 text-center text-sm text-gray-500">مصوبه‌ای مطابق فیلترها یافت نشد.</p>}
          {response.items.map(item => {
            const duplicated = existing.has(item.id);
            return <label key={item.id} className={`flex gap-3 rounded-xl border p-3 dark:border-gray-700 ${duplicated ? 'opacity-60' : 'cursor-pointer hover:border-blue-300'}`}>
              <input type="checkbox" className="mt-1 h-4 w-4" disabled={duplicated} checked={duplicated || Boolean(selected[item.id])}
                onChange={e => setSelected(previous => { const next = { ...previous }; if (e.target.checked) next[item.id] = item; else delete next[item.id]; return next; })} />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="break-words text-sm font-semibold text-gray-800 dark:text-gray-100">{item.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{item.minute_number ? `صورت‌جلسه شماره ${item.minute_number}` : item.minute_title} · {item.meeting_date || 'تاریخ نامشخص'} · {item.decision_number ? `مصوبه ${item.decision_number}` : 'بدون شماره رسمی'} {item.clause_order ? `· بند ${item.clause_order}` : ''}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">مسئول: {item.owner_name || '—'} · واحد: {item.responsible_unit_name_snapshot || '—'} · {statusName(item.status)}</p>
                {duplicated && <p className="text-xs text-amber-700">این مصوبه قبلاً به همین جلسه اضافه شده است.</p>}
                {!duplicated && <p className="line-clamp-2 text-xs text-blue-600 dark:text-blue-400">{linkedDecisionAgendaTitle(item)}</p>}
              </div>
            </label>;
          })}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t p-3 dark:border-gray-700">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>{response.total.toLocaleString('fa-IR')} نتیجه</span>
            <button type="button" disabled={offset===0 || loading} onClick={() => setOffset(Math.max(0,offset-PAGE_SIZE))}>قبلی</button>
            <button type="button" disabled={offset+PAGE_SIZE>=response.total || loading} onClick={() => setOffset(offset+PAGE_SIZE)}>بعدی</button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{Object.keys(selected).length.toLocaleString('fa-IR')} انتخاب</span>
            <button type="button" className="rounded-lg border px-3 py-2 text-sm dark:border-gray-600" onClick={onClose}>انصراف</button>
            <button type="button" disabled={Object.keys(selected).length===0} onClick={() => { onSelect(Object.values(selected).filter(item => !existing.has(item.id))); onClose(); }}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40">افزودن دستور جلسات</button>
          </div>
        </footer>
      </section>
    </div>, document.body,
  );
}
