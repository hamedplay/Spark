import { useEffect, useState, useCallback } from 'react';
import { Search, Eye, TrendingUp, TriangleAlert as AlertTriangle, History, X, Loader as Loader2, ChevronRight, ChevronLeft } from 'lucide-react';
import {
  PageHeader, DecisionStatusBadge, DecisionPriorityBadge, DecisionProgressBar, EmptyState, TableSkeleton, DecisionProgressModal,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl } from '../../lib/minutesNavigation';
import type { DecisionStatus, DecisionPriority, DecisionRow, DecisionUpdateRow } from './types';

interface Props {
  onNavigate: (page: string, params?: Record<string, string>) => void;
}

const PAGE_SIZE = 25;

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

const PRIORITY_OPTIONS: { value: DecisionPriority | 'all'; label: string }[] = [
  { value: 'all',       label: 'همه اولویت‌ها' },
  { value: 'urgent',    label: 'فوری' },
  { value: 'important', label: 'مهم' },
  { value: 'normal',    label: 'عادی' },
  { value: 'low',       label: 'کم' },
];

interface FollowupRow extends DecisionRow {
  minute_title?: string;
  minute_status?: string;
  meeting_date_snapshot?: string;
  overdue?: boolean;
  owner_name?: string;
}

export function DecisionsFollowupPage({ onNavigate }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DecisionStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<DecisionPriority | 'all'>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [followupOnly, setFollowupOnly] = useState(false);
  const [unitFilter, setUnitFilter] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const [data, setData] = useState<FollowupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [progressDecision, setProgressDecision] = useState<FollowupRow | null>(null);
  const [progressHistory, setProgressHistory] = useState<DecisionUpdateRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch decisions visible to this user via RLS, plus minute metadata
      let query = supabase
        .from('minutes_decisions')
        .select(`
          id, minute_id, agenda_result_id, title, description,
          primary_owner_user_id, responsible_unit_id, responsible_unit_name_snapshot,
          priority, status, progress_percent, start_date, due_date,
          completed_at, requires_followup, latest_update,
          created_by_user_id, created_at, updated_at,
          minutes:minute_id ( meeting_title_snapshot, status, meeting_date_snapshot )
        `)
        .order('created_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      const { data: raw, error: qError } = await query;
      if (qError) throw qError;

      const rows = (raw || []) as unknown as Array<DecisionRow & { minutes: { meeting_title_snapshot: string; status: string; meeting_date_snapshot: string } | null }>;
      // Fetch owner names
      const ownerIds = Array.from(new Set(rows.map(r => r.primary_owner_user_id).filter(Boolean)));
      const names: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const { data: profData } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', ownerIds);
        for (const p of (profData || []) as unknown as { user_id: string; full_name: string }[]) {
          names[p.user_id] = p.full_name;
        }
      }

      const now = new Date();
      const enriched: FollowupRow[] = rows.map(r => ({
        ...r,
        minute_title: r.minutes?.meeting_title_snapshot || '',
        minute_status: r.minutes?.status || '',
        meeting_date_snapshot: r.minutes?.meeting_date_snapshot || '',
        overdue: !!(r.due_date && r.status !== 'completed' && r.status !== 'stopped' && new Date(r.due_date) < now),
        owner_name: names[r.primary_owner_user_id] || '',
      }));

      // Client-side filters (status, priority, overdue, followup, unit, owner, search)
      const filtered = enriched.filter(d => {
        if (statusFilter !== 'all' && d.status !== statusFilter) return false;
        if (priorityFilter !== 'all' && d.priority !== priorityFilter) return false;
        if (overdueOnly && !d.overdue) return false;
        if (followupOnly && !d.requires_followup) return false;
        if (unitFilter && !(d.responsible_unit_name_snapshot || '').includes(unitFilter)) return false;
        if (ownerFilter && !(d.owner_name || '').includes(ownerFilter)) return false;
        if (search.trim()) {
          const q = search.trim();
          if (!d.title.includes(q) && !(d.minute_title || '').includes(q) && !(d.responsible_unit_name_snapshot || '').includes(q)) return false;
        }
        return true;
      });

      setData(filtered);
    } catch {
      setError('بارگذاری مصوبات ناموفق بود. لطفاً دوباره تلاش کنید.');
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter, priorityFilter, overdueOnly, followupOnly, unitFilter, ownerFilter, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openProgress = async (dec: FollowupRow) => {
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

  // Permission to update: only owner/secretary/chair/admin. Since this page doesn't have
  // currentUserId/isAdmin props, we rely on the RPC's own authz and let the modal show
  // an error if the user lacks permission. We show the button for all rows; the RPC
  // will return DECISION_NO_PERMISSION if not allowed.
  const canUpdate = (dec: FollowupRow) => {
    // Only show update button for published/approved minutes
    return dec.minute_status === 'published' || dec.minute_status === 'approved';
  };

  const hasNext = data.length === PAGE_SIZE;
  const hasPrev = offset > 0;

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader
        title="پیگیری مصوبات"
        description="نظارت و پیگیری وضعیت اجرای مصوبات (نمایش بر اساس دسترسی شما)"
        actions={
          <button
            onClick={() => setShowFilters(f => !f)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            فیلترها
          </button>
        }
      />

      {/* Filters */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="جستجو..."
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
            <select
              value={priorityFilter}
              onChange={e => { setPriorityFilter(e.target.value as DecisionPriority | 'all'); setOffset(0); }}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              type="text"
              placeholder="واحد مسئول..."
              value={unitFilter}
              onChange={e => { setUnitFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
            <input
              type="text"
              placeholder="مسئول..."
              value={ownerFilter}
              onChange={e => { setOwnerFilter(e.target.value); setOffset(0); }}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={overdueOnly}
                onChange={e => { setOverdueOnly(e.target.checked); setOffset(0); }}
                className="w-4 h-4 rounded accent-red-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" /> فقط عقب‌افتاده‌ها
              </span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={followupOnly}
                onChange={e => { setFollowupOnly(e.target.checked); setOffset(0); }}
                className="w-4 h-4 rounded accent-orange-500"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">نیازمند پیگیری</span>
            </label>
          </div>
        </div>
      )}

      {/* Search bar (always visible) */}
      {!showFilters && (
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="جستجو در مصوبات..."
            value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0); }}
            className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-white"
          />
        </div>
      )}

      {/* Results count */}
      <p className="text-sm text-gray-500 dark:text-gray-400">{loading ? '...' : data.length} مصوبه</p>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : error ? (
          <EmptyState icon={<AlertTriangle className="w-8 h-8 text-red-400" />} title="خطا" description={error} />
        ) : data.length === 0 ? (
          <EmptyState icon={<Search className="w-8 h-8" />} title="مصوبه‌ای یافت نشد" description="هیچ مصوبه‌ای با این فیلترها قابل مشاهده نیست." />
        ) : (
          <>
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    {['عنوان','صورت‌جلسه','مسئول','واحد','وضعیت','اولویت','مهلت','پیشرفت','آخرین پیگیری','عملیات'].map(h => (
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
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap text-xs">{d.owner_name || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-400 whitespace-nowrap text-xs">{d.responsible_unit_name_snapshot || '—'}</td>
                      <td className="px-4 py-3"><DecisionStatusBadge status={d.status} /></td>
                      <td className="px-4 py-3"><DecisionPriorityBadge priority={d.priority} /></td>
                      <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400 whitespace-nowrap">{d.due_date || '—'}</td>
                      <td className="px-4 py-3 w-36"><DecisionProgressBar percent={d.progress_percent} /></td>
                      <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap max-w-[12rem] truncate">{d.latest_update || '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => { setMinuteIdInUrl(d.minute_id); onNavigate('minutes-detail'); }} aria-label="مشاهده" title="مشاهده صورت‌جلسه"
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                          {canUpdate(d) && (
                            <button onClick={() => openProgress(d)} aria-label="ثبت پیشرفت" title="ثبت پیشرفت"
                              className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors">
                              <TrendingUp className="w-4 h-4" />
                            </button>
                          )}
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
                    <span className="text-xs text-gray-500 dark:text-gray-400">{d.owner_name || '—'}</span>
                    {d.due_date && <span className="text-xs text-gray-500 dark:text-gray-400">مهلت: {d.due_date}</span>}
                    {d.overdue && <span className="text-xs text-red-500 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> سررسید گذشته</span>}
                  </div>
                  <DecisionProgressBar percent={d.progress_percent} />
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => { setMinuteIdInUrl(d.minute_id); onNavigate('minutes-detail'); }} className="text-xs px-2.5 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 transition-colors">مشاهده</button>
                    {canUpdate(d) && (
                      <button onClick={() => openProgress(d)} className="text-xs px-2.5 py-1.5 rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors">ثبت پیشرفت</button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>نمایش {offset + 1}–{offset + data.length}</span>
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
