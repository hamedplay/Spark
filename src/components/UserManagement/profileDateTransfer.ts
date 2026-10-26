import { formatJalaliDateForDisplay, jalaliToGregorianDate, normalizeMeetingDate } from '../../lib/minutesDate';

export function profileDateForExport(value: string | null | undefined): string {
  return value ? formatJalaliDateForDisplay(value) : '';
}

/** Accept both existing Gregorian sheets and the Persian-date export format. */
export function profileDateFromImport(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const jalali = normalizeMeetingDate(value);
  const gregorian = jalaliToGregorianDate(jalali);
  if (!gregorian) throw new Error('تاریخ نامعتبر است؛ تاریخ شمسی یا میلادی با قالب سال/ماه/روز وارد کنید');
  return gregorian;
}
