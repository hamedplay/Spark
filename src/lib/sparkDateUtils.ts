import moment from 'moment-jalaali';

/**
 * Convert a Jalali date string (jYYYY/jMM/jDD) to a Gregorian ISO timestamp.
 * Uses local-time midnight so it matches how meeting forms store dates.
 */
export function jalaliToGregorianIso(jalaliStr: string): string {
  if (!jalaliStr) return '';
  const m = moment(jalaliStr, 'jYYYY/jMM/jDD');
  if (!m.isValid()) return '';
  return m.toDate().toISOString();
}

/**
 * Returns a [start, end) UTC ISO pair covering the entire calendar day for
 * the given Jalali date string in Iran timezone.
 *
 * Iran uses IRDT (UTC+04:30) in summer and IRST (UTC+03:30) in winter.
 * Using +04:30 as the anchor captures midnight in either offset:
 *   IRDT midnight → D-1 at 19:30 UTC  (start of range)
 *   IRST midnight → D-1 at 20:30 UTC  (also inside range)
 *   IRDT midnight of D+1 → D at 19:30 UTC (exclusive end)
 */
export function jalaliDayRange(jalaliStr: string): [string, string] {
  if (!jalaliStr) return ['', ''];
  const m = moment(jalaliStr, 'jYYYY/jMM/jDD');
  if (!m.isValid()) return ['', ''];
  const gregDate = m.format('YYYY-MM-DD');
  const nextDate = m.clone().add(1, 'day').format('YYYY-MM-DD');
  const start = new Date(`${gregDate}T00:00:00+04:30`);
  const end = new Date(`${nextDate}T00:00:00+04:30`);
  return [start.toISOString(), end.toISOString()];
}

/**
 * Convert a Gregorian ISO string to a Jalali display string (jYYYY/jMM/jDD).
 */
export function gregorianToJalali(iso: string): string {
  if (!iso) return '';
  try {
    return moment(iso).format('jYYYY/jMM/jDD');
  } catch {
    return '';
  }
}
