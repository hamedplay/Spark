/**
 * Shared pure helpers for the decisions feature.
 * No React imports — safe to use in services and tests.
 */
import type { DecisionStatus, DecisionPriority, DecisionDeadlineState } from './types';
import { toPersianDigits } from '../../lib/minutesDate';

// ── Labels ───────────────────────────────────────────────────────────────────

export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = {
  not_started:          'شروع نشده',
  planned:              'برنامه‌ریزی‌شده',
  in_progress:          'در حال انجام',
  waiting_coordination: 'منتظر هماهنگی',
  waiting_approval:     'منتظر تأیید',
  completed:            'تکمیل‌شده',
  stopped:              'متوقف‌شده',
};

export const DECISION_PRIORITY_LABELS: Record<DecisionPriority, string> = {
  low:       'کم',
  normal:    'عادی',
  important: 'مهم',
  urgent:    'فوری',
};

export const DEADLINE_STATE_LABELS: Record<DecisionDeadlineState, string> = {
  no_deadline: 'بدون مهلت',
  on_time:     'در موعد',
  approaching: 'نزدیک سررسید',
  today:       'امروز',
  overdue:     'عقب‌افتاده',
  completed:   'تکمیل‌شده',
};

export const DECISION_EVENT_TYPE_LABELS: Record<string, string> = {
  progress:          'به‌روزرسانی پیشرفت',
  status_change:     'تغییر وضعیت',
  report:            'گزارش',
  obstacle:          'ثبت مانع',
  obstacle_resolved: 'رفع مانع',
  followup:          'پیگیری',
  completion:        'تکمیل',
  reopened:          'بازگشایی',
};

// ── Active statuses (for "در حال انجام" stat card) ──────────────────────────

export const ACTIVE_STATUSES: ReadonlySet<DecisionStatus> = new Set([
  'in_progress', 'planned', 'waiting_coordination', 'waiting_approval',
]);

// ── Deadline state ────────────────────────────────────────────────────────────

/**
 * Compute deadline state relative to Tehran timezone today.
 * Approaching = 1-3 days remaining.
 */
export function getDecisionDeadlineState(
  dueDate: string | null | undefined,
  status: DecisionStatus,
): DecisionDeadlineState {
  if (status === 'completed') return 'completed';
  if (!dueDate) return 'no_deadline';
  const todayStr = getTehranToday();
  if (dueDate < todayStr) return 'overdue';
  if (dueDate === todayStr) return 'today';
  const daysLeft = getDecisionRemainingDays(dueDate);
  if (daysLeft !== null && daysLeft <= 3) return 'approaching';
  return 'on_time';
}

/** Days remaining until due date (Tehran calendar day). Negative = overdue. */
export function getDecisionRemainingDays(dueDate: string | null | undefined): number | null {
  if (!dueDate) return null;
  const todayStr = getTehranToday();
  const diff = daysBetween(todayStr, dueDate);
  return diff;
}

export function isDecisionOverdue(dueDate: string | null | undefined, status: DecisionStatus): boolean {
  if (!dueDate || status === 'completed' || status === 'stopped') return false;
  return dueDate < getTehranToday();
}

/** YYYY-MM-DD of today in Asia/Tehran. */
function getTehranToday(): string {
  const seg = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tehran',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return seg; // already YYYY-MM-DD in en-CA
}

/** Number of days from `from` to `to` (YYYY-MM-DD strings). Positive = future. */
function daysBetween(from: string, to: string): number {
  const msPerDay = 86400000;
  return Math.round((Date.parse(to) - Date.parse(from)) / msPerDay);
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Format remaining/overdue days as a Persian string. */
export function formatDecisionDaysLabel(
  dueDate: string | null | undefined,
  status: DecisionStatus,
): string {
  if (status === 'completed') return '';
  if (!dueDate) return '';
  const days = getDecisionRemainingDays(dueDate);
  if (days === null) return '';
  if (days === 0) return 'امروز';
  if (days > 0) return toPersianDigits(String(days)) + ' روز مانده';
  return toPersianDigits(String(Math.abs(days))) + ' روز تأخیر';
}
