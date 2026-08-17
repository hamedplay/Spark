import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, TrendingUp, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Flag, ChevronRight, ChevronLeft, MessageSquare, SquareArrowUpRight, CircleStop as StopCircle, RotateCcw, Clock } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, StatCard, DecisionStatusBadge, DecisionPriorityBadge,
  DecisionProgressBar, TableSkeleton, EmptyState,
} from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl } from '../../lib/minutesNavigation';
import { formatJalaliDateForDisplay, toPersianDigits } from '../../lib/minutesDate';
import {
  DEADLINE_STATE_LABELS,
  getDecisionDeadlineState, formatDecisionDaysLabel,
} from './decisionHelpers';
import { DecisionActionModal } from './DecisionActionModal';
import { DecisionDetailsDrawer } from './DecisionDetailsDrawer';
import { DecisionFilters, EMPTY_FILTERS, hasDateRangeValidationError } from './DecisionFilters';
import type { DecisionFilterState } from './DecisionFilters';
import type { SearchableOption } from './Form/SearchableSelect';
import type { DecisionRow } from './types';

interface DecisionsFollowupPageProps {
  onNavigate: (page: string, params?: Record<string, unknown>) => void;
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

const PAGE_SIZE = 25;

type ActionType = import('./DecisionActionModal').ActionType;

export function DecisionsFollowupPage({ onNavigate }: DecisionsFollowupPageProps) {
  const [data, setData]               = useState<FollowupRow[]>([]);
  const [total, setTotal]             = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [offset, setOffset]           = useState(0);
  const [summary, setSummary]         = useState<FollowupSummary>({ total_count: 0, active_count: 0, completed_count: 0, stopped_count: 0, overdue_count: 0, open_obstacle_count: 0, requires_followup_count: 0 });

  // Filter options
  const [meetingOptions, setMeetingOptions] = useState<SearchableOption[]>([]);
  const [unitOptions, setUnitOptions]       = useState<SearchableOption[]>([]);
  const [ownerOptions, setOwnerOptions]     = useState<SearchableOption[]>([]);

  // Filters
  const [filters, setFilters]               = useState<DecisionFilterState>(EMPTY_FILTERS);

  // Modals
  const [actionDecision, setActionDecision] = useState<FollowupRow | null>(null);
  const [actionType, setActionType]         = useState<ActionType>('progress');
  const [detailDecision, setDetailDecision] = useState<FollowupRow | null>(null);

  const updateFilters = (patch: Partial<DecisionFilterState>) => setFilters(f => ({ ...f, ...patch }));

  // Fetch filter options from lightweight distinct RPC
  const fetchFilterOptions = useCallback(async () => {
    try {
      const { data: rows, error: rpcErr } = await supabase.rpc('get_minutes_decision_filter_options');
      if (rpcErr) throw rpcErr;
      const typedRows = (rows || []) as Array<{ option_type: string; option_id: string; option_label: string }>;
      setMeetingOptions(typedRows.filter(r => r.option_type === 'meeting').map(r => ({ value: r.option_id, label: r.option_label })));
      setUnitOptions(typedRows.filter(r => r.option_type === 'unit').map(r => ({ value: r.option_id, label: r.option_label })));
      setOwnerOptions(typedRows.filter(r => r.option_type === 'owner').map(r => ({ value: r.option_id, label: r.option_label })));
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

  const dateRangeError = hasDateRangeValidationError(filters);

  const fetchData = useCallback(async (currentOffset: number) => {
    if (dateRangeError) {
      setData([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: rows, error: rpcErr } = await supabase.rpc('get_trackable_minutes_decisions', {
        p_search: filters.search.trim() || null,
        p_meeting_id: filters.meetingFilter || null,
        p_owner_user_id: filters.ownerFilter || null,
        p_responsible_unit_id: filters.unitFilter || null,
        p_status: filters.statusFilter === 'all' ? null : filters.statusFilter,
        p_priority: filters.priorityFilter === 'all' ? null : filters.priorityFilter,
        p_requires_followup: filters.followupOnly ? true : null,
        p_has_open_obstacle: filters.hasObstacle ? true : null,
        p_deadline_state: filters.overdueOnly ? 'overdue' : (filters.deadlineFilter === 'all' ? null : filters.deadlineFilter),
        p_start_from: filters.startFrom,
        p_start_to: filters.startTo,
        p_due_from: filters.dueFrom,
        p_due_to: filters.dueTo,
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
  }, [filters.search, filters.statusFilter, filters.priorityFilter, filters.followupOnly, filters.hasObstacle, filters.deadlineFilter, filters.overdueOnly, filters.meetingFilter, filters.ownerFilter, filters.unitFilter, filters.startFrom, filters.startTo, filters.dueFrom, filters.dueTo, dateRangeError]);

  // Reset pagination on any filter change
  useEffect(() => {
    setOffset(0);
  }, [filters.statusFilter, filters.priorityFilter, filters.deadlineFilter, filters.overdueOnly, filters.followupOnly, filters.hasObstacle, filters.meetingFilter, filters.unitFilter, filters.ownerFilter, filters.search, filters.startFrom, filters.startTo, filters.dueFrom, filters.dueTo]);

  useEffect(() => { fetchData(offset); }, [fetchData, offset]);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchFilterOptions(); }, [fetchFilterOptions]);

  const openAction = (dec: FollowupRow, type: ActionType) => {
    setActionDecision(dec);
    setActionType(type);
  };

  const handleActionSuccess = (updatedAt?: string) => {
    setActionDecision(null);
    fetchData(offset);
    fetchSummary();
    fetchFilterOptions();
    toast.success('عملیات با موفقیت ثبت شد.');
    void updatedAt;
  };

  const hasFilters = filters.search || filters.statusFilter !== 'all' || filters.priorityFilter !== 'all' ||
    filters.deadlineFilter !== 'all' || filters.overdueOnly || filters.followupOnly || filters.hasObstacle ||
    filters.meetingFilter || filters.unitFilter || filters.ownerFilter || filters.startFrom || filters.startTo || filters.dueFrom || filters.dueTo;

  return (
    <div className="mx-auto max-w-7xl p-0 sm:p-6" dir="rtl">
      <PageHeader
        title="پیگیری مصوبات"
        description="مدیریت و پیگیری وضعیت مصوبات صورت‌جلسات"
        actions={
          <div className="mobile-scroll-actions max-w-full sm:overflow-visible">
            <MinutesBackButton
              label="بازگشت به صورت‌جلسات و مصوبات"
              onClick={() => onNavigate('minutes-hub')}
            />
            <button onClick={() => { fetchData(offset); fetchSummary(); }}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <RefreshCw className="h-4 w-4" /> بازآوری
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:mb-6 sm:grid-cols-4 sm:gap-3 lg:grid-cols-7">
        <StatCard label="کل" value={toPersianDigits(String(summary.total_count ?? 0))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-blue-600 bg-blue-100 dark:bg-blue-900/30" onClick={() => updateFilters({ statusFilter: 'all' })} />
        <StatCard label="در جریان" value={toPersianDigits(String(summary.active_count ?? 0))} icon={<TrendingUp className="w-5 h-5" />} colorClass="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" onClick={() => updateFilters({ statusFilter: 'active', deadlineFilter: 'all', overdueOnly: false, followupOnly: false, hasObstacle: false, dueFrom: null, dueTo: null, search: '', priorityFilter: 'all', meetingFilter: '', unitFilter: '', ownerFilter: '', startFrom: null, startTo: null })} />
        <StatCard label="تکمیل" value={toPersianDigits(String(summary.completed_count ?? 0))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-green-600 bg-green-100 dark:bg-green-900/30" onClick={() => updateFilters({ statusFilter: 'completed' })} />
        <StatCard label="متوقف" value={toPersianDigits(String(summary.stopped_count ?? 0))} icon={<StopCircle className="w-5 h-5" />} colorClass="text-gray-600 bg-gray-100 dark:bg-gray-700" onClick={() => updateFilters({ statusFilter: 'stopped' })} />
        <StatCard label="عقب‌افتاده" value={toPersianDigits(String(summary.overdue_count ?? 0))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-red-600 bg-red-100 dark:bg-red-900/30" onClick={() => { updateFilters({ overdueOnly: true, statusFilter: 'all' }); }} />
        <StatCard label="مانع باز" value={toPersianDigits(String(summary.open_obstacle_count ?? 0))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-orange-600 bg-orange-100 dark:bg-orange-900/30" onClick={() => updateFilters({ hasObstacle: true })} />
        <StatCard label="پیگیری" value={toPersianDigits(String(summary.requires_followup_count ?? 0))} icon={<Flag className="w-5 h-5" />} colorClass="text-purple-600 bg-purple-100 dark:bg-purple-900/30" onClick={() => updateFilters({ followupOnly: true })} />
      </div>

      <DecisionFilters
        filters={filters}
        onChange={updateFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        hasFilters={hasFilters}
        showAdvanced
        meetingOptions={meetingOptions}
        unitOptions={unitOptions}
        ownerOptions={ownerOptions}
        totalResultCount={total}
      />

      {/* Content */}
      {loading ? (
        <TableSkeleton rows={7} />
      ) : error ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-red-500">{error}</p>
          <button onClick={() => fetchData(offset)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">تلاش مجدد</button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState title="مصوبه‌ای یافت نشد" description={hasFilters ? 'فیلترها را تغییر دهید.' : 'هیچ مصوبه‌ای برای پیگیری یافت نشد.'} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800 lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
                  <tr>
                    {['عنوان','جلسه','مسئول','واحد','وضعیت','پیشرفت','مهلت','سررسید','مانع','پیگیری','اقدام'].map(h => (
                      <th key={h} className="px-3 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {data.map(dec => (
                    <TrackingTableRow
                      key={dec.id}
                      dec={dec}
                      isManager={true}
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
          <div className="space-y-2.5 lg:hidden">
            {data.map(dec => (
              <TrackingMobileCard
                key={dec.id}
                dec={dec}
                isManager={true}
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
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {toPersianDigits(String(offset + 1))} تا {toPersianDigits(String(Math.min(offset + data.length, total)))} از {toPersianDigits(String(total))}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(o => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}
              className="rounded-xl border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setOffset(o => o + PAGE_SIZE)} disabled={offset + data.length >= total}
              className="rounded-xl border border-gray-200 p-2 text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <ChevronLeft className="h-4 w-4" />
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
  isManager: boolean;
  onViewDetail: () => void;
  onAction: (t: ActionType) => void;
  onNavigate: (page: string, params?: Record<string, unknown>) => void;
}

function TrackingTableRow({ dec, isManager, onViewDetail, onAction, onNavigate }: TrackRowProps) {
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
    <tr className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <td className="px-3 py-3">
        <div className="max-w-48 truncate font-medium text-gray-900 dark:text-white">{dec.title}</div>
        <div className="mt-0.5 flex items-center gap-1">
          {dec.requires_followup && <Flag className="h-3 w-3 text-orange-400" />}
          <DecisionPriorityBadge priority={dec.priority} />
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-gray-500 dark:text-gray-400">
        <div className="max-w-32 truncate">{dec.minute_title}</div>
        <div className="text-gray-400">{formatJalaliDateForDisplay(dec.meeting_date_snapshot)}</div>
      </td>
      <td className="max-w-24 truncate px-3 py-3 text-xs text-gray-700 dark:text-gray-300">{dec.owner_name || '—'}</td>
      <td className="max-w-28 truncate px-3 py-3 text-xs text-gray-500 dark:text-gray-400">{dec.responsible_unit_name_snapshot || '—'}</td>
      <td className="px-3 py-3"><DecisionStatusBadge status={dec.status} /></td>
      <td className="w-28 px-3 py-3">
        <div className="flex items-center gap-1.5">
          <DecisionProgressBar percent={dec.progress_percent} />
          <span className="whitespace-nowrap text-xs text-gray-500">{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
      </td>
      <td className="px-3 py-3 text-xs text-gray-500">{dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</td>
      <td className="px-3 py-3">
        {daysLabel ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${deadlineCls}`}>{daysLabel}</span>
        ) : (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${deadlineCls}`}>{DEADLINE_STATE_LABELS[deadlineState]}</span>
        )}
      </td>
      <td className="px-3 py-3">
        {dec.open_obstacle_count > 0 ? (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            <AlertTriangle className="h-3 w-3" /> {toPersianDigits(String(dec.open_obstacle_count))}
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-3 text-xs text-gray-500">
        {dec.latest_followup_at ? formatJalaliDateForDisplay(dec.latest_followup_at) : '—'}
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <button title="جزئیات" onClick={onViewDetail} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
            <Eye className="h-4 w-4" />
          </button>
          <button title="مشاهده جلسه" onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
            <SquareArrowUpRight className="h-4 w-4" />
          </button>
          <button title="ثبت پیگیری" onClick={() => onAction('followup')} className="rounded-lg p-1.5 text-blue-500 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20">
            <Clock className="h-4 w-4" />
          </button>
          {isCompleted && isManager && (
            <button title="بازگشایی" onClick={() => onAction('reopen')} className="rounded-lg p-1.5 text-amber-600 transition-colors hover:bg-amber-50 dark:hover:bg-amber-900/20">
              <RotateCcw className="h-4 w-4" />
            </button>
          )}
          <button title="ثبت گزارش" onClick={() => onAction('report')} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── TrackingMobileCard ────────────────────────────────────────────────────────
function TrackingMobileCard({ dec, isManager, onViewDetail, onAction, onNavigate }: TrackRowProps) {
  const deadlineState = getDecisionDeadlineState(dec.due_date, dec.status);
  const daysLabel = formatDecisionDaysLabel(dec.due_date, dec.status);
  const isCompleted = dec.status === 'completed';

  return (
    <article className="space-y-2.5 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="mobile-line-clamp-2 text-sm font-semibold leading-6 text-gray-900 dark:text-white">{dec.title}</h3>
          <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">{dec.minute_title}</p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <DecisionPriorityBadge priority={dec.priority} />
          {dec.open_obstacle_count > 0 && (
            <span title={`${toPersianDigits(String(dec.open_obstacle_count))} مانع باز`} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-orange-50 text-orange-500 dark:bg-orange-900/20">
              <AlertTriangle className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <DecisionStatusBadge status={dec.status} />
        {daysLabel && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            deadlineState === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
            deadlineState === 'today' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>{daysLabel}</span>
        )}
        {dec.requires_followup && (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] text-purple-600 dark:bg-purple-900/20 dark:text-purple-300">
            <Flag className="h-3 w-3" /> پیگیری
          </span>
        )}
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px] text-gray-500 dark:text-gray-400">
          <span className="min-w-0 truncate">مسئول: {dec.owner_name || '—'}</span>
          <span className="flex-shrink-0 font-semibold">{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
        <DecisionProgressBar percent={dec.progress_percent} />
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 px-2.5 py-2 text-[10px] text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">
        <div className="min-w-0">
          <span className="block text-gray-400 dark:text-gray-500">مهلت</span>
          <span className="truncate">{dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</span>
        </div>
        <div className="min-w-0">
          <span className="block text-gray-400 dark:text-gray-500">آخرین پیگیری</span>
          <span className="truncate">{dec.latest_followup_at ? formatJalaliDateForDisplay(dec.latest_followup_at) : '—'}</span>
        </div>
      </div>

      {/* All desktop actions remain reachable on touch devices. The row scrolls
          horizontally on very narrow devices instead of silently dropping actions. */}
      <div className="mobile-scroll-actions border-t border-gray-100 pt-2 dark:border-gray-700">
        <button onClick={() => onAction('followup')} title="ثبت پیگیری"
          className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700">
          <Clock className="h-4 w-4" /> پیگیری
        </button>
        <button onClick={() => onAction('report')} title="ثبت گزارش"
          className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          <MessageSquare className="h-4 w-4" /> گزارش
        </button>
        <button onClick={onViewDetail} title="جزئیات" aria-label="جزئیات"
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          <Eye className="h-4 w-4" />
        </button>
        <button onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }} title="مشاهده صورت‌جلسه" aria-label="مشاهده صورت‌جلسه"
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          <SquareArrowUpRight className="h-4 w-4" />
        </button>
        {isCompleted && isManager && (
          <button onClick={() => onAction('reopen')} title="بازگشایی" aria-label="بازگشایی"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:hover:bg-amber-900/20">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>
    </article>
  );
}
