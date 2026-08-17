import { useMemo, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import {
  DECISION_STATUS_LABELS, DECISION_PRIORITY_LABELS,
  DEADLINE_STATE_LABELS,
} from './decisionHelpers';
import { JalaliDatePicker } from './Form/JalaliDatePicker';
import { SearchableSelect } from './Form/SearchableSelect';
import type { SearchableOption } from './Form/SearchableSelect';
import type { DecisionStatus, DecisionPriority, DecisionDeadlineState } from './types';

export type StatusFilterValue = DecisionStatus | 'all' | 'active';

export interface DecisionFilterState {
  search: string;
  statusFilter: StatusFilterValue;
  priorityFilter: DecisionPriority | 'all';
  deadlineFilter: DecisionDeadlineState | 'all';
  followupOnly: boolean;
  dueFrom: string | null;
  dueTo: string | null;
  // Followup-only filters
  overdueOnly: boolean;
  hasObstacle: boolean;
  meetingFilter: string;
  unitFilter: string;
  ownerFilter: string;
  startFrom: string | null;
  startTo: string | null;
}

export const EMPTY_FILTERS: DecisionFilterState = {
  search: '',
  statusFilter: 'all',
  priorityFilter: 'all',
  deadlineFilter: 'all',
  followupOnly: false,
  dueFrom: null,
  dueTo: null,
  overdueOnly: false,
  hasObstacle: false,
  meetingFilter: '',
  unitFilter: '',
  ownerFilter: '',
  startFrom: null,
  startTo: null,
};

const STATUS_OPTIONS: Array<{ value: StatusFilterValue; label: string }> = [
  { value: 'all', label: 'همه وضعیت‌ها' },
  { value: 'active', label: 'در جریان (همه وضعیت‌های باز)' },
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
  { value: 'today', label: DEADLINE_STATE_LABELS.today },
  { value: 'this_week', label: DEADLINE_STATE_LABELS.this_week },
  { value: 'next_7_days', label: DEADLINE_STATE_LABELS.next_7_days },
  { value: 'approaching', label: DEADLINE_STATE_LABELS.approaching },
  { value: 'overdue', label: DEADLINE_STATE_LABELS.overdue },
  { value: 'on_time', label: DEADLINE_STATE_LABELS.on_time },
  { value: 'no_deadline', label: DEADLINE_STATE_LABELS.no_deadline },
  { value: 'completed', label: DEADLINE_STATE_LABELS.completed },
];

const selectCls = 'w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40';

export function hasDateRangeValidationError(filters: DecisionFilterState): boolean {
  const dueError = filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo;
  const startError = filters.startFrom && filters.startTo && filters.startFrom > filters.startTo;
  return Boolean(dueError || startError);
}

interface DecisionFiltersProps {
  filters: DecisionFilterState;
  onChange: (patch: Partial<DecisionFilterState>) => void;
  onReset: () => void;
  hasFilters: boolean;
  /** Show manager-only advanced filters (meeting/unit/owner/obstacle/start dates) */
  showAdvanced?: boolean;
  /** Options for SearchableSelect dropdowns (followup page only) */
  meetingOptions?: SearchableOption[];
  unitOptions?: SearchableOption[];
  ownerOptions?: SearchableOption[];
  /** Total result count from server */
  totalResultCount?: number;
}

export function DecisionFilters({
  filters, onChange, onReset, hasFilters,
  showAdvanced = false,
  meetingOptions = [], unitOptions = [], ownerOptions = [],
  totalResultCount,
}: DecisionFiltersProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const dateRangeError = filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo
    ? 'تاریخ «از» نمی‌تواند بعد از «تا» باشد.'
    : null;
  const startDateRangeError = filters.startFrom && filters.startTo && filters.startFrom > filters.startTo
    ? 'تاریخ «از» نمی‌تواند بعد از «تا» باشد.'
    : null;

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.search.trim()) count += 1;
    if (filters.statusFilter !== 'all') count += 1;
    if (filters.priorityFilter !== 'all') count += 1;
    if (filters.deadlineFilter !== 'all') count += 1;
    if (filters.followupOnly) count += 1;
    if (filters.overdueOnly) count += 1;
    if (filters.hasObstacle) count += 1;
    if (filters.meetingFilter) count += 1;
    if (filters.unitFilter) count += 1;
    if (filters.ownerFilter) count += 1;
    if (filters.dueFrom || filters.dueTo) count += 1;
    if (filters.startFrom || filters.startTo) count += 1;
    return count;
  }, [filters]);

  return (
    <div className="mb-4 rounded-2xl border border-gray-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-4">
      {/* Mobile filter launcher: keep the long form out of the reading flow. */}
      <div className="flex items-center gap-2 sm:hidden">
        <button
          type="button"
          onClick={() => setMobileExpanded(v => !v)}
          aria-expanded={mobileExpanded}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 text-sm font-semibold text-gray-700 dark:bg-gray-700/70 dark:text-gray-200"
        >
          <span className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 flex-shrink-0 text-blue-500" />
            <span>فیلترها</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold text-white">
                {activeFilterCount.toLocaleString('fa-IR')}
              </span>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${mobileExpanded ? 'rotate-180' : ''}`} />
        </button>

        {hasFilters ? (
          <button
            type="button"
            onClick={onReset}
            aria-label="پاک‌کردن فیلترها"
            title="پاک‌کردن فیلترها"
            className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-red-200 text-red-500 dark:border-red-900/60 dark:text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        ) : totalResultCount !== undefined ? (
          <span className="flex-shrink-0 whitespace-nowrap text-[11px] text-gray-400 dark:text-gray-500">
            {totalResultCount.toLocaleString('fa-IR')} نتیجه
          </span>
        ) : null}
      </div>

      <div className={`${mobileExpanded ? 'mt-3 block' : 'hidden'} space-y-3 sm:mt-0 sm:block`}>
        {/* Row 1: search + selects */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="جست‌وجوی عنوان مصوبه یا جلسه..."
              value={filters.search}
              onChange={e => onChange({ search: e.target.value })}
              className="w-full rounded-xl border border-gray-200 py-2.5 pl-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <select value={filters.statusFilter} onChange={e => onChange({ statusFilter: e.target.value as StatusFilterValue })} className={selectCls}>
            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.priorityFilter} onChange={e => onChange({ priorityFilter: e.target.value as DecisionPriority | 'all' })} className={selectCls}>
            {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={filters.deadlineFilter} onChange={e => onChange({ deadlineFilter: e.target.value as DecisionDeadlineState | 'all' })} className={selectCls}>
            {DEADLINE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        {/* Compact dates + boolean chips */}
        <div className="space-y-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3 sm:space-y-0">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <div>
              <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400 sm:hidden">مهلت از</span>
              <div className="sm:w-36"><JalaliDatePicker value={filters.dueFrom} onChange={v => onChange({ dueFrom: v })} placeholder="مهلت از" /></div>
            </div>
            <div>
              <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400 sm:hidden">مهلت تا</span>
              <div className="sm:w-36"><JalaliDatePicker value={filters.dueTo} onChange={v => onChange({ dueTo: v })} placeholder="مهلت تا" /></div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors ${filters.followupOnly ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>
              <input type="checkbox" checked={filters.followupOnly} onChange={e => onChange({ followupOnly: e.target.checked })} className="h-4 w-4 rounded accent-blue-600" />
              نیازمند پیگیری
            </label>
            {showAdvanced && (
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors ${filters.overdueOnly ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>
                <input type="checkbox" checked={filters.overdueOnly} onChange={e => onChange({ overdueOnly: e.target.checked })} className="h-4 w-4 rounded accent-blue-600" />
                عقب‌افتاده
              </label>
            )}
            {showAdvanced && (
              <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors ${filters.hasObstacle ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-300' : 'border-gray-200 text-gray-600 dark:border-gray-600 dark:text-gray-400'}`}>
                <input type="checkbox" checked={filters.hasObstacle} onChange={e => onChange({ hasObstacle: e.target.checked })} className="h-4 w-4 rounded accent-blue-600" />
                مانع باز
              </label>
            )}
          </div>

          <div className="hidden sm:mr-auto sm:flex sm:items-center sm:gap-3">
            {hasFilters && (
              <button onClick={onReset} className="flex items-center gap-1 text-sm text-red-500 transition-colors hover:text-red-700">
                <X className="h-3.5 w-3.5" /> پاک‌کردن فیلترها
              </button>
            )}
            {totalResultCount !== undefined && (
              <span className="text-xs text-gray-400 dark:text-gray-500">{totalResultCount.toLocaleString('fa-IR')} نتیجه</span>
            )}
          </div>
        </div>

        {dateRangeError && <span className="block text-xs text-red-500">{dateRangeError}</span>}

        {/* Advanced section: meeting/unit/owner/start dates (followup page only) */}
        {showAdvanced && (
          <div className="space-y-2.5 border-t border-gray-100 pt-3 dark:border-gray-700/60">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              <SearchableSelect id="filter-meeting" value={filters.meetingFilter} onChange={v => onChange({ meetingFilter: v })} options={meetingOptions} placeholder="جلسه" />
              <SearchableSelect id="filter-unit" value={filters.unitFilter} onChange={v => onChange({ unitFilter: v })} options={unitOptions} placeholder="واحد سازمانی" />
              <SearchableSelect id="filter-owner" value={filters.ownerFilter} onChange={v => onChange({ ownerFilter: v })} options={ownerOptions} placeholder="مسئول" />
            </div>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">شروع از</span>
                <JalaliDatePicker value={filters.startFrom} onChange={v => onChange({ startFrom: v })} placeholder="از تاریخ" />
              </div>
              <div>
                <span className="mb-1 block text-[11px] text-gray-500 dark:text-gray-400">شروع تا</span>
                <JalaliDatePicker value={filters.startTo} onChange={v => onChange({ startTo: v })} placeholder="تا تاریخ" />
              </div>
            </div>
            {startDateRangeError && <span className="block text-xs text-red-500">{startDateRangeError}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
