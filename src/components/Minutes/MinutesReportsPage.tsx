import { useState, useCallback } from 'react';
import { Search, FileDown, Play, X, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react';
import { PageHeader, TableSkeleton, MinutesStatusBadge, DecisionStatusBadge, DecisionPriorityBadge, ProgressIndicator } from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl } from '../../lib/minutesNavigation';
import { formatJalaliDateForDisplay, formatJalaliTimestamp } from '../../lib/minutesDate';
import { JalaliDatePicker } from './Form/JalaliDatePicker';

type ReportType = 'minutes' | 'decisions';

interface Props {
  onNavigate: (page: string) => void;
}

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'minutes', label: 'گزارش صورت‌جلسات' },
  { value: 'decisions', label: 'گزارش مصوبات' },
];

interface MinuteReportRow {
  id: string; meeting_title: string; meeting_date: string; org_unit: string | null;
  secretary: string; chair: string; status: string; approval_mode: string | null;
  confidentiality: string; revision_number: number; decision_count: number;
  published_at: string | null;
}
interface DecisionReportRow {
  id: string; title: string; minute_id: string; minute_title: string;
  owner_user_id: string; unit: string | null; priority: string; status: string;
  progress: number; due_date: string | null; overdue: boolean; latest_update: string | null;
}

const PAGE_SIZE = 25;

export function MinutesReportsPage({ onNavigate }: Props) {
  const [reportType, setReportType] = useState<ReportType>('minutes');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  const [confidentiality, setConfidentiality] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [hasDecisions, setHasDecisions] = useState<string>(''); // '' | 'yes' | 'no'
  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [rows, setRows] = useState<MinuteReportRow[] | DecisionReportRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  const buildFilters = useCallback(() => {
    const f: Record<string, unknown> = {};
    if (dateFrom) f.date_from = dateFrom;
    if (dateTo) f.date_to = dateTo;
    if (status) f.status = status;
    if (priority) f.priority = priority;
    if (confidentiality) f.confidentiality = confidentiality;
    if (overdueOnly) f.overdue = true;
    if (hasDecisions === 'yes') f.has_decisions = true;
    if (hasDecisions === 'no') f.has_decisions = false;
    return f;
  }, [dateFrom, dateTo, status, priority, confidentiality, overdueOnly, hasDecisions]);

  const runReport = useCallback(async (p: number) => {
    setRunning(true); setError(null);
    try {
      const rpc = reportType === 'minutes' ? 'search_minutes_report' : 'search_decisions_report';
      const { data, error: rpcErr } = await supabase.rpc(rpc, {
        p_filters: buildFilters(),
        p_limit: PAGE_SIZE,
        p_offset: p * PAGE_SIZE,
      });
      if (rpcErr) throw new Error(rpcErr.message);
      const result = data as { rows: unknown[]; total_count: number };
      setRows(result.rows as MinuteReportRow[] | DecisionReportRow[]);
      setTotalCount(result.total_count);
      setRan(true);
      setPage(p);
      setMobileFiltersOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'اجرای گزارش ناموفق بود.');
      setRows([]);
      setTotalCount(0);
    } finally {
      setRunning(false);
    }
  }, [reportType, buildFilters]);

  const clearFilters = () => {
    setDateFrom(''); setDateTo(''); setStatus(''); setPriority('');
    setConfidentiality(''); setOverdueOnly(false); setHasDecisions('');
    setRan(false); setRows([]); setTotalCount(0);
  };

  const exportCsv = () => {
    const BOM = '\uFEFF';
    let headers: string[] = [];
    let csvRows: string[][] = [];
    if (reportType === 'minutes') {
      headers = ['عنوان جلسه','تاریخ','واحد','دبیر','رئیس','وضعیت','مد تأیید','نسخه','تعداد مصوبات','تاریخ انتشار'];
      csvRows = (rows as MinuteReportRow[]).map(r => [
        r.meeting_title, r.meeting_date || '', r.org_unit || '', r.secretary, r.chair,
        r.status, r.approval_mode || '', String(r.revision_number), String(r.decision_count),
        r.published_at ? new Date(r.published_at).toLocaleDateString('fa-IR') : '',
      ]);
    } else {
      headers = ['عنوان مصوبه','صورت‌جلسه','واحد','اولویت','وضعیت','پیشرفت','مهلت','عقب‌افتاده','آخرین به‌روزرسانی'];
      csvRows = (rows as DecisionReportRow[]).map(r => [
        r.title, r.minute_title, r.unit || '', r.priority, r.status, String(r.progress),
        r.due_date || '', r.overdue ? 'بله' : 'خیر', r.latest_update || '',
      ]);
    }
    const esc = (s: string) => {
      const str = String(s);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };
    const lines = [headers, ...csvRows].map(r => r.map(esc).join(','));
    const csv = BOM + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `minutes-report-${reportType}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const showingFrom = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const showingTo = Math.min((page + 1) * PAGE_SIZE, totalCount);
  const activeFilterCount = [dateFrom, dateTo, status, priority, confidentiality, overdueOnly ? '1' : '', hasDecisions].filter(Boolean).length;

  return (
    <div dir="rtl" className="space-y-4 sm:space-y-5">
      <MinutesBackButton onNavigate={onNavigate} target="minutes-hub" label="بازگشت به هاب" />
      <PageHeader title="گزارش‌ها" description="ساخت گزارش از صورت‌جلسات و مصوبات" />

      <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:space-y-4 sm:p-5">
        {/* On phones the filter form is collapsed by default. */}
        <div className="flex items-center gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => setMobileFiltersOpen(v => !v)}
            aria-expanded={mobileFiltersOpen}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 text-sm font-semibold text-gray-700 dark:bg-gray-700/70 dark:text-gray-200"
          >
            <span className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 flex-shrink-0 text-blue-500" />
              <span className="truncate">{REPORT_TYPES.find(r => r.value === reportType)?.label}</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                  {activeFilterCount.toLocaleString('fa-IR')}
                </span>
              )}
            </span>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => runReport(0)}
            disabled={running}
            title="اجرای گزارش"
            aria-label="اجرای گزارش"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white disabled:opacity-60"
          >
            <Play className="h-4 w-4" />
          </button>
        </div>

        <div className={`${mobileFiltersOpen ? 'block' : 'hidden'} sm:block`}>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">نوع گزارش</label>
              <select value={reportType} onChange={e => { setReportType(e.target.value as ReportType); setRan(false); setRows([]); }}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                {REPORT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">از تاریخ</label>
              <JalaliDatePicker value={dateFrom || null} onChange={v => setDateFrom(v || '')} placeholder="تاریخ شروع" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">تا تاریخ</label>
              <JalaliDatePicker value={dateTo || null} onChange={v => setDateTo(v || '')} placeholder="تاریخ پایان" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">وضعیت</label>
              <select value={status} onChange={e => setStatus(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                <option value="">همه</option>
                {reportType === 'minutes' ? (
                  <>
                    <option value="draft">پیش‌نویس</option>
                    <option value="pending_approval">در انتظار تأیید</option>
                    <option value="changes_requested">درخواست اصلاح</option>
                    <option value="approved">تأییدشده</option>
                    <option value="published">منتشرشده</option>
                  </>
                ) : (
                  <>
                    <option value="not_started">شروع‌نشده</option>
                    <option value="in_progress">در حال انجام</option>
                    <option value="waiting_coordination">منتظر هماهنگی</option>
                    <option value="waiting_approval">منتظر تأیید</option>
                    <option value="completed">تکمیل‌شده</option>
                    <option value="stopped">متوقف‌شده</option>
                  </>
                )}
              </select>
            </div>
            {reportType === 'decisions' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">اولویت</label>
                <select value={priority} onChange={e => setPriority(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option value="">همه</option>
                  <option value="urgent">فوری</option>
                  <option value="important">مهم</option>
                  <option value="normal">عادی</option>
                  <option value="low">کم</option>
                </select>
              </div>
            )}
            {reportType === 'minutes' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">محرمانگی</label>
                <select value={confidentiality} onChange={e => setConfidentiality(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option value="">همه</option>
                  <option value="public">عمومی</option>
                  <option value="organizational">سازمانی</option>
                  <option value="restricted">محدود</option>
                  <option value="confidential">محرمانه</option>
                </select>
              </div>
            )}
            {reportType === 'decisions' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">عقب‌افتاده</label>
                <select value={overdueOnly ? '1' : '0'} onChange={e => setOverdueOnly(e.target.value === '1')}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option value="0">همه</option>
                  <option value="1">فقط عقب‌افتاده</option>
                </select>
              </div>
            )}
            {reportType === 'minutes' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">دارای مصوبه</label>
                <select value={hasDecisions} onChange={e => setHasDecisions(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                  <option value="">همه</option>
                  <option value="yes">دارای مصوبه</option>
                  <option value="no">بدون مصوبه</option>
                </select>
              </div>
            )}
          </div>

          <div className="mobile-scroll-actions mt-3 border-t border-gray-100 pt-3 dark:border-gray-700 sm:flex sm:flex-wrap sm:overflow-visible">
            <button onClick={() => runReport(0)} disabled={running}
              className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60">
              <Play className="h-4 w-4" /> {running ? 'در حال اجرا...' : 'اجرای گزارش'}
            </button>
            <button onClick={clearFilters}
              className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600">
              <X className="h-4 w-4" /> پاک‌کردن
            </button>
            {ran && rows.length > 0 && (
              <button onClick={exportCsv}
                className="flex flex-shrink-0 items-center gap-2 rounded-xl bg-green-50 px-4 py-2.5 text-sm font-medium text-green-600 transition-colors hover:bg-green-100 dark:bg-green-900/20 dark:text-green-400">
                <FileDown className="h-4 w-4" /> CSV
              </button>
            )}
          </div>
        </div>
      </div>

      {running && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <TableSkeleton rows={6} />
        </div>
      )}

      {error && !running && (
        <div className="rounded-xl bg-red-50 p-4 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>
      )}

      {ran && !running && !error && (
        <>
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:py-16">
              <Search className="mx-auto mb-3 h-10 w-10 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-500 dark:text-gray-400">نتیجه‌ای یافت نشد. فیلترها را تغییر دهید.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              {/* Native mobile cards instead of squeezing a desktop table. */}
              <div className="space-y-2.5 p-3 md:hidden">
                {reportType === 'minutes'
                  ? (rows as MinuteReportRow[]).map(r => (
                      <button
                        key={r.id}
                        onClick={() => { setMinuteIdInUrl(r.id); onNavigate('minutes-detail'); }}
                        className="w-full rounded-xl border border-gray-100 bg-gray-50/70 p-3 text-right dark:border-gray-700 dark:bg-gray-700/25"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="mobile-line-clamp-2 text-sm font-semibold leading-6 text-gray-900 dark:text-white">{r.meeting_title}</span>
                          <MinutesStatusBadge status={r.status as any} />
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                          <span>{formatJalaliDateForDisplay(r.meeting_date)}</span>
                          <span className="truncate">{r.org_unit || 'بدون واحد'}</span>
                          <span className="truncate">دبیر: {r.secretary}</span>
                          <span>{r.decision_count.toLocaleString('fa-IR')} مصوبه</span>
                        </div>
                      </button>
                    ))
                  : (rows as DecisionReportRow[]).map(r => (
                      <div key={r.id} className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-700/25">
                        <div className="flex items-start justify-between gap-2">
                          <span className="mobile-line-clamp-2 text-sm font-semibold leading-6 text-gray-900 dark:text-white">{r.title}</span>
                          <DecisionPriorityBadge priority={r.priority as any} />
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">{r.minute_title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <DecisionStatusBadge status={r.status as any} />
                          {r.overdue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300">عقب‌افتاده</span>}
                          <span className="text-[10px] text-gray-500">مهلت: {formatJalaliDateForDisplay(r.due_date)}</span>
                        </div>
                        <div className="mt-2"><ProgressIndicator percent={r.progress} /></div>
                      </div>
                    ))}
              </div>

              {/* Desktop/tablet table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
                      {reportType === 'minutes' ? (
                        <>
                          <Th>عنوان جلسه</Th><Th>تاریخ</Th><Th>واحد</Th><Th>دبیر</Th><Th>رئیس</Th>
                          <Th>وضعیت</Th><Th>مد تأیید</Th><Th>نسخه</Th><Th>مصوبات</Th><Th>انتشار</Th>
                        </>
                      ) : (
                        <>
                          <Th>عنوان مصوبه</Th><Th>صورت‌جلسه</Th><Th>واحد</Th><Th>اولویت</Th><Th>وضعیت</Th>
                          <Th>پیشرفت</Th><Th>مهلت</Th><Th>عقب‌افتاده</Th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                    {reportType === 'minutes'
                      ? (rows as MinuteReportRow[]).map(r => (
                          <tr key={r.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30"
                            onClick={() => { setMinuteIdInUrl(r.id); onNavigate('minutes-detail'); }}>
                            <Td><span className="font-medium text-gray-800 dark:text-gray-200">{r.meeting_title}</span></Td>
                            <Td>{formatJalaliDateForDisplay(r.meeting_date)}</Td>
                            <Td>{r.org_unit || '—'}</Td>
                            <Td>{r.secretary}</Td>
                            <Td>{r.chair}</Td>
                            <Td><MinutesStatusBadge status={r.status as any} /></Td>
                            <Td>{r.approval_mode === 'system' ? 'سیستمی' : r.approval_mode === 'in_person' ? 'حضوری' : '—'}</Td>
                            <Td>{r.revision_number}</Td>
                            <Td>{r.decision_count}</Td>
                            <Td>{r.published_at ? formatJalaliTimestamp(r.published_at) : '—'}</Td>
                          </tr>
                        ))
                      : (rows as DecisionReportRow[]).map(r => (
                          <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <Td><span className="font-medium text-gray-800 dark:text-gray-200">{r.title}</span></Td>
                            <Td>{r.minute_title}</Td>
                            <Td>{r.unit || '—'}</Td>
                            <Td><DecisionPriorityBadge priority={r.priority as any} /></Td>
                            <Td><DecisionStatusBadge status={r.status as any} /></Td>
                            <Td><ProgressIndicator percent={r.progress} /></Td>
                            <Td>{formatJalaliDateForDisplay(r.due_date)}</Td>
                            <Td>{r.overdue ? <span className="text-xs font-medium text-red-600">عقب‌افتاده</span> : '—'}</Td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400 sm:px-5">
                <span>{showingFrom.toLocaleString('fa-IR')}–{showingTo.toLocaleString('fa-IR')} از {totalCount.toLocaleString('fa-IR')}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => runReport(page - 1)} disabled={page === 0}
                    className="rounded-lg bg-gray-100 p-1.5 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <span className="px-2 py-1">{(page + 1).toLocaleString('fa-IR')} / {totalPages.toLocaleString('fa-IR')}</span>
                  <button onClick={() => runReport(page + 1)} disabled={page + 1 >= totalPages}
                    className="rounded-lg bg-gray-100 p-1.5 transition-colors hover:bg-gray-200 disabled:opacity-40 dark:bg-gray-700 dark:hover:bg-gray-600">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!ran && !running && (
        <div className="rounded-2xl border border-gray-100 bg-white py-10 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:py-16">
          <Search className="mx-auto mb-3 h-8 w-8 text-gray-300 dark:text-gray-600 sm:h-10 sm:w-10" />
          <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">نوع گزارش را انتخاب کنید؛ فیلترها اختیاری هستند.</p>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-4 py-2.5 text-xs text-gray-600 dark:text-gray-400">{children}</td>;
}
