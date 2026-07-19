import { useEffect, useState, useCallback } from 'react';
import { Search, FileDown, Play, X, Settings2, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { PageHeader, TableSkeleton, EmptyState, MinutesStatusBadge, DecisionStatusBadge, DecisionPriorityBadge, ProgressIndicator } from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';

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

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader title="گزارش‌ها" description="ساخت گزارش از صورت‌جلسات و مصوبات" />

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">نوع گزارش</label>
            <select value={reportType} onChange={e => { setReportType(e.target.value as ReportType); setRan(false); setRows([]); }}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
              {REPORT_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">از تاریخ</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">تا تاریخ</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">وضعیت</label>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
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
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">اولویت</label>
              <select value={priority} onChange={e => setPriority(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
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
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">محرمانگی</label>
              <select value={confidentiality} onChange={e => setConfidentiality(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
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
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">فقط عقب‌افتاده</label>
              <select value={overdueOnly ? '1' : '0'} onChange={e => setOverdueOnly(e.target.value === '1')}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
                <option value="0">خیر</option>
                <option value="1">بله</option>
              </select>
            </div>
          )}
          {reportType === 'minutes' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">دارای مصوبه</label>
              <select value={hasDecisions} onChange={e => setHasDecisions(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white">
                <option value="">همه</option>
                <option value="yes">فقط دارای مصوبه</option>
                <option value="no">فقط بدون مصوبه</option>
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-gray-100 dark:border-gray-700">
          <button onClick={() => runReport(0)} disabled={running}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60">
            <Play className="w-4 h-4" /> {running ? 'در حال اجرا...' : 'اجرای گزارش'}
          </button>
          <button onClick={clearFilters}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            <X className="w-4 h-4" /> پاک‌کردن فیلترها
          </button>
          {ran && rows.length > 0 && (
            <button onClick={exportCsv}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 transition-colors">
              <FileDown className="w-4 h-4" /> خروجی CSV
            </button>
          )}
        </div>
      </div>

      {running && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <TableSkeleton rows={6} />
        </div>
      )}

      {error && !running && (
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">{error}</div>
      )}

      {ran && !running && !error && (
        <>
          {rows.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 py-16 text-center">
              <Search className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">نتیجه‌ای یافت نشد. فیلترها را تغییر دهید.</p>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
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
                          <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                            onClick={() => { setMinuteIdInUrl(r.id); setMinutesPageInUrl('minutes-detail'); onNavigate('minutes-detail'); }}>
                            <Td><span className="font-medium text-gray-800 dark:text-gray-200">{r.meeting_title}</span></Td>
                            <Td>{r.meeting_date || '—'}</Td>
                            <Td>{r.org_unit || '—'}</Td>
                            <Td>{r.secretary}</Td>
                            <Td>{r.chair}</Td>
                            <Td><MinutesStatusBadge status={r.status as any} /></Td>
                            <Td>{r.approval_mode === 'system' ? 'سیستمی' : r.approval_mode === 'in_person' ? 'حضوری' : '—'}</Td>
                            <Td>{r.revision_number}</Td>
                            <Td>{r.decision_count}</Td>
                            <Td>{r.published_at ? new Date(r.published_at).toLocaleDateString('fa-IR') : '—'}</Td>
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
                            <Td>{r.due_date || '—'}</Td>
                            <Td>{r.overdue ? <span className="text-red-600 text-xs font-medium">عقب‌افتاده</span> : '—'}</Td>
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
              <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>نمایش {showingFrom} تا {showingTo} از {totalCount}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => runReport(page - 1)} disabled={page === 0}
                    className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <span className="px-2.5 py-1">{page + 1} / {totalPages}</span>
                  <button onClick={() => runReport(page + 1)} disabled={page + 1 >= totalPages}
                    className="p-1.5 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors disabled:opacity-40">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!ran && !running && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 py-16 text-center">
          <Search className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">فیلترها را تنظیم کرده و «اجرای گزارش» را بزنید.</p>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs whitespace-nowrap">{children}</td>;
}
