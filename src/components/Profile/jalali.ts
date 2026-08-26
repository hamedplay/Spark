import moment from 'moment-jalaali';

export const JALAALI_MONTHS_FA = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

export function getJalaaliMonthDays(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return moment.jIsLeapYear(jy) ? 30 : 29;
}

export function isoToJalali(iso: string): { jy: number; jm: number; jd: number } | null {
  if (!iso) return null;
  try {
    const m = moment(iso, 'YYYY-MM-DD');
    if (!m.isValid()) return null;
    return { jy: m.jYear(), jm: m.jMonth() + 1, jd: m.jDate() };
  } catch { return null; }
}

export function jalaliToIso(jy: number, jm: number, jd: number): string {
  try {
    const d = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD');
    if (!d.isValid()) return '';
    return d.format('YYYY-MM-DD');
  } catch { return ''; }
}
