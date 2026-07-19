import { useEffect, useState, useCallback } from 'react';
import { Search, X, Eye, TrendingUp, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, ChartBar as BarChart2, Loader as Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import {
  PageHeader, StatCard, DecisionStatusBadge, DecisionPriorityBadge, DecisionProgressBar, EmptyState, TableSkeleton, DecisionProgressModal,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import type { DecisionStatus, MyDecisionRow, DecisionUpdateRow } from './types';

interface Props {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

const PAGE_SIZE = 20;

const STATUS_OPTIONS: { value: DecisionStatus | 'all'; label: string }[] = [
  { value: 'all',                    label: 'همه وضعیت‌ها' },
  { value: 'not_started',            label: 'شروع‌نشده' },
  { value: 'planned',                label: 'برنامه‌ریزی‌شده' },
  { value: 'in_progress',            label: 'در حال انجام' },
  { value: 'waiting_coordination',   label: 'منتظر هماهنگی' },
  { value: 'waiting_approval',       label: 'منتظر تأیید' },
  { value: 'completed',              label: 'تکمیل‌شده' },
  { value: 'stopped',                label: 'متوقف‌شده' },
];

export function MyDecisionsPage({ onNavigate }: Props) {
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<MyDecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [progressDecision, setProgressDecision] = useState<MyDecisionRow | null>(null);
  const [progressHistory, setProgressHistory] = useState<DecisionUpdateRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_my_minutes_decisions', {
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });
      if (rpcError) throw rpcError;
      const rows = (rpcData || []) as unknown as MyDecisionRow[];
      // Client-side search filter (RPC doesn't expose search param)
      const filtered = search.trim()
        ? rows.filter(r =>
            r.title.includes(search) ||
            (r.minute_title || '').includes(search) ||
            (r.responsible_unit_name_snapshot || '').includes(search))
        : rows;
      setData(filtered);
      // Total count (approximate: use a second call with large limit when filters change)
      // We use the first page's length + offset as a rough indicator; for exact total, we'd need a count RPC.
      // To keep it simple and correct, fetch total only on filter change with limit 1 offset 0? No — use a separate count query.
      // Instead: we set total to offset + rows.length, and if rows.length === PAGE_SIZE we assume there are more.
      setTotal(offset + rows.length);
    } catch {
      setError('بارگذاری مصوبات ناموفق بود. لطفاً دوباره تلاش کنید.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, offset, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch total count separately for accurate pagination
  useEffect(() => {
    (async () => {
      const { data: countData } = await supabase.rpc('get_my_minutes_decisions', {
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_limit: 100,
        p_offset: 0,
      });
      const rows = (countData || []) as unknown as MyDecisionRow[];
      const filtered = search.trim()
        ? rows.filter(r =>
            r.title.includes(search) ||
            (r.minute_title || '').includes(search) ||
            (r.responsible_unit_name_snapshot || '').includes(search))
        : rows;
      setTotal(filtered.length);
    })();
  }, [statusFilter, search]);

  const openProgress = async (dec: MyDecisionRow) => {
    setProgressDecision(dec);
    setHistoryLoading(true);
    try {
      const { data: histData } = await supabase
        .from('minutes_decision_updates')
        .select('id, decision_id, minute_id, previous_status, new_status, previous_progress_percent, new_progress_percent, update_text, created_by_user_id, created_at')
        .eq('decision_id', dec.id)
        .order('created_at', { ascending: false });
      setProgressHistory((histData || []) as unknown as DecisionUpdateRow[]);
    } catch {
      setProgressHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  const onProgressUpdated = () => {
    setProgressDecision(null);
    fetchData();
  };

  const stats = {
    total: data.length,
    inProgress: data.filter(d => d.status === 'in_progress').length,
    overdue: data.filter(d => d.overdue).length,
    completed: data.filter(d => d.status === 'completed').length,
    stopped: data.filter(d => d.status === 'stopped').length,
  };

  const hasNext = data.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader title="مصوبات من" description="مصوباتی که به‌عنوان مسئول اصلی به شما واگذار شده است" />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="کل (این صفحه)" value={stats.total} icon={<BarChart2 className="w-5 h-5 text-gray-500" />} colorClass="bg-gray-100 dark:bg-gray-700" />
        <StatCard label="در حال انجام" value={stats.inProgress} icon={<TrendingUp className="w-5 h-5 text-blue-500" />} colorClass="bg-blue-50 dark:bg-blue-900/20" />
        <StatCard label="عقب‌افتاده" value={stats.overdue} icon={<AlertTriangle className="w-5 h-5 text-red-500" />} colorClass="bg-red-50 dark:bg-red-900/20" />
        <StatCard label="تکمیل‌شده" value={stats.completed} icon={<CheckCircle className="w-5 h-5 text-green-500" />} colorClass="bg-green-50 dark:bg-green-900/20" />
        <StatCard label="متوقف‌شده" value={stats.stopped} icon={<X className="w-5 h-5 text-orange-500" />} colorClass="bg-orange-50 dark:bg-orange-900/20" />
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="جستجو در عنوان، صورت‌جلسه، واحد..."
              value={search}
              onChange={e => { setSearch(e.target.value); setOffset(0); }}
              className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as DecisionStatus | 'all'); setOffset(0); }}
            className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
          >
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : error ? (
          <EmptyState icon={<AlertTriangle className="w-8 h-8 text-red-400" />} title="خطا" description={error} />
        ) : data.length === 0 ? (
          <EmptyState icon={<Search className="w-8 h-8" />} title="مصوبه‌ای یافت نشد" description="هیچ مصوبه‌ای متعلق به شما یافت نشد." />
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    {['عنوان مصوبه','صورت‌جلسه','واحد مسئول','اولویت','وضعیت','پیشرفت','مهلت','عملیات'].map(h => (
                      <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {data.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-white">{d.title}</p>
                        {d.overdue && <span className="text-xs text-red-500 mt-0.5 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> سررسید گذشته</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">{d.minute_title || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">{d.responsible_unit_name_snapshot || '—'}</td>
                      <td className="px-4 py-3"><DecisionPriorityBadge priority={d.priority} /></td>
                      <td className="px-4 py-3"><DecisionStatusBadge status={d.status} /></td>
                      <td className="px-4 py-3 w-40"><DecisionProgressBar percent={d.progress_percent} /></td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">{d.due_date || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onNavigate('minutes-detail', { id: d.minute_id })}
                            aria-label="مشاهده"
                            title="مشاهده صورت‌جلسه"
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openProgress(d)}
                            className="text-xs px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors whitespace-nowrap"
                          >
                            ثبت پیشرفت
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {data.map(d => (
                <div key={d.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white leading-snug">{d.title}</p>
                    <DecisionPriorityBadge priority={d.priority} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{d.minute_title || '—'}</p>
                  <div className="flex flex-wrap gap-2 items-center">
                    <DecisionStatusBadge status={d.status} />
                    {d.overdue && <span className="text-xs text-red-500 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> سررسید گذشته</span>}
                    {d.due_date && <span className="text-xs text-gray-500 dark:text-gray-400">مهلت: {d.due_date}</span>}
                  </div>
                  <DecisionProgressBar percent={d.progress_percent} />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => onNavigate('minutes-detail', { id: d.minute_id })} className="text-xs px-2.5 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 transition-colors">
                      مشاهده
                    </button>
                    <button onClick={() => openProgress(d)} className="text-xs px-2.5 py-1.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">
                      ثبت پیشرفت
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>نمایش {offset + 1}–{offset + data.length} از {total}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))}
                  disabled={!hasPrev || loading}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="قبلی"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setOffset(o => o + PAGE_SIZE)}
                  disabled={!hasNext || loading}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  aria-label="بعدی"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {progressDecision && (
        <DecisionProgressModal
          decision={progressDecision}
          history={historyLoading ? [] : progressHistory}
          canUpdate={true}
          onClose={() => setProgressDecision(null)}
          onUpdated={onProgressUpdated}
        />
      )}
    </div>
  );
}
