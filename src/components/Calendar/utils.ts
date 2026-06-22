import moment from 'moment-jalaali';

export const JALAALI_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
export const JALAALI_WEEKDAYS_SHORT = ['ش','ی','د','س','چ','پ','ج'];
export const JALAALI_WEEKDAYS = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه'];

export const PRIORITY_COLORS: Record<string, { solid: string }> = {
  high:   { solid: '#ef4444' },
  medium: { solid: '#f59e0b' },
  low:    { solid: '#22c55e' },
};

export const PRESET_COLORS = [
  '#e53e3e','#dd6b20','#d69e2e','#38a169','#2b6cb0','#3182ce','#00b5d8','#805ad5',
  '#d53f8c','#e91e63','#f06292','#ff8a65','#aed581','#4db6ac','#64b5f6','#7986cb',
  '#a1887f','#90a4ae','#607d8b','#546e7a',
];

export const SLOT_HEIGHT = 44;
export const HOURS_START = 0;
export const HOURS_END = 24;
export const DEFAULT_CALENDAR_COLOR = '#3b82f6';

export const VIEW_OPTIONS = [
  { key: 'day' as const, label: 'روز' },
  { key: 'week' as const, label: 'هفته' },
  { key: 'month' as const, label: 'ماه' },
  { key: 'list-week' as const, label: 'لیست هفته' },
  { key: 'list-month' as const, label: 'لیست ماه' },
];

export function toJalaali(date: Date): { jy: number; jm: number; jd: number } {
  const m = moment(date);
  return { jy: m.jYear(), jm: m.jMonth() + 1, jd: m.jDate() };
}
export function jalaaliToDate(jy: number, jm: number, jd: number): Date {
  return moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD').toDate();
}
export function getJalaaliMonthDays(jy: number, jm: number): number {
  const nextJm = jm === 12 ? 1 : jm + 1;
  const nextJy = jm === 12 ? jy + 1 : jy;
  return moment(`${nextJy}/${nextJm}/1`, 'jYYYY/jM/jD').diff(moment(`${jy}/${jm}/1`, 'jYYYY/jM/jD'), 'days');
}
export function getJalaaliFirstDayOfWeek(jy: number, jm: number): number {
  const day = moment(`${jy}/${jm}/1`, 'jYYYY/jM/jD').day();
  return day === 6 ? 0 : day + 1;
}
export function jsDayToWeekday(jsDay: number): number { return jsDay === 6 ? 0 : jsDay + 1; }
export function jalaaliToYYYYMMDD(jy: number, jm: number, jd: number): string {
  const d = jalaaliToDate(jy, jm, jd);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function parseRequestDateToDateStr(req: string): string | null {
  if (!req) return null;

  const IST_OFFSET_MS = 210 * 60 * 1000; // Tehran +3:30
  const d = new Date(new Date(req).getTime() + IST_OFFSET_MS);

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');

  return `${y}-${m}-${day}`;
}
export function timeToMinutes(time: string | null): number {
  if (!time) return -1;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}
export function minutesToSlotIndex(minutes: number): number { return Math.round(minutes / 30); }
