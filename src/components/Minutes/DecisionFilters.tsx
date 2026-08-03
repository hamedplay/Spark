import { Search, X } from 'lucide-react';
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

const selectCls = 'px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40';

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
  const dateRangeError = filters.dueFrom && filters.dueTo && filters.dueFrom > filters.dueTo
    ? 'تاریخ «از» نمی‌تواند بعد از «تا» باشد.'
    : null;
  const startDateRangeError = filters.startFrom && filters.startTo && filters.startFrom > filters.startTo
    ? 'تاریخ «از» نمی‌تواند بعد از «تا» باشد.'
    : null;


  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 mb-4 space-y-3">
      {/* Row 1: search + selects */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="جست‌وجوی عنوان مصوبه یا جلسه..."
            value={filters.search}
            onChange={e => onChange({ search: e.target.value })}
            className="w-full pr-9 pl-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
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

      {/* Row 2: date range + checkboxes */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500 dark:text-gray-400">مهلت از:</span>
          <div className="w-36"><JalaliDatePicker value={filters.dueFrom} onChange={v => onChange({ dueFrom: v })} placeholder="از تاریخ" /></div>
          <span className="text-sm text-gray-500 dark:text-gray-400">تا:</span>
          <div className="w-36"><JalaliDatePicker value={filters.dueTo} onChange={v => onChange({ dueTo: v })} placeholder="تا تاریخ" /></div>
        </div>
        {dateRangeError && (
          <span className="text-xs text-red-500">{dateRangeError}</span>
        )}
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
          <input type="checkbox" checked={filters.followupOnly} onChange={e => onChange({ followupOnly: e.target.checked })} className="w-4 h-4 rounded accent-blue-600" />
          فقط نیازمند پیگیری
        </label>
        {showAdvanced && (
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={filters.overdueOnly} onChange={e => onChange({ overdueOnly: e.target.checked })} className="w-4 h-4 rounded accent-blue-600" />
            عقب‌افتاده
          </label>
        )}
        {showAdvanced && (
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" checked={filters.hasObstacle} onChange={e => onChange({ hasObstacle: e.target.checked })} className="w-4 h-4 rounded accent-blue-600" />
            دارای مانع باز
          </label>
        )}
        {hasFilters && (
          <button onClick={onReset} className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700 transition-colors mr-auto">
            <X className="w-3.5 h-3.5" /> پاک‌کردن فیلترها
          </button>
        )}
        {!hasFilters && totalResultCount !== undefined && (
          <span className="text-xs text-gray-400 dark:text-gray-500 mr-auto">
            {totalResultCount.toLocaleString('fa-IR')} نتیجه
          </span>
        )}
      </div>

      {/* Advanced section: meeting/unit/owner/start dates (followup page only) */}
      {showAdvanced && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-gray-50 dark:border-gray-700/50">
            <SearchableSelect id="filter-meeting" value={filters.meetingFilter} onChange={v => onChange({ meetingFilter: v })} options={meetingOptions} placeholder="جلسه" />
            <SearchableSelect id="filter-unit" value={filters.unitFilter} onChange={v => onChange({ unitFilter: v })} options={unitOptions} placeholder="واحد سازمانی" />
            <SearchableSelect id="filter-owner" value={filters.ownerFilter} onChange={v => onChange({ ownerFilter: v })} options={ownerOptions} placeholder="مسئول" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">تاریخ شروع از</span>
              <JalaliDatePicker value={filters.startFrom} onChange={v => onChange({ startFrom: v })} placeholder="از تاریخ" />
            </div>
            <div>
              <span className="text-xs text-gray-500 dark:text-gray-400 block mb-1">تاریخ شروع تا</span>
              <JalaliDatePicker value={filters.startTo} onChange={v => onChange({ startTo: v })} placeholder="تا تاریخ" />
            </div>
          </div>
          {startDateRangeError && (
            <span className="text-xs text-red-500">{startDateRangeError}</span>
          )}
        </>
      )}
    </div>
  );
}
