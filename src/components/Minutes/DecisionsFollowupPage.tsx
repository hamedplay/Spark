import { useState, useEffect, useCallback } from 'react';
import { Search, X, RefreshCw, Eye, TrendingUp, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Flag, ChevronRight, ChevronLeft, MessageSquare, SquareArrowUpRight, ListFilter as Filter, CircleStop as StopCircle, RotateCcw, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, StatCard, DecisionStatusBadge, DecisionPriorityBadge,
  DecisionProgressBar, TableSkeleton, EmptyState,
} from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl } from '../../lib/minutesNavigation';
import { formatJalaliDateForDisplay, formatJalaliTimestamp, toPersianDigits } from '../../lib/minutesDate';
import {
  DECISION_STATUS_LABELS, DECISION_PRIORITY_LABELS,
  DEADLINE_STATE_LABELS, getDecisionDeadlineState, formatDecisionDaysLabel,
  ACTIVE_STATUSES,
} from './decisionHelpers';
import { DecisionActionModal } from './DecisionActionModal';
import { DecisionDetailsDrawer } from './DecisionDetailsDrawer';
import { JalaliDatePicker } from './Form/JalaliDatePicker';
import { SearchableSelect } from './Form/SearchableSelect';
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
  open_obstacle_count: number;
  latest_followup_at: string | null;
}

interface FollowupSummary {
  total_count: number;
  active_count: number;
  completed_count: number;
  stopped_count: number;
  overdue_count: number;
  open_obstacle_count: number;
  requires_followup_count: number;
}

interface SelectOption { value: string; label: string }

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
  const [summary, setSummary]         = useState<FollowupSummary>({ total_count: 0, active_count: 0, completed_count: 0, stopped_count: 0, overdue_count: 0, open_obstacle_count: 0, requires_followup_count: 0 });

  // Filter options
  const [meetingOptions, setMeetingOptions] = useState<SelectOption[]>([]);
  const [unitOptions, setUnitOptions]       = useState<SelectOption[]>([]);
  const [ownerOptions, setOwnerOptions]     = useState<SelectOption[]>([]);

  // Filters
  const [search, setSearch]                 = useState('');
  const [statusFilter, setStatusFilter]     = useState<DecisionStatus | 'all'>('all');
  const [priorityFilter, setPriorityFilter] = useState<DecisionPriority | 'all'>('all');
  const [deadlineFilter, setDeadlineFilter] = useState<DecisionDeadlineState | 'all'>('all');
  const [overdueOnly, setOverdueOnly]       = useState(false);
  const [followupOnly, setFollowupOnly]     = useState(false);
  const [hasObstacle, setHasObstacle]       = useState(false);
  const [meetingFilter, setMeetingFilter]   = useState<string>('');
  const [unitFilter, setUnitFilter]         = useState<string>('');
  const [ownerFilter, setOwnerFilter]       = useState<string>('');
  const [startFrom, setStartFrom]           = useState<string | null>(null);
  const [startTo, setStartTo]               = useState<string | null>(null);
  const [dueFrom, setDueFrom]               = useState<string | null>(null);
  const [dueTo, setDueTo]                   = useState<string | null>(null);

  // Modals
  const [actionDecision, setActionDecision] = useState<FollowupRow | null>(null);
  const [actionType, setActionType]         = useState<ActionType>('progress');
  const [detailDecision, setDetailDecision] = useState<FollowupRow | null>(null);

  // Fetch filter options from trackable decisions scope
  const fetchFilterOptions = useCallback(async () => {
    try {
      const { data: rows, error: rpcErr } = await supabase.rpc('get_trackable_minutes_decisions', {
        p_limit: 1000,
        p_offset: 0,
      });
      if (rpcErr) throw rpcErr;
      const typedRows = (rows || []) as FollowupRow[];

      // Build unique meeting options
      const meetingMap = new Map<string, string>();
      const unitMap = new Map<string, string>();
      const ownerMap = new Map<string, string>();
      for (const r of typedRows) {
        if (r.minute_id && r.minute_title) meetingMap.set(r.minute_id, r.minute_title);
        if (r.responsible_unit_id && r.responsible_unit_name_snapshot) unitMap.set(r.responsible_unit_id, r.responsible_unit_name_snapshot);
        if (r.primary_owner_user_id && r.owner_name) ownerMap.set(r.primary_owner_user_id, r.owner_name);
      }
      setMeetingOptions(Array.from(meetingMap.entries()).map(([value, label]) => ({ value, label })));
      setUnitOptions(Array.from(unitMap.entries()).map(([value, label]) => ({ value, label })));
      setOwnerOptions(Array.from(ownerMap.entries()).map(([value, label]) => ({ value, label })));
    } catch {
      // silent
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const { data: sumData, error: sumErr } = await supabase.rpc('get_trackable_minutes_decisions_summary');
      if (sumErr) throw sumErr;
      const row = Array.isArray(sumData) ? sumData[0] : sumData;
      if (row) {
        setSummary({
          total_count: Number(row.total_count ?? 0),
          active_count: Number(row.active_count ?? 0),
          completed_count: Number(row.completed_count ?? 0),
          stopped_count: Number(row.stopped_count ?? 0),
          overdue_count: Number(row.overdue_count ?? 0),
          open_obstacle_count: Number(row.open_obstacle_count ?? 0),
          requires_followup_count: Number(row.requires_followup_count ?? 0),
        });
      } else {
        setSummary({ total_count: 0, active_count: 0, completed_count: 0, stopped_count: 0, overdue_count: 0, open_obstacle_count: 0, requires_followup_count: 0 });
      }
    } catch {
      // silent
    }
  }, []);

  const fetchData = useCallback(async (currentOffset: number) => {
    setLoading(true);
    setError(null);
    try {
      const { data: rows, error: rpcErr } = await supabase.rpc('get_trackable_minutes_decisions', {
        p_search: search.trim() || null,
        p_meeting_id: meetingFilter || null,
        p_owner_user_id: ownerFilter || null,
        p_responsible_unit_id: unitFilter || null,
        p_status: statusFilter === 'all' ? null : statusFilter,
        p_priority: priorityFilter === 'all' ? null : priorityFilter,
        p_requires_followup: followupOnly ? true : null,
        p_has_open_obstacle: hasObstacle ? true : null,
        p_deadline_state: overdueOnly ? 'overdue' : (deadlineFilter === 'all' ? null : deadlineFilter),
        p_start_from: startFrom,
        p_start_to: startTo,
        p_due_from: dueFrom,
        p_due_to: dueTo,
        p_limit: PAGE_SIZE,
        p_offset: currentOffset,
      });
      if (rpcErr) throw rpcErr;
      const typedRows = (rows || []) as (FollowupRow & { total_count?: number })[];
      setData(typedRows as FollowupRow[]);
      if (typedRows.length > 0 && typedRows[0].total_count !== undefined) {
        setTotal(Number(typedRows[0].total_count));
      } else {
        setTotal(currentOffset + typedRows.length);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری مصوبات');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, priorityFilter, followupOnly, hasObstacle, deadlineFilter, overdueOnly, meetingFilter, ownerFilter, unitFilter, startFrom, startTo, dueFrom, dueTo]);

  useEffect(() => {
    setOffset(0);
  }, [statusFilter, priorityFilter, deadlineFilter, overdueOnly, followupOnly, hasObstacle, meetingFilter, unitFilter, ownerFilter, search, startFrom, startTo, dueFrom, dueTo]);

  useEffect(() => { fetchData(offset); }, [fetchData, offset]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);

  const filtered = data;

  const openAction = (dec: FollowupRow, type: ActionType) => {
    setActionDecision(dec);
    setActionType(type);
  };

  const handleActionSuccess = (updatedAt?: string) => {
    setActionDecision(null);
    fetchData(offset);
    fetchSummary();
    toast.success('عملیات با موفقیت ثبت شد.');
    void updatedAt;
  };

  const resetFilters = () => {
    setSearch(''); setStatusFilter('all'); setPriorityFilter('all');
    setDeadlineFilter('all'); setOverdueOnly(false); setFollowupOnly(false);
    setHasObstacle(false); setMeetingFilter(''); setUnitFilter(''); setOwnerFilter('');
    setStartFrom(null); setStartTo(null); setDueFrom(null); setDueTo(null);
  };

  const hasFilters = search || statusFilter !== 'all' || priorityFilter !== 'all' ||
    deadlineFilter !== 'all' || overdueOnly || followupOnly || hasObstacle ||
    meetingFilter || unitFilter || ownerFilter || startFrom || startTo || dueFrom || dueTo;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHeader
        title="پیگیری مصوبات"
        description="مدیریت و پیگیری وضعیت مصوبات صورت‌جلسات"
        actions={
          <div className="flex items-center gap-2">
            <MinutesBackButton
              label="بازگشت به صورت‌جلسات و مصوبات"
              onClick={() => onNavigate('minutes-hub')}
            />
            <button onClick={() => setShowFilters(s => !s)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border transition-colors ${showFilters ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'} hover:bg-gray-50 dark:hover:bg-gray-800`}>
              <Filter className="w-4 h-4" /> فیلترها
            </button>
            <button onClick={() => { fetchData(offset); fetchSummary(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <StatCard label="کل" value={toPersianDigits(String(summary.total_count ?? 0))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-blue-600 bg-blue-100 dark:bg-blue-900/30" onClick={() => setStatusFilter('all')} />
        <StatCard label="در جریان" value={toPersianDigits(String(summary.active_count ?? 0))} icon={<TrendingUp className="w-5 h-5" />} colorClass="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" onClick={() => setStatusFilter('in_progress')} />
        <StatCard label="تکمیل" value={toPersianDigits(String(summary.completed_count ?? 0))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-green-600 bg-green-100 dark:bg-green-900/30" onClick={() => setStatusFilter('completed')} />
        <StatCard label="متوقف" value={toPersianDigits(String(summary.stopped_count ?? 0))} icon={<StopCircle className="w-5 h-5" />} colorClass="text-gray-600 bg-gray-100 dark:bg-gray-700" onClick={() => setStatusFilter('stopped')} />
        <StatCard label="عقب‌افتاده" value={toPersianDigits(String(summary.overdue_count ?? 0))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-red-600 bg-red-100 dark:bg-red-900/30" onClick={() => { setOverdueOnly(true); setStatusFilter('all'); }} />
        <StatCard label="مانع باز" value={toPersianDigits(String(summary.open_obstacle_count ?? 0))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-orange-600 bg-orange-100 dark:bg-orange-900/30" onClick={() => setHasObstacle(true)} />
        <StatCard label="پیگیری" value={toPersianDigits(String(summary.requires_followup_count ?? 0))} icon={<Flag className="w-5 h-5" />} colorClass="text-purple-600 bg-purple-100 dark:bg-purple-900/30" onClick={() => setFollowupOnly(true)} />
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 mb-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <SearchableSelect
              value={meetingFilter}
              onChange={setMeetingFilter}
              options={meetingOptions}
              placeholder="جلسه"
            />
            <SearchableSelect
              value={unitFilter}
              onChange={setUnitFilter}
              options={unitOptions}
              placeholder="واحد سازمانی"
            />
            <SearchableSelect
              value={ownerFilter}
              onChange={setOwnerFilter}
              options={ownerOptions}
              placeholder="مسئول"
            />
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
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">تاریخ شروع از</span>
              <JalaliDatePicker value={startFrom} onChange={setStartFrom} placeholder="از تاریخ" />
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">تاریخ شروع تا</span>
              <JalaliDatePicker value={startTo} onChange={setStartTo} placeholder="تا تاریخ" />
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">مهلت از</span>
              <JalaliDatePicker value={dueFrom} onChange={setDueFrom} placeholder="از تاریخ" />
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">مهلت تا</span>
              <JalaliDatePicker value={dueTo} onChange={setDueTo} placeholder="تا تاریخ" />
            </div>
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
                    {['عنوان','جلسه','مسئول','واحد','وضعیت','پیشرفت','مهلت','سررسید','مانع','پیگیری','اقدام'].map(h => (
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
        {dec.open_obstacle_count > 0 ? (
          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            <AlertTriangle className="w-3 h-3" /> {toPersianDigits(String(dec.open_obstacle_count))}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-3 text-xs text-gray-500">
        {dec.latest_followup_at ? formatJalaliDateForDisplay(dec.latest_followup_at) : '—'}
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
          {dec.open_obstacle_count > 0 && <AlertTriangle className="w-4 h-4 text-orange-400" />}
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
      <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span>مهلت: {dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</span>
        <span>آخرین پیگیری: {dec.latest_followup_at ? formatJalaliDateForDisplay(dec.latest_followup_at) : '—'}</span>
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
