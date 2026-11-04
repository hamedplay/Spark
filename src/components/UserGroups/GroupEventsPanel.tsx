import { useState, useEffect, useCallback, useRef } from 'react';
import { Activity, Search, RefreshCw, Shield, Download, Loader as Loader2, X, ChevronLeft } from 'lucide-react';
import { useLiveData, LIVE_DATA } from '../../shared/realtime/useLiveData';
import { usePermissions } from '../../context/PermissionsContext';
import { supabase } from '../../lib/supabase';
import { type CenterEvent, type EventCursor, type EventPage, type EventCenterSummary, parseEventCenterSummary, severityLabels, resultLabels, isAttentionEvent, changedFields, exportEvents, eventTitle, isEventCenterSchemaMissing, eventCenterErrorMessage } from './eventCenterModel';

import { categoryTitle, eventSourceTitle, eventResultTitle, fieldTitle, formatEventValue, metadataRows, eventSummary } from './eventCenterPresentation';
import { eventClientContext } from './eventClientContext';
import { EventConnectionDetails } from './EventConnectionDetails';

const field = 'w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm disabled:opacity-40 hover:bg-gray-100 dark:hover:bg-gray-700';
const stamp = (value: string) => new Date(value).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
const dateValue = (daysAgo: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - daysAgo * 86400000));

export function GroupEventsPanel() {
  const { isAdmin } = usePermissions();
  const [events, setEvents] = useState<CenterEvent[]>([]);
  const [summary, setSummary] = useState<EventCenterSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [showPurge, setShowPurge] = useState(false);
  const [purgeConfirmation, setPurgeConfirmation] = useState('');
  const [purging, setPurging] = useState(false);
  const [purgeError, setPurgeError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CenterEvent | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('');
  const [severity, setSeverity] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState(() => dateValue(7));
  const [to, setTo] = useState(() => dateValue(0));
  const [cursor, setCursor] = useState<EventCursor | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadedAt, setLoadedAt] = useState('');
  const sequence = useRef(0);
  const schemaMissing = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const purgeDialog = useRef<HTMLDialogElement>(null);
  const filtersKey = JSON.stringify([query, source, severity, result, from, to]);
  const activeFilters = useRef(filtersKey);
  activeFilters.current = filtersKey;

  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 350); return () => clearTimeout(timer); }, [search]);

  const loadSummary = useCallback(async () => {
    try {
      const { data, error: statsError } = await supabase.rpc('get_event_center_summary_v1' as never);
      if (statsError) throw statsError;
      const parsed = parseEventCenterSummary(data);
      if (!parsed) throw new Error('INVALID_EVENT_CENTER_SUMMARY');
      setSummary(parsed);
      setSummaryError('');
    } catch {
      setSummary(null);
      setSummaryError('دریافت آمار کل تاریخچه ناموفق بود؛ نسخه دیتابیس مرکز رخدادها را بررسی کنید.');
    }
  }, []);

  const load = useCallback(async (before: EventCursor | null = null, quiet = false) => {
    const request = ++sequence.current;
    const requestFilters = filtersKey;
    if (!quiet) setLoading(true);
    setError('');
    try {
      if (!from || !to || from > to) throw new Error('بازهٔ زمانی معتبر انتخاب کنید.');
      if ((Date.parse(to) - Date.parse(from)) / 86400000 > 92) throw new Error('حداکثر بازهٔ بررسی ۹۳ روز است.');
      const { data, error: rpcError } = await supabase.rpc('get_event_center_v1' as never, {
        p_from: new Date(`${from}T00:00:00+03:30`).toISOString(),
        p_to: new Date(`${to}T23:59:59.999+03:30`).toISOString(),
        p_source: source || null, p_severity: severity || null, p_result: result || null,
        p_search: query || null, p_before_time: before?.time ?? null, p_before_key: before?.key ?? null, p_limit: 50,
      } as never);
      if (request !== sequence.current || requestFilters !== activeFilters.current) return;
      schemaMissing.current = isEventCenterSchemaMissing(rpcError);
      if (rpcError) throw new Error(eventCenterErrorMessage(rpcError));
      if (request !== sequence.current || requestFilters !== activeFilters.current) return;
      const page = data as unknown as EventPage;
      if (!page || !Array.isArray(page.events)) throw new Error('پاسخ مرکز رخدادها معتبر نیست.');
      setEvents(previous => before ? [...previous, ...page.events.filter(row => !previous.some(old => old.event_key === row.event_key))] : page.events);
      setCursor(page.next_cursor); setHasMore(page.has_more); setLoadedAt(new Date().toISOString());
    } catch (failure) {
      if (request === sequence.current && requestFilters === activeFilters.current) {
        setError(failure instanceof Error ? failure.message : 'دریافت رخدادها ناموفق بود.');
        if (!before) { setEvents([]); setCursor(null); setHasMore(false); }
      }
    } finally { if (request === sequence.current) setLoading(false); }
  }, [filtersKey, query, source, severity, result, from, to]);

  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => {
    if (showPurge && !purgeDialog.current?.open) purgeDialog.current?.showModal();
    else if (!showPurge && purgeDialog.current?.open) purgeDialog.current?.close();
  }, [showPurge]);
  // Keep the investigation stable while an event is open or older pages are loaded.
  useLiveData(LIVE_DATA.audit, async () => { if (!schemaMissing.current && !selected && !loading && events.length <= 50) await Promise.all([load(null, true), loadSummary()]); });
  useEffect(() => {
    if (selected) dialog.current?.showModal();
    else dialog.current?.close();
  }, [selected]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!schemaMissing.current && document.visibilityState === 'visible' && !selected && !loading && events.length <= 50) void Promise.all([load(null, true), loadSummary()]);
    }, 30000);
    return () => clearInterval(timer);
  }, [selected, loading, events.length, load, loadSummary]);

  const refresh = () => { void Promise.all([load(), loadSummary()]); };
  const clearHistory = async () => {
    if (!isAdmin || purging || purgeConfirmation !== 'DELETE ALL EVENTS') return;
    if (!window.confirm('تمام رخدادهای مرکز از منابع اصلی حذف می‌شوند و قابل بازگشت نیستند. ادامه می‌دهید؟')) return;
    setPurging(true);
    setPurgeError('');
    try {
      const { error: purgeRpcError } = await supabase.rpc('purge_event_center_history_v1' as never, { p_confirmation: purgeConfirmation } as never);
      if (purgeRpcError) throw purgeRpcError;
      setShowPurge(false);
      setPurgeConfirmation('');
      setEvents([]);
      setCursor(null);
      setHasMore(false);
      await Promise.all([load(), loadSummary()]);
    } catch (cause) {
      const code = (cause as { code?: string })?.code;
      setPurgeError(code === '42501' ? 'فقط مدیر سامانه با نشست دارای دسترسی کامل می‌تواند تاریخچه را حذف کند.' : 'حذف تاریخچه ناموفق بود؛ داده‌ها را دوباره بررسی کنید.');
    } finally {
      setPurging(false);
    }
  };
  const investigate = (value: string) => { setSearch(value); setQuery(value); setSource(''); setSeverity(''); setResult(''); setSelected(null); };
  const download = () => {
    const url = URL.createObjectURL(new Blob([exportEvents(events)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `spark-events-${from}-${to}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const displayCount = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('fa-IR');
  return <section dir="rtl" className="space-y-5 text-gray-800 dark:text-gray-100">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h3 className="flex items-center gap-2 text-xl font-bold"><Shield className="h-6 w-6 text-blue-500" />مرکز بررسی رخدادها</h3>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">ردیابی فعالیت کاربران، تغییر دسترسی‌ها و تلاش‌های ردشده</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} onClick={download} disabled={!events.length || loading || !!error}><Download size={16} />خروجی موارد نمایش‌داده‌شده</button>
        <button type="button" className={button} onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} />تازه‌سازی</button>
        {isAdmin && <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/30" onClick={() => { setPurgeError(''); setPurgeConfirmation(''); setShowPurge(true); }}>حذف کل تاریخچه رخدادها</button>}
      </div>
    </div>
    <div>
      <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">آمار تمام تاریخچه موجود در منابع مرکز رخدادها؛ مستقل از بازه، جستجو، فیلترها و تعداد ردیف‌های بارگذاری‌شده</p>
      {summaryError && <p role="alert" className="mb-2 text-xs text-amber-700 dark:text-amber-300">{summaryError}</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {([
          [summary?.total_events, 'کل رخدادها'],
          [summary?.login_events, 'کل رخدادهای ورود'],
          [summary?.attention_events, 'کل موارد نیازمند توجه'],
          [summary?.denied_events, 'کل دسترسی‌های ردشده'],
          [summary?.unique_actors, 'کل کاربران دارای رخداد'],
        ] as [number | undefined, string][]).map(([value, label]) =>
          <div key={label} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4"><div className="text-2xl font-bold">{displayCount(value)}</div><div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{label}</div></div>)}
      </div>
    </div>
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <label className="mb-4 block text-sm"><span className="mb-2 flex items-center gap-2"><Search size={15} />جستجو در تمام رخدادهای بازه</span>
        <input className={field} maxLength={200} value={search} onChange={e => setSearch(e.target.value)} placeholder="نام کاربر، شناسهٔ درخواست، IP، نوع رخداد یا کد خطا" /></label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs">از تاریخ (تهران)<input type="date" className={`${field} mt-2`} value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="text-xs">تا تاریخ (تهران)<input type="date" className={`${field} mt-2`} value={to} onChange={e => setTo(e.target.value)} /></label>
        <label className="text-xs">منبع<select className={`${field} mt-2`} value={source} onChange={e => setSource(e.target.value)}><option value="">همه منابع</option><option value="security">امنیتی و احراز هویت</option><option value="application">گزارش فعالیت برنامه</option></select></label>
        <label className="text-xs">شدت<select className={`${field} mt-2`} value={severity} onChange={e => setSeverity(e.target.value)}><option value="">همه سطوح</option>{Object.entries(severityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label className="text-xs">نتیجه<select className={`${field} mt-2`} value={result} onChange={e => setResult(e.target.value)}><option value="">همه نتایج</option>{Object.entries(resultLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">گزارش فعالیت برنامه می‌تواند از مرورگر ارسال شده باشد؛ به‌تنهایی اثبات اجرای عملیات نیست. IP و شناسه‌های خالی به معنی ثبت‌نشدن آن‌هاست.</p>
    </div>
    <details className="rounded-2xl border border-gray-200 p-4 text-sm dark:border-gray-700">
      <summary className="cursor-pointer font-semibold">پوشش پایش و سناریوهای بررسی</summary>
      <ul className="mt-3 list-inside list-disc space-y-2 text-xs leading-6 text-gray-600 dark:text-gray-300">
        <li>ورود، خروج و عملیات ثبت‌شدهٔ سرویس احراز هویت: نمایش از منبع اصلی ثبت؛ تازه‌سازی توکن به‌عنوان ورود جدید شمرده نمی‌شود.</li>
        <li>تغییر نقش مدیر، مدیر امنیت، وضعیت حساب، قفل و روش MFA: ثبت خودکار دیتابیس با مقادیر قبل و بعد.</li>
        <li>تغییر مجوز گروه، ساخت یا حذف گروه و جابه‌جایی اعضا: ثبت خودکار دیتابیس.</li>
        <li>نشست محدود در توابع دارای کنترل مشترک دسترسی؛ تلاش بدون مجوز برای مدیریت کاربر، حذف/بازنشستگی، بکاپ و بازیابی: ثبت سمت سرور پس از انتشار توابع جدید.</li>
        <li>تکرار رد دسترسی در ۳۰ ثانیه: ثبت تعداد و زمان آخرین تلاش در جزئیات. شدت هشدار به‌تنهایی اثبات حمله نیست.</li>
        <li>رخدادهای موجود تنظیمات امنیت، بازیابی حساب و MFA در همین فهرست قابل بررسی‌اند؛ نمایش فقط در صورت ثبت توسط تولیدکنندهٔ مربوط است.</li>
        <li>پوشش کامل درخواست‌های ردشدهٔ REST/RLS، حملات ناشناس و اسکن HTTP به اتصال لاگ پراکسی/WAF و دیتابیس نیاز دارد؛ این مرکز فعلاً آن ورودی‌ها را ندارد.</li>
      </ul>
      <p className="mt-3 text-xs text-gray-500">دریافت خودکار هر ۳۰ ثانیه در صفحهٔ فعال؛ هنگام بررسی جزئیات یا بارگذاری بیش از ۵۰ مورد متوقف می‌شود. سیاست نگهداری سرور در این بخش تغییر نمی‌کند.</p>
    </details>
    {error && <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-700">{error}<button className="mr-3 underline" onClick={() => void load()}>تلاش دوباره</button></div>}
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <div className="overflow-x-auto"><table className="block w-full text-right text-sm md:table md:min-w-[1000px]"><thead className="hidden md:table-header-group bg-gray-50 dark:bg-gray-900 text-xs text-gray-500 dark:text-gray-400"><tr>{['زمان / شدت', 'رخداد / منبع', 'عامل', 'اتصال / دستگاه', 'نتیجه', 'بررسی'].map(title => <th key={title} scope="col" className="px-4 py-3">{title}</th>)}</tr></thead>
        <tbody className="block md:table-row-group divide-y divide-gray-100 dark:divide-gray-700">{events.map(event => { const context = eventClientContext(event); const device = context.current.userAgent ? context.current : context.session; return <tr key={event.event_key} className="grid grid-cols-2 md:table-row hover:bg-gray-50 dark:hover:bg-gray-700/40">
          <td className="px-4 py-4 text-xs"><div>{stamp(event.created_at)}</div><span className={`mt-1 inline-block rounded-full px-2 py-1 ${['error', 'critical'].includes(event.severity) ? 'bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200' : isAttentionEvent(event) ? 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'}`}>{severityLabels[event.severity] ?? event.severity}</span></td>
          <td className="max-w-xs px-4 py-4"><div dir="auto" className="break-words font-medium">{eventTitle(event.event_type)}</div><div dir="auto" className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{eventSummary(event)}</div><div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{eventSourceTitle(event)} · {categoryTitle(event.category)}</div></td>
          <td className="max-w-[200px] px-4 py-4"><div>{event.actor_name || (event.actor_user_id ? 'کاربر بدون نام' : 'عامل ثبت نشده')}</div><div dir="ltr" className="mt-1 break-all font-mono text-xs text-gray-400">{event.actor_user_id || '—'}</div></td>
          <td className="max-w-[220px] px-4 py-4 text-xs"><div dir={context.current.ip ? 'ltr' : 'rtl'} className="break-all font-mono">{context.current.ip || 'IP ثبت نشده'}</div><div className="mt-1">{device ? `${device.platform} · ${device.browser}` : 'دستگاه ثبت نشده'}</div>{!context.current.userAgent && context.session && <div className="mt-1 text-gray-500 dark:text-gray-400">مشخصات نشست مرتبط</div>}</td>
          <td className="px-4 py-4 text-xs">{eventResultTitle(event)}{event.error_code && <div dir="ltr" className="mt-1 max-w-48 break-all font-mono text-red-500">{event.error_code}</div>}</td>
          <td className="col-span-2 px-4 py-4 md:table-cell"><button className={button} aria-label={`جزئیات ${eventTitle(event.event_type)}`} onClick={() => setSelected(event)}>جزئیات<ChevronLeft size={14} /></button></td>
        </tr>; })}</tbody></table></div>
      {loading && <div role="status" className="flex items-center justify-center gap-2 p-6"><Loader2 className="animate-spin" size={20} />در حال دریافت رخدادها…</div>}
      {!loading && !error && !events.length && <div className="p-12 text-center text-gray-500"><Activity className="mx-auto mb-3" />رخدادی در این بازه و فیلتر یافت نشد.</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 dark:border-gray-700 p-4 text-xs text-gray-500 dark:text-gray-400"><span>نمایش {events.length} رخداد{loadedAt && ` · آخرین دریافت ${stamp(loadedAt)}`}</span>
        {hasMore && <button className={button} disabled={loading || !!error} onClick={() => void load(cursor)}>۵۰ رخداد قدیمی‌تر</button>}</div>
    </div>
    <dialog ref={dialog} onCancel={() => setSelected(null)} onClose={() => setSelected(null)} className="m-auto w-[min(900px,95vw)] max-h-[90vh] overflow-y-auto rounded-2xl bg-[#ffffff] p-0 text-gray-800 shadow-2xl backdrop:bg-black/50 dark:bg-[#0b1424] dark:text-gray-100" dir="rtl" aria-labelledby="event-detail-title">
      {selected && <><div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-[#ffffff] p-5 dark:border-gray-700 dark:bg-[#0b1424]"><h4 id="event-detail-title" className="font-bold">جزئیات رخداد</h4><button className={button} aria-label="بستن جزئیات" onClick={() => setSelected(null)} autoFocus><X size={18} /></button></div>
        <div className="space-y-5 p-5"><dl className="grid gap-3 sm:grid-cols-2">{Object.entries({ 'نوع رخداد': eventTitle(selected.event_type), 'کد فنی رخداد': selected.event_type, 'دسته': categoryTitle(selected.category), 'زمان': stamp(selected.created_at), 'منبع': eventSourceTitle(selected), 'شدت': severityLabels[selected.severity], 'عامل': selected.actor_name, 'شناسه عامل': selected.actor_user_id, 'کاربر هدف': selected.target_user_id, 'نتیجه': eventResultTitle(selected), 'کد خطا': selected.error_code, 'شناسه درخواست': selected.request_id, 'شناسه نشست': selected.session_id, 'هش IP': selected.ip_hash, 'شناسه رخداد': selected.id }).map(([label, value]) => <div key={label} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800"><dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt><dd dir="auto" className="mt-1 break-all text-sm">{value || 'ثبت نشده'}</dd></div>)}</dl>
          <EventConnectionDetails event={selected} />
          <div className="flex flex-wrap gap-2">
            {selected.actor_user_id && <button className={button} onClick={() => investigate(selected.actor_user_id!)}>رخدادهای این عامل در بازه</button>}
            {selected.request_id && <button className={button} onClick={() => investigate(selected.request_id!)}>همبستگی با شناسه درخواست</button>}
            {selected.session_id && <button className={button} onClick={() => investigate(selected.session_id!)}>رخدادهای این نشست در بازه</button>}
          </div>
          {!!changedFields(selected).length && <div><h5 className="mb-2 font-semibold">تغییرات ثبت‌شده</h5><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{['فیلد', 'قبل', 'بعد'].map(label => <th key={label} className="p-2 text-right">{label}</th>)}</tr></thead><tbody>{changedFields(selected).map(change => <tr key={change.key} className="border-t border-gray-200 dark:border-gray-700"><td className="p-2" title={change.key}>{fieldTitle(change.key)}</td><td className="p-2"><pre dir="auto" className="max-w-xs whitespace-pre-wrap break-all text-xs">{formatEventValue(change.key, change.before)}</pre></td><td className="p-2"><pre dir="auto" className="max-w-xs whitespace-pre-wrap break-all text-xs">{formatEventValue(change.key, change.after)}</pre></td></tr>)}</tbody></table></div></div>}
          <div><h5 className="mb-2 font-semibold">زمینه و جزئیات</h5><dl className="grid gap-3 sm:grid-cols-2">{metadataRows(selected).filter(row => !['session_context', 'session_device', 'user_agent', 'ip_source'].includes(row.key)).map(row => <div key={row.key} className="rounded-xl bg-gray-50 p-3 dark:bg-gray-800"><dt title={row.key} className="text-xs text-gray-500 dark:text-gray-400">{row.label}</dt><dd dir="auto" className="mt-1 whitespace-pre-wrap break-all text-sm">{row.value}</dd></div>)}</dl></div>
          {selected.metadata?.source === 'auth_service' && <p className="rounded-xl bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">این رخداد در سرویس احراز هویت ثبت شده است؛ به‌تنهایی تأیید عبور از مراحل دومرحله‌ای یا داشتن دسترسی کامل Spark نیست.</p>}
          <details><summary className="cursor-pointer text-sm font-medium">دادهٔ فنی اصلی (برای عیب‌یابی)</summary><pre dir="ltr" className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-gray-50 p-4 text-xs dark:bg-gray-800">{JSON.stringify(selected, null, 2)}</pre></details>
          <p className="text-xs text-gray-500 dark:text-gray-400">فقط رخدادهای موجود در منابع ثبت نمایش داده می‌شوند؛ اطلاعات ثبت‌نشده بازسازی نمی‌شود. نمایش این مرکز مجوز حذف شواهد نمی‌دهد.</p>
        </div></>}
    </dialog>
    <dialog ref={purgeDialog} onCancel={event => { if (purging) event.preventDefault(); else setShowPurge(false); }} onClose={() => { if (!purging) setShowPurge(false); }}
      className="m-auto w-[min(520px,94vw)] rounded-2xl bg-white p-5 text-gray-800 shadow-2xl backdrop:bg-black/60 dark:bg-slate-900 dark:text-gray-100" dir="rtl" aria-labelledby="purge-events-title">
      <h4 id="purge-events-title" className="text-lg font-bold text-red-700 dark:text-red-300">حذف غیرقابل‌بازگشت کل تاریخچه رخدادها</h4>
      <p className="mt-3 text-sm leading-7">تمام رخدادهای ثبت‌شدهٔ برنامه، رخدادهای امنیتی، رخدادهای احراز هویت نمایش‌داده‌شده در این مرکز و رکوردهای مشاهدهٔ نشست حذف می‌شوند؛ محدود به فیلتر فعلی نیست. رخدادهای جدید همچنان ثبت خواهند شد.</p>
      <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">این عملیات از منابع اصلی حذف می‌کند. پیش از آن از حفظ شواهد و سیاست نگهداری سازمان اطمینان بگیرید. رسید حذف محفوظ می‌ماند.</p>
      <label className="mt-4 block text-xs font-semibold" htmlFor="purge-events-confirm">برای تأیید عبارت DELETE ALL EVENTS را دقیق وارد کنید:</label>
      <input id="purge-events-confirm" dir="ltr" type="text" autoComplete="off" spellCheck={false} value={purgeConfirmation} onChange={event => setPurgeConfirmation(event.target.value)} disabled={purging}
        className="mt-2 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-left font-mono text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white" />
      {purgeError && <p role="alert" className="mt-3 text-xs text-red-600">{purgeError}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className={button} disabled={purging} onClick={() => setShowPurge(false)}>انصراف</button>
        <button type="button" onClick={() => void clearHistory()} disabled={purging || purgeConfirmation !== 'DELETE ALL EVENTS'}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{purging ? 'در حال حذف…' : 'حذف قطعی کل تاریخچه'}</button>
      </div>
    </dialog>
  </section>;
}
