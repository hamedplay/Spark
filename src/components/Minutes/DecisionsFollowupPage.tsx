import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, X, RefreshCw, Eye, TrendingUp, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Flag, ChevronRight, ChevronLeft, MessageSquare, SquareArrowUpRight, ListFilter as Filter, CircleStop as StopCircle, RotateCcw, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, StatCard, DecisionStatusBadge, DecisionPriorityBadge,
  DecisionProgressBar, TableSkeleton, EmptyState,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl } from '../../lib/minutesNavigation';
import { formatJalaliDateForDisplay, toPersianDigits } from '../../lib/minutesDate';
import {
  DECISION_STATUS_LABELS, DECISION_PRIORITY_LABELS,
  DEADLINE_STATE_LABELS, getDecisionDeadlineState, formatDecisionDaysLabel,
  ACTIVE_STATUSES,
} from './decisionHelpers';
import { DecisionActionModal } from './DecisionActionModal';
import { DecisionDetailsDrawer } from './DecisionDetailsDrawer';
import type { DecisionStatus, DecisionPriority, DecisionRow, DecisionDeadlineState } from './types';

interface DecisionsFollowupPageProps {
  onNavigate: (page: string, params?: Record<string, unknown>) => void;
  isAdmin?: boolean;
  currentUserId?: string | null;
}

interface FollowupRow extends DecisionRow {
  minute_title: string;
  minute_status: string;
  meeting_date_snapshot: string;
  overdue: boolean;
  owner_name: string;
  open_obstacles: number;
}

const PAGE_SIZE = 25;

const STATUS_OPTIONS: Array<{ value: DecisionStatus | 'all'; label: string }> = [
  { value: 'all', label: 'همه وضعیت‌ها' },
  ...(['not_started','planned','in_progress','waiting_coordination','waiting_approval','completed','stopped'] as DecisionStatus[])
    .map(s => ({ value: s, label: DECISION_STATUS_LABELS[s] })),
];

const PRIORITY_OPTIONS: Array<{ value: DecisionPriority | 'all'; label: string }> = [
  { value: 'all', label: 'همه اولویت‌ها' },
  ...(['urgent','important','normal','low'] as DecisionPriority[])
    .map(p => ({ value: p, label: DECISION_PRIORITY_LABELS[p] })),
];

const DEADLINE_OPTIONS: Array<{ value: DecisionDeadlineState | 'all'; label: string }> = [
  { value: 'all', label: 'همه' },
  { value: 'overdue', label: DEADLINE_STATE_LABELS.overdue },
  { value: 'today', label: DEADLINE_STATE_LABELS.today },
  { value: 'approaching', label: DEADLINE_STATE_LABELS.approaching },
  { value: 'on_time', label: DEADLINE_STATE_LABELS.on_time },
  { value: 'no_deadline', label: DEADLINE_STATE_LABELS.no_deadline },
];

type ActionType = import('./DecisionActionModal').ActionType;

export function DecisionsFollowupPage({ onNavigate, isAdmin = false }: DecisionsFollowupPageProps) {
  const [data, setData]               = useState<FollowupRow[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [offset, setOffset]           = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  // Filters
  const [search, setSearch]                 = useState('');
  const [statusFilter, setStatusFilter]     = useState<DecisionStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<DecisionPriority | 'all'>('all');
  const [deadlineFilter, setDeadlineFilter] = useState<DecisionDeadlineState | 'all'>('all');
  const [overdueOnly, setOverdueOnly]       = useState(false);
  const [followupOnly, setFollowupOnly]     = useState(false);
  const [hasObstacle, setHasObstacle]       = useState(false);
  const [unitFilter, setUnitFilter]         = useState('');
  const [ownerFilter, setOwnerFilter]       = useState('');

  // Modals
  const [actionDecision, setActionDecision] = useState<FollowupRow | null>(null);
  const [actionType, setActionType]         = useState<ActionType>('progress');
  const [detailDecision, setDetailDecision] = useState<FollowupRow | null>(null);

  const fetchData = useCallback(async (currentOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      // Build query
      let query = supabase
        .from('minutes_decisions')
        .select('*, minutes!inner(meeting_title_snapshot, status, meeting_date_snapshot)', { count: 'exact' })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1)
        .order('due_date', { ascending: true, nullsFirst: false });

      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      if (priorityFilter !== 'all') query = query.eq('priority', priorityFilter);
      if (overdueOnly) {
        const today = new Date().toISOString().slice(0, 10);
        query = query.lt('due_date', today).not('status', 'in', '("completed","stopped")');
      }
      if (followupOnly) query = query.eq('requires_followup', true);

      const { data: rows, error: qErr, count } = await query;
      if (qErr) throw qErr;

      // Fetch owner names in batch
      const ownerIds = [...new Set((rows || []).map((r: Record<string, unknown>) => r.primary_owner_user_id as string).filter(Boolean))];
      const ownerMap: Record<string, string> = {};
      if (ownerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('user_id, full_name, username')
          .in('user_id', ownerIds);
        for (const p of profiles || []) {
          const pr = p as { user_id: string; full_name: string | null; username: string | null };
          ownerMap[pr.user_id] = pr.full_name || pr.username || pr.user_id.slice(0, 8);
        }
      }

      // Fetch open obstacle counts
      const decisionIds = (rows || []).map((r: Record<string, unknown>) => r.id as string);
      const obstacleMap: Record<string, number> = {};
      if (decisionIds.length > 0) {
        const { data: obs } = await supabase
          .from('minutes_decision_updates')
          .select('decision_id')
          .in('decision_id', decisionIds)
          .eq('is_blocking', true)
          .is('resolved_at', null);
        for (const o of obs || []) {
          const oo = o as { decision_id: string };
          obstacleMap[oo.decision_id] = (obstacleMap[oo.decision_id] || 0) + 1;
        }
      }

      const today = new Date().toISOString().slice(0, 10);
      const enriched: FollowupRow[] = (rows || []).map((r: Record<string, unknown>) => {
        const minuteRel = r.minutes as Record<string, unknown> | null;
        return {
          ...r,
          minute_title: (minuteRel?.meeting_title_snapshot as string) || '',
          minute_status: (minuteRel?.status as string) || '',
          meeting_date_snapshot: (minuteRel?.meeting_date_snapshot as string) || '',
          overdue: !!(r.due_date && (r.due_date as string) < today && !['completed','stopped'].includes(r.status as string)),
          owner_name: ownerMap[r.primary_owner_user_id as string] || '',
          open_obstacles: obstacleMap[r.id as string] || 0,
        } as FollowupRow;
      });

      setData(enriched);
      setTotal(count ?? currentOffset + enriched.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری مصوبات');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, priorityFilter, overdueOnly, followupOnly]);

  useEffect(() => { setOffset(0); }, [statusFilter, priorityFilter, deadlineFilter, overdueOnly, followupOnly, hasObstacle, unitFilter, ownerFilter, search]);
  useEffect(() => { fetchData(offset); }, [fetchData, offset]);

  // Client-side filtering
  const filtered = useMemo(() => {
    let rows = data;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(r => r.title?.toLowerCase().includes(q) || r.minute_title?.toLowerCase().includes(q));
    }
    if (deadlineFilter !== 'all') rows = rows.filter(r => getDecisionDeadlineState(r.due_date, r.status) === deadlineFilter);
    if (hasObstacle) rows = rows.filter(r => r.open_obstacles > 0);
    if (unitFilter.trim()) rows = rows.filter(r => r.responsible_unit_name_snapshot?.includes(unitFilter.trim()));
    if (ownerFilter.trim()) rows = rows.filter(r => r.owner_name?.includes(ownerFilter.trim()));
    return rows;
  }, [data, search, deadlineFilter, hasObstacle, unitFilter, ownerFilter]);

  const stats = useMemo(() => ({
    total:      total,
    active:     data.filter(r => ACTIVE_STATUSES.has(r.status)).length,
    completed:  data.filter(r => r.status === 'completed').length,
    stopped:    data.filter(r => r.status === 'stopped').length,
    overdue:    data.filter(r => r.overdue).length,
    obstacles:  data.filter(r => r.open_obstacles > 0).length,
    followup:   data.filter(r => r.requires_followup).length,
  }), [data, total]);

  const openAction = (dec: FollowupRow, type: ActionType) => {
    setActionDecision(dec);
    setActionType(type);
  };

  const handleActionSuccess = () => {
    setActionDecision(null);
    fetchData(offset);
    toast.success('عملیات با موفقیت ثبت شد.');
  };

  const resetFilters = () => {
    setSearch(''); setStatusFilter('all'); setPriorityFilter('all');
    setDeadlineFilter('all'); setOverdueOnly(false); setFollowupOnly(false);
    setHasObstacle(false); setUnitFilter(''); setOwnerFilter('');
  };

  const hasFilters = search || statusFilter !== 'all' || priorityFilter !== 'all' ||
    deadlineFilter !== 'all' || overdueOnly || followupOnly || hasObstacle || unitFilter || ownerFilter;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHeader
        title="پیگیری مصوبات"
        description="مدیریت و پیگیری وضعیت مصوبات صورت‌جلسات"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => setShowFilters(s => !s)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-colors ${showFilters ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'} hover:bg-gray-50 dark:hover:bg-gray-800`}>
              <Filter className="w-4 h-4" /> فیلترها
            </button>
            <button onClick={() => fetchData(offset)}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <StatCard label="کل" value={toPersianDigits(String(stats.total))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-blue-600 bg-blue-100 dark:bg-blue-900/30" onClick={() => setStatusFilter('all')} />
        <StatCard label="در جریان" value={toPersianDigits(String(stats.active))} icon={<TrendingUp className="w-5 h-5" />} colorClass="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" onClick={() => setStatusFilter('in_progress')} />
        <StatCard label="تکمیل" value={toPersianDigits(String(stats.completed))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-green-600 bg-green-100 dark:bg-green-900/30" onClick={() => setStatusFilter('completed')} />
        <StatCard label="متوقف" value={toPersianDigits(String(stats.stopped))} icon={<StopCircle className="w-5 h-5" />} colorClass="text-gray-600 bg-gray-100 dark:bg-gray-700" onClick={() => setStatusFilter('stopped')} />
        <StatCard label="عقب‌افتاده" value={toPersianDigits(String(stats.overdue))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-red-600 bg-red-100 dark:bg-red-900/30" onClick={() => { setOverdueOnly(true); setStatusFilter('all'); }} />
        <StatCard label="مانع باز" value={toPersianDigits(String(stats.obstacles))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-orange-600 bg-orange-100 dark:bg-orange-900/30" onClick={() => setHasObstacle(true)} />
        <StatCard label="پیگیری" value={toPersianDigits(String(stats.followup))} icon={<Flag className="w-5 h-5" />} colorClass="text-purple-600 bg-purple-100 dark:bg-purple-900/30" onClick={() => setFollowupOnly(true)} />
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" placeholder="جست‌وجوی عنوان..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            </div>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as DecisionStatus | 'all')}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as DecisionPriority | 'all')}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <select value={deadlineFilter} onChange={e => setDeadlineFilter(e.target.value as DecisionDeadlineState | 'all')}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40">
              {DEADLINE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="text" placeholder="واحد سازمانی..." value={unitFilter} onChange={e => setUnitFilter(e.target.value)}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
            <input type="text" placeholder="نام مسئول..." value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)}
              className="px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {[
              { label: 'عقب‌افتاده', val: overdueOnly, set: setOverdueOnly },
              { label: 'نیازمند پیگیری', val: followupOnly, set: setFollowupOnly },
              { label: 'دارای مانع باز', val: hasObstacle, set: setHasObstacle },
            ].map(f => (
              <label key={f.label} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
                <input type="checkbox" checked={f.val} onChange={e => f.set(e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
                {f.label}
              </label>
            ))}
            {hasFilters && (
              <button onClick={resetFilters} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700 transition-colors mr-auto">
                <X className="w-3.5 h-3.5" /> پاک‌کردن فیلترها
              </button>
            )}
          </div>
        </div>
      )}

      {!showFilters && (
        <div className="mb-4 relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="جست‌وجوی عنوان مصوبه یا جلسه..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {toPersianDigits(String(filtered.length))} نتیجه
        </span>
        {hasFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700">
            <X className="w-3 h-3" /> پاک‌کردن
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <TableSkeleton rows={7} />
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-500 mb-3">{error}</p>
          <button onClick={() => fetchData(offset)} className="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700">تلاش مجدد</button>
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title="مصوبه‌ای یافت نشد" description={hasFilters ? 'فیلترها را تغییر دهید.' : 'هیچ مصوبه‌ای برای پیگیری یافت نشد.'} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <tr>
                    {['عنوان','جلسه','مسئول','واحد','وضعیت','پیشرفت','مهلت','سررسید','مانع','اقدام'].map(h => (
                      <th key={h} className="px-3 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {filtered.map(dec => (
                    <TrackingTableRow
                      key={dec.id}
                      dec={dec}
                      isAdmin={isAdmin}
                      onViewDetail={() => setDetailDecision(dec)}
                      onAction={(type) => openAction(dec, type)}
                      onNavigate={onNavigate}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Mobile cards */}
          <div className="lg:hidden space-y-3">
            {filtered.map(dec => (
              <TrackingMobileCard
                key={dec.id}
                dec={dec}
                isAdmin={isAdmin}
                onViewDetail={() => setDetailDecision(dec)}
                onAction={(type) => openAction(dec, type)}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </>
      )}

      {/* Pagination */}
      {!loading && total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {toPersianDigits(String(offset + 1))} تا {toPersianDigits(String(Math.min(offset + data.length, total)))} از {toPersianDigits(String(total))}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setOffset(o => o + PAGE_SIZE)} disabled={offset + data.length >= total}
              className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Action modal */}
      {actionDecision && (
        <DecisionActionModal
          decision={actionDecision}
          action={actionType}
          isManager={true}
          onClose={() => setActionDecision(null)}
          onSuccess={handleActionSuccess}
        />
      )}

      {/* Detail drawer */}
      {detailDecision && (
        <DecisionDetailsDrawer
          decision={{ ...detailDecision, minute_title: detailDecision.minute_title, meeting_date_snapshot: detailDecision.meeting_date_snapshot }}
          onClose={() => setDetailDecision(null)}
        />
      )}
    </div>
  );
}

// ── TrackingTableRow ──────────────────────────────────────────────────────────
interface TrackRowProps {
  dec: FollowupRow;
  isAdmin: boolean;
  onViewDetail: () => void;
  onAction: (t: ActionType) => void;
  onNavigate: (page: string, params?: Record<string, unknown>) => void;
}

function TrackingTableRow({ dec, isAdmin, onViewDetail, onAction, onNavigate }: TrackRowProps) {
  const deadlineState = getDecisionDeadlineState(dec.due_date, dec.status);
  const daysLabel = formatDecisionDaysLabel(dec.due_date, dec.status);
  const isCompleted = dec.status === 'completed';

  const deadlineCls = {
    overdue:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    today:      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    approaching:'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    on_time:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    no_deadline:'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    completed:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }[deadlineState];

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
      <td className="px-3 py-3">
        <div className="font-medium text-gray-900 dark:text-white max-w-48 truncate">{dec.title}</div>
        <div className="flex items-center gap-1 mt-0.5">
          {dec.requires_followup && <Flag className="w-3 h-3 text-orange-400" />}
          <DecisionPriorityBadge priority={dec.priority} />
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
        <div className="max-w-32 truncate">{dec.minute_title}</div>
        <div className="text-gray-400">{formatJalaliDateForDisplay(dec.meeting_date_snapshot)}</div>
      </td>
      <td className="px-3 py-3 text-xs text-gray-700 dark:text-gray-300 max-w-24 truncate">{dec.owner_name || '—'}</td>
      <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400 max-w-28 truncate">{dec.responsible_unit_name_snapshot || '—'}</td>
      <td className="px-3 py-3"><DecisionStatusBadge status={dec.status} /></td>
      <td className="px-3 py-3 w-28">
        <div className="flex items-center gap-1.5">
          <DecisionProgressBar percent={dec.progress_percent} />
          <span className="text-xs text-gray-500 whitespace-nowrap">{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-gray-500">{dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</td>
      <td className="px-3 py-3">
        {daysLabel ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${deadlineCls}`}>{daysLabel}</span>
        ) : (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${deadlineCls}`}>{DEADLINE_STATE_LABELS[deadlineState]}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {dec.open_obstacles > 0 ? (
          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            <AlertTriangle className="w-3 h-3" /> {toPersianDigits(String(dec.open_obstacles))}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <button title="جزئیات" onClick={onViewDetail} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <Eye className="w-4 h-4" />
          </button>
          <button title="مشاهده جلسه" onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <SquareArrowUpRight className="w-4 h-4" />
          </button>
          <button title="ثبت پیگیری" onClick={() => onAction('followup')} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
            <Clock className="w-4 h-4" />
          </button>
          <button title="ثبت مانع" onClick={() => onAction('obstacle')} className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-500 transition-colors">
            <AlertTriangle className="w-4 h-4" />
          </button>
          <button title="تغییر وضعیت" onClick={() => onAction('status')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <StopCircle className="w-4 h-4" />
          </button>
          {isCompleted && isAdmin && (
            <button title="بازگشایی" onClick={() => onAction('reopen')} className="p-1.5 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600 transition-colors">
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <button title="ثبت گزارش" onClick={() => onAction('report')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <MessageSquare className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── TrackingMobileCard ────────────────────────────────────────────────────────
function TrackingMobileCard({ dec, isAdmin, onViewDetail, onAction, onNavigate }: TrackRowProps) {
  const deadlineState = getDecisionDeadlineState(dec.due_date, dec.status);
  const daysLabel = formatDecisionDaysLabel(dec.due_date, dec.status);
  const isCompleted = dec.status === 'completed';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm text-gray-900 dark:text-white truncate">{dec.title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{dec.minute_title}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <DecisionPriorityBadge priority={dec.priority} />
          {dec.open_obstacles > 0 && <AlertTriangle className="w-4 h-4 text-orange-400" />}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <DecisionStatusBadge status={dec.status} />
        {daysLabel && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            deadlineState === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
            deadlineState === 'today' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>{daysLabel}</span>
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>مسئول: {dec.owner_name || '—'}</span>
          <span>{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
        <DecisionProgressBar percent={dec.progress_percent} />
      </div>
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-50 dark:border-gray-700">
        <button onClick={onViewDetail} className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center justify-center gap-1">
          <Eye className="w-3.5 h-3.5" /> جزئیات
        </button>
        <button onClick={() => onAction('followup')} className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-blue-600 text-white hover:bg-blue-700 flex items-center justify-center gap-1">
          <Clock className="w-3.5 h-3.5" /> پیگیری
        </button>
        {isCompleted && isAdmin && (
          <button onClick={() => onAction('reopen')} className="px-3 py-1.5 text-xs rounded-xl border border-amber-300 dark:border-amber-700 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 flex items-center gap-1">
            <RotateCcw className="w-3.5 h-3.5" /> بازگشایی
          </button>
        )}
        <button onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }}
          className="p-1.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">
          <SquareArrowUpRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
