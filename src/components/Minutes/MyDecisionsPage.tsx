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
  DECISION_STATUS_LABELS, DEADLINE_STATE_LABELS,
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
    <div className="p-4 sm:p-6 max-w-7xl mx-auto" dir="rtl">
      <PageHeader
        title="مصوبات من"
        description="فهرست مصوباتی که شما مسئول اصلی آن‌ها هستید"
        actions={
          <div className="flex items-center gap-2">
            <MinutesBackButton
              label="بازگشت به صورت‌جلسات و مصوبات"
              onClick={() => onNavigate('minutes-hub')}
            />
            <button onClick={() => { fetchData(offset); fetchSummary(); }} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
              <RefreshCw className="w-4 h-4" /> بازآوری
            </button>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
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
        <div className="text-center py-12">
          <p className="text-red-500 mb-3">{error}</p>
          <button onClick={() => fetchData(offset)} className="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-700">
            تلاش مجدد
          </button>
        </div>
      ) : data.length === 0 ? (
        <EmptyState title="مصوبه‌ای یافت نشد" description={hasFilters ? 'فیلترها را تغییر دهید.' : 'هیچ مصوبه‌ای به شما اختصاص داده نشده است.'} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden lg:block bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
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
          <div className="lg:hidden space-y-3">
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
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-gray-900 dark:text-white max-w-xs truncate">{dec.title}</div>
        {dec.requires_followup && (
          <span className="inline-flex items-center gap-0.5 text-xs text-orange-500 mt-0.5">
            <Flag className="w-3 h-3" /> پیگیری
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 max-w-32 truncate">{dec.minute_title}</div>
        <div className="text-xs text-gray-400 dark:text-gray-500">{formatJalaliDateForDisplay(dec.meeting_date_snapshot)}</div>
      </td>
      <td className="px-4 py-3"><DecisionPriorityBadge priority={dec.priority} /></td>
      <td className="px-4 py-3"><DecisionStatusBadge status={dec.status} /></td>
      <td className="px-4 py-3 w-32">
        <div className="flex items-center gap-2">
          <DecisionProgressBar percent={dec.progress_percent} />
          <span className="text-xs text-gray-500 whitespace-nowrap">{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-gray-500">
        {dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}
      </td>
      <td className="px-4 py-3">
        {daysLabel ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${deadlineBadgeClass}`}>
            {daysLabel}
          </span>
        ) : (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${deadlineBadgeClass}`}>
            {DEADLINE_STATE_LABELS[deadlineState]}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <button title="جزئیات" onClick={onViewDetail} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <Eye className="w-4 h-4" />
          </button>
          <button title="مشاهده جلسه" onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
            <SquareArrowUpRight className="w-4 h-4" />
          </button>
          {!isCompleted && (
            <>
              <button title="به‌روزرسانی مصوبه" onClick={() => onAction('update')} className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                <TrendingUp className="w-4 h-4" />
              </button>
              <button title="ثبت گزارش" onClick={() => onAction('report')} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
                <MessageSquare className="w-4 h-4" />
              </button>
              <button title="ثبت مانع" onClick={() => onAction('obstacle')} className="p-1.5 rounded-lg hover:bg-orange-50 dark:hover:bg-orange-900/20 text-orange-500 transition-colors">
                <AlertTriangle className="w-4 h-4" />
              </button>
              {dec.progress_percent === 100 && (
                <button title="تکمیل مصوبه" onClick={() => onAction('complete')} className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 transition-colors">
                  <CheckCircle2 className="w-4 h-4" />
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
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
      <div className="flex items-start gap-2 justify-between">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{dec.title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">{dec.minute_title}</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <DecisionPriorityBadge priority={dec.priority} />
          {dec.requires_followup && <Flag className="w-3.5 h-3.5 text-orange-500" />}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <DecisionStatusBadge status={dec.status} />
        {daysLabel && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            deadlineState === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
            deadlineState === 'today'   ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' :
            'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
          }`}>{daysLabel}</span>
        )}
      </div>
      <div>
        <div className="flex justify-between text-xs text-gray-400 mb-1">
          <span>پیشرفت</span>
          <span>{toPersianDigits(String(dec.progress_percent))}٪</span>
        </div>
        <DecisionProgressBar percent={dec.progress_percent} />
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span>مهلت: {dec.due_date ? formatJalaliDateForDisplay(dec.due_date) : '—'}</span>
        <span>جلسه: {formatJalaliDateForDisplay(dec.meeting_date_snapshot)}</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-50 dark:border-gray-700">
        <button onClick={onViewDetail} className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors flex items-center justify-center gap-1">
          <Eye className="w-3.5 h-3.5" /> جزئیات
        </button>
        {!isCompleted && (
          <button onClick={() => onAction('update')} className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center justify-center gap-1">
            <TrendingUp className="w-3.5 h-3.5" /> به‌روزرسانی
          </button>
        )}
        <button onClick={() => { setMinuteIdInUrl(dec.minute_id); onNavigate('minutes-detail'); }}
          className="p-1.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          <SquareArrowUpRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
