import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Eye, TrendingUp, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, Flag, ChevronRight, ChevronLeft, MessageSquare, SquareArrowUpRight, ListChecks, CirclePause as PauseCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  PageHeader, StatCard, DecisionStatusBadge, DecisionPriorityBadge,
  DecisionProgressBar, TableSkeleton, EmptyState,
} from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl } from '../../lib/minutesNavigation';
import {
  formatJalaliDateForDisplay, toPersianDigits,
} from '../../lib/minutesDate';
import {
  DEADLINE_STATE_LABELS,
  getDecisionDeadlineState, formatDecisionDaysLabel,
} from './decisionHelpers';
import { DecisionActionModal } from './DecisionActionModal';
import { DecisionDetailsDrawer } from './DecisionDetailsDrawer';
import { DecisionFilters, EMPTY_FILTERS, hasDateRangeValidationError } from './DecisionFilters';
import type { DecisionFilterState } from './DecisionFilters';
import type { MyDecisionRow } from './types';

interface MyDecisionsPageProps {
  onNavigate: (page: string, params?: Record<string, unknown>) => void;
}

const PAGE_SIZE = 20;

type ActionType = import('./DecisionActionModal').ActionType;

interface MyDecisionsSummary {
  total_count: number;
  active_count: number;
  completed_count: number;
  stopped_count: number;
  overdue_count: number;
}

export function MyDecisionsPage({ onNavigate }: MyDecisionsPageProps) {
  const [data, setData]                         = useState<MyDecisionRow[]>([]);
  const [total, setTotal]                       = useState(0);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [offset, setOffset]                     = useState(0);
  const [summary, setSummary]                   = useState<MyDecisionsSummary>({ total_count: 0, active_count: 0, completed_count: 0, stopped_count: 0, overdue_count: 0 });

  const [filters, setFilters]                   = useState<DecisionFilterState>(EMPTY_FILTERS);

  // Modals
  const [actionDecision, setActionDecision]     = useState<MyDecisionRow | null>(null);
  const [actionType, setActionType]             = useState<ActionType>('progress');
  const [detailDecision, setDetailDecision]     = useState<MyDecisionRow | null>(null);

  const updateFilters = (patch: Partial<DecisionFilterState>) => setFilters(f => ({ ...f, ...patch }));

  const fetchSummary = useCallback(async () => {
    try {
      const { data: sumData, error: sumErr } = await supabase.rpc('get_my_minutes_decisions_summary');
      if (sumErr) throw sumErr;
      const row = Array.isArray(sumData) ? sumData[0] : sumData;
      if (row) {
        setSummary({
          total_count: Number(row.total_count ?? 0),
          active_count: Number(row.active_count ?? 0),
          completed_count: Number(row.completed_count ?? 0),
          stopped_count: Number(row.stopped_count ?? 0),
          overdue_count: Number(row.overdue_count ?? 0),
        });
      } else {
        setSummary({ total_count: 0, active_count: 0, completed_count: 0, stopped_count: 0, overdue_count: 0 });
      }
    } catch {
      // silent — stats just stay stale
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
      const { data: rows, error: rpcErr } = await supabase.rpc('get_my_minutes_decisions', {
        p_status: filters.statusFilter === 'all' ? null : filters.statusFilter,
        p_priority: filters.priorityFilter === 'all' ? null : filters.priorityFilter,
        p_search: filters.search.trim() || null,
        p_requires_followup: filters.followupOnly ? true : null,
        p_deadline_state: filters.deadlineFilter === 'all' ? null : filters.deadlineFilter,
        p_due_from: filters.dueFrom,
        p_due_to: filters.dueTo,
        p_limit:  PAGE_SIZE,
        p_offset: currentOffset,
      });
      if (rpcErr) throw rpcErr;
      const typedRows = (rows || []) as (MyDecisionRow & { total_count?: number })[];
      setData(typedRows as MyDecisionRow[]);
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
  }, [filters.statusFilter, filters.priorityFilter, filters.search, filters.followupOnly, filters.deadlineFilter, filters.dueFrom, filters.dueTo, dateRangeError]);

  // Reset pagination on any filter change
  useEffect(() => {
    setOffset(0);
  }, [filters.statusFilter, filters.search, filters.priorityFilter, filters.deadlineFilter, filters.followupOnly, filters.dueFrom, filters.dueTo]);

  useEffect(() => {
    fetchData(offset);
  }, [fetchData, offset]);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const openAction = (dec: MyDecisionRow, type: ActionType) => {
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

  const hasFilters = filters.search || filters.statusFilter !== 'all' || filters.priorityFilter !== 'all' || filters.deadlineFilter !== 'all' || filters.followupOnly || filters.dueFrom || filters.dueTo;

  return (
    <div className="mx-auto max-w-7xl p-0 sm:p-6" dir="rtl">
      <PageHeader
        title="مصوبات من"
        description="فهرست مصوباتی که شما مسئول اصلی آن‌ها هستید"
        actions={
          <div className="mobile-scroll-actions max-w-full sm:overflow-visible">
            <MinutesBackButton
              label="بازگشت به صورت‌جلسات و مصوبات"
              onClick={() => onNavigate('minutes-hub')}
            />
            <button onClick={() => { fetchData(offset); fetchSummary(); }} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800">
              <RefreshCw className="h-4 w-4" /> بازآوری
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:mb-6 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5">
        <StatCard label="کل مصوبات" value={toPersianDigits(String(summary.total_count ?? 0))} icon={<ListChecks className="w-5 h-5" />} colorClass="text-blue-600 bg-blue-100 dark:bg-blue-900/30" onClick={() => updateFilters({ statusFilter: 'all' })} />
        <StatCard label="در جریان" value={toPersianDigits(String(summary.active_count ?? 0))} icon={<TrendingUp className="w-5 h-5" />} colorClass="text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30" onClick={() => updateFilters({ statusFilter: 'active', deadlineFilter: 'all', followupOnly: false, dueFrom: null, dueTo: null, search: '', priorityFilter: 'all' })} />
        <StatCard label="تکمیل‌شده" value={toPersianDigits(String(summary.completed_count ?? 0))} icon={<CheckCircle2 className="w-5 h-5" />} colorClass="text-green-600 bg-green-100 dark:bg-green-900/30" onClick={() => updateFilters({ statusFilter: 'completed' })} />
        <StatCard label="متوقف‌شده" value={toPersianDigits(String(summary.stopped_count ?? 0))} icon={<PauseCircle className="w-5 h-5" />} colorClass="text-gray-600 bg-gray-100 dark:bg-gray-700" onClick={() => updateFilters({ statusFilter: 'stopped' })} />
        <StatCard label="دارای تأخیر" value={toPersianDigits(String(summary.overdue_count ?? 0))} icon={<AlertTriangle className="w-5 h-5" />} colorClass="text-red-600 bg-red-100 dark:bg-red-900/30" onClick={() => updateFilters({ deadlineFilter: 'overdue' })} />
      </div>

      <DecisionFilters
        filters={filters}
        onChange={updateFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        hasFilters={hasFilters}
        totalResultCount={total}
      />

      {/* Content */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : error ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-red-500">{error}</p>
          <button onClick={() => fetchData(offset)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700">
            تلاش مجدد
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState title="مصوبه‌ای یافت نشد" description={hasFilters ? 'فیلترها را تغییر دهید.' : 'هیچ مصوبه‌ای به شما اختصاص داده نشده است.'} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-hidden rounded-2xl border border-gray-100 bg-white dark:border-gray-700 dark:bg-gray-800 lg:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-100 bg-gray-50 dark:border-gray-700 dark:bg-gray-700/50">
                  <tr>
                    {['عنوان مصوبه','جلسه','اولویت','وضعیت','پیشرفت','مهلت','سررسید','اقدام'].map(h => (
                      <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {data.map(dec => (
                    <DecisionTableRow
                      key={dec.id}
                      dec={dec}
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
              <DecisionMobileCard
                key={dec.id}
                dec={dec}
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
          isManager={false}
          onClose={() => setActionDecision(null)}
          onSuccess={handleActionSuccess}
        />
      )}

      {/* Detail drawer */}
      {detailDecision && (
        <DecisionDetailsDrawer
          decision={detailDecision}
          onClose={() => setDetailDecision(null)}
        />
      )}
    </div>
  );
}

// ── DecisionTableRow ──────────────────────────────────────────────────────────
interface RowProps {
  dec: MyDecisionRow;
  onViewDetail: () => void;
  onAction: (t: ActionType) => void;
  onNavigate: (page: string, params?: Record<string, unknown>) => void;
}

function DecisionTableRow({ dec, onViewDetail, onAction, onNavigate }: RowProps) {
  const deadlineState = getDecisionDeadlineState(dec.due_date, dec.status);
  const daysLabel = formatDecisionDaysLabel(dec.due_date, dec.status);
  const isCompleted = dec.status === 'completed';

  const deadlineBadgeClass = {
    overdue:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    today:      'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    approaching:'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    on_time:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    no_deadline:'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
    completed:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  }[deadlineState];

  return (
    <tr className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30">
      <td className="px-4 py-3">
        <div className="max-w-xs truncate font-medium text-gray-900 dark:text-white">{dec.title}</div>
        {dec.requires_followup && (
          <span className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-orange-500">
            <Flag className="h-3 w-3" /> پیگیری
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="max-w-32 truncate text-xs text-gray-500 dark:text-gray-400">{dec.minute_title}</div>
        <div className="text-xs text-gray-400 dark:text-gray-500">{formatJalaliDateForDisplay(dec.meeting_date_snapshot)}</div>
      </td>
      <td className="px-4 py-3"><DecisionPriorityBadge priority={dec.priority} /></td>
      <td className="px-4 py-3"><DecisionStatusBadge status={dec.status} /></td>
      <td className="w-32 px-4 py-3">
        <div className="flex items-center gap-2">
          <DecisionProgressBar percent={dec.progress_percent} />
          <span className="whitespace-nowrap text-xs text-gray-500">{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}
      </td>
      <td className="px-4 py-3">
        {daysLabel ? (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${deadlineBadgeClass}`}>
            {daysLabel}
          </span>
        ) : (
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${deadlineBadgeClass}`}>
            {DEADLINE_STATE_LABELS[deadlineState]}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button title="جزئیات" onClick={onViewDetail} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
            <Eye className="h-4 w-4" />
          </button>
          <button title="مشاهده جلسه" onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }}
            className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
            <SquareArrowUpRight className="h-4 w-4" />
          </button>
          {!isCompleted && (
            <>
              <button title="به‌روزرسانی مصوبه" onClick={() => onAction('update')} className="rounded-lg p-1.5 text-blue-500 transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20">
                <TrendingUp className="h-4 w-4" />
              </button>
              <button title="ثبت گزارش" onClick={() => onAction('report')} className="rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700">
                <MessageSquare className="h-4 w-4" />
              </button>
              <button title="ثبت مانع" onClick={() => onAction('obstacle')} className="rounded-lg p-1.5 text-orange-500 transition-colors hover:bg-orange-50 dark:hover:bg-orange-900/20">
                <AlertTriangle className="h-4 w-4" />
              </button>
              {dec.progress_percent === 100 && (
                <button title="تکمیل مصوبه" onClick={() => onAction('complete')} className="rounded-lg p-1.5 text-green-600 transition-colors hover:bg-green-50 dark:hover:bg-green-900/20">
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              )}
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── DecisionMobileCard ────────────────────────────────────────────────────────
function DecisionMobileCard({ dec, onViewDetail, onAction, onNavigate }: RowProps) {
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
          {dec.requires_followup && <Flag className="h-3.5 w-3.5 text-orange-500" />}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <DecisionStatusBadge status={dec.status} />
        {daysLabel && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
            deadlineState === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
            deadlineState === 'today'   ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>{daysLabel}</span>
        )}
      </div>

      <div>
        <div className="mb-1 flex justify-between text-[11px] text-gray-400">
          <span>پیشرفت</span>
          <span>{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
        <DecisionProgressBar percent={dec.progress_percent} />
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-xl bg-gray-50 px-2.5 py-2 text-[10px] text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">
        <span>مهلت: {dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</span>
        <span>جلسه: {formatJalaliDateForDisplay(dec.meeting_date_snapshot)}</span>
      </div>

      {/* Mobile parity with desktop actions: nothing important is hidden. */}
      <div className="mobile-scroll-actions border-t border-gray-100 pt-2 dark:border-gray-700">
        {!isCompleted && (
          <button onClick={() => onAction('update')} title="به‌روزرسانی مصوبه"
            className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-medium text-white hover:bg-blue-700">
            <TrendingUp className="h-4 w-4" /> به‌روزرسانی
          </button>
        )}
        {!isCompleted && (
          <button onClick={() => onAction('report')} title="ثبت گزارش"
            className="inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-xl border border-gray-200 px-3 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
            <MessageSquare className="h-4 w-4" /> گزارش
          </button>
        )}
        {!isCompleted && (
          <button onClick={() => onAction('obstacle')} title="ثبت مانع"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-orange-200 text-orange-500 hover:bg-orange-50 dark:border-orange-800 dark:hover:bg-orange-900/20">
            <AlertTriangle className="h-4 w-4" />
          </button>
        )}
        {!isCompleted && dec.progress_percent === 100 && (
          <button onClick={() => onAction('complete')} title="تکمیل مصوبه"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-green-200 text-green-600 hover:bg-green-50 dark:border-green-800 dark:hover:bg-green-900/20">
            <CheckCircle2 className="h-4 w-4" />
          </button>
        )}
        <button onClick={onViewDetail} title="جزئیات" aria-label="جزئیات"
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          <Eye className="h-4 w-4" />
        </button>
        <button onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }} title="مشاهده صورت‌جلسه" aria-label="مشاهده صورت‌جلسه"
          className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700">
          <SquareArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
