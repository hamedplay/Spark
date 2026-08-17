import React from 'react';
import moment from 'moment-jalaali';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

export const toJalaliTime = (d: string | null): string => {
  if (!d) return '—';
  return moment(d).format('jYYYY/jMM/jDD HH:mm');
};

export const INP = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';
export const SEL = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500';

export const SUPERADMIN_CODE = '19881990';

export const toJalali = (d: string | null): string => {
  if (!d) return '—';
  return moment(d).format('jYYYY/jMM/jDD');
};

export const jalaliToGregorian = (jDate: string): string | null => {
  if (!jDate) return null;
  try {
    const m = moment(jDate, 'jYYYY/jMM/jDD');
    if (!m.isValid()) return null;
    return m.toISOString();
  } catch { return null; }
};

export const priorityLabel: Record<string, string> = { high: 'بالا', medium: 'متوسط', low: 'پایین' };
export const priorityColor: Record<string, string> = {
  high: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  low: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
};
export const statusLabel: Record<string, string> = {
  open: 'باز', closed: 'بسته', requested: 'درخواست شده', approved: 'تایید شده',
  pending: 'در انتظار', in_progress: 'در حال انجام', completed: 'تکمیل شده',
};
export const statusColor: Record<string, string> = {
  open: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  closed: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  requested: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  approved: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  pending: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  in_progress: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  completed: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
};
