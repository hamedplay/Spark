import moment from 'moment-jalaali';

/**
 * Shared, type-safe Jalali date and clock-time utilities for the Minutes module.
 *
 * Contracts:
 *  - Date-only values are stored in the backend as Gregorian `YYYY-MM-DD`.
 *  - Jalali display is `YYYY/MM/DD` (Persian digits allowed for display only).
 *  - Clock times are stored as `HH:mm` (Latin digits, no timezone conversion).
 *  - Timestamps use the organizational timezone `Asia/Tehran` for display.
 *  - Invalid dates return `null` (never silently replaced with "today").
 *  - Date-only values are never shifted by browser timezone: parsing uses
 *    `moment.utc(...)` so the calendar day is preserved regardless of offset.
 */

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
const LATIN_DIGIT_RE = /[0-9]/;
const PERSIAN_DIGIT_RE = /[۰-۹]/;

/** Convert any digit characters in a string to Latin (0-9). */
export function toEnglishDigits(value: string): string {
  if (!value) return '';
  let out = '';
  for (const ch of value) {
    const idx = PERSIAN_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

/** Convert Latin digits in a string to Persian digits. */
export function toPersianDigits(value: string): string {
  if (!value) return '';
  let out = '';
  for (const ch of value) {
    if (LATIN_DIGIT_RE.test(ch)) out += PERSIAN_DIGITS[Number(ch)];
    else if (PERSIAN_DIGIT_RE.test(ch)) out += ch;
    else out += ch;
  }
  return out;
}

const JALALI_DATE_RE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;
const GREGORIAN_DATE_RE = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;

/** Returns true when the (normalized) string looks like a Jalali year (>= 1300). */
function isJalaliYear(year: number): boolean {
  return year >= 1300 && year < 1600;
}

/** Returns true when the (normalized) string looks like a Gregorian year. */
function isGregorianYear(year: number): boolean {
  return year >= 1900 && year < 2200;
}

/**
 * Normalize a meeting-date input that may be Jalali or Gregorian, with `/` or `-`
 * separators, and Persian or Latin digits. Returns a canonical Jalali display
 * string `YYYY/MM/DD` (Latin digits) or `null` when invalid.
 *
 * Precedence rules:
 *  1. If the value parses as a valid Jalali date, keep it as Jalali (do NOT
 *     re-interpret it as Gregorian).
 *  2. Otherwise, if it parses as a valid Gregorian date, convert to Jalali.
 *  3. Invalid input returns `null` (never replaced with today).
 */
export function normalizeMeetingDate(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = toEnglishDigits(input).trim();
  if (!raw) return null;

  const jMatch = JALALI_DATE_RE.exec(raw);
  if (jMatch) {
    const [_, y, m, d] = jMatch;
    void _;
    const jy = Number(y);
    const jm = Number(m);
    const jd = Number(d);
    if (isJalaliYear(jy)) {
      const mm = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jMM/jDD', true);
      if (mm.isValid()) return mm.format('jYYYY/jMM/jDD');
      return null;
    }
    if (isGregorianYear(jy)) {
      const gm = moment.utc(`${jy}-${pad2(m)}-${pad2(d)}`, 'YYYY-MM-DD', true);
      if (gm.isValid()) return gm.format('jYYYY/jMM/jDD');
      return null;
    }
    return null;
  }
  return null;
}

/**
 * Format a (normalized Jalali or Gregorian date-only) value into a Jalali
 * display string `YYYY/MM/DD` (Latin digits). Returns `null` for invalid input.
 * Use {@link normalizeMeetingDate} first when the input shape is unknown.
 */
export function formatJalaliDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeMeetingDate(value);
  return normalized;
}

/**
 * Convert a Jalali date string (`YYYY/MM/DD` or `YYYY-MM-DD`, Persian digits ok)
 * to a Gregorian `YYYY-MM-DD` string. Returns `null` when the input is not a
 * valid Jalali date. No timezone conversion — date-only arithmetic only.
 */
export function jalaliToGregorianDate(jalali: string | null | undefined): string | null {
  if (!jalali) return null;
  const raw = toEnglishDigits(jalali).trim();
  const m = JALALI_DATE_RE.exec(raw);
  if (!m) return null;
  const [_, y, mm, d] = m;
  void _;
  const jy = Number(y);
  if (!isJalaliYear(jy)) return null;
  const g = moment(`${jy}/${mm}/${d}`, 'jYYYY/jMM/jDD', true);
  if (!g.isValid()) return null;
  return g.format('YYYY-MM-DD');
}

/**
 * Convert a Gregorian `YYYY-MM-DD` (or `YYYY/MM/DD`, Persian digits ok) to a
 * Jalali `YYYY/MM/DD` display string. Returns `null` when invalid. No timezone
 * conversion — uses `moment.utc` to preserve the calendar day.
 */
export function gregorianToJalaliDate(gregorian: string | null | undefined): string | null {
  if (!gregorian) return null;
  const raw = toEnglishDigits(gregorian).trim();
  const m = GREGORIAN_DATE_RE.exec(raw);
  if (!m) return null;
  const [_, y, mm, d] = m;
  void _;
  const gy = Number(y);
  if (!isGregorianYear(gy)) return null;
  const g = moment.utc(`${y}-${pad2(mm)}-${pad2(d)}`, 'YYYY-MM-DD', true);
  if (!g.isValid()) return null;
  return g.format('jYYYY/jMM/jDD');
}

/**
 * Normalize a clock-time input to internal `HH:mm` (Latin digits, no seconds).
 * Accepts `8:30`, `08:30`, `08:30:00`, Persian digits, and surrounding
 * whitespace. Returns `null` for invalid input. Never uses `new Date(...)` and
 * never performs timezone conversion.
 */
export function normalizeClockTime(input: string | null | undefined): string | null {
  if (input == null) return null;
  const raw = toEnglishDigits(input).trim();
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const [_, h, mm] = m;
  void _;
  const hh = Number(h);
  if (hh < 0 || hh > 23) return null;
  const min = Number(mm);
  if (min < 0 || min > 59) return null;
  return `${pad2(h)}:${pad2(mm)}`;
}

/** Format a `HH:mm` (or `HH:mm:ss`) value for Persian display, dropping seconds. */
export function formatPersianClock(input: string | null | undefined): string {
  const normalized = normalizeClockTime(input);
  if (!normalized) return '';
  return toPersianDigits(normalized);
}

/**
 * Format a Jalali date + clock time together for display.
 * Returns Persian-digit `YYYY/MM/DD — HH:mm` or `''` when either part is invalid.
 */
export function formatJalaliDateTime(
  date: string | null | undefined,
  time: string | null | undefined,
): string {
  const d = formatJalaliDate(date);
  const t = formatPersianClock(time);
  if (!d || !t) return '';
  return `${toPersianDigits(d)} — ${t}`;
}

/**
 * Format an ISO timestamp string using the `Asia/Tehran` timezone for display.
 * Returns Persian-digit `YYYY/MM/DD — HH:mm` or `''` for invalid/null input.
 * Uses `Intl.DateTimeFormat` (with DST-aware timeZone) so no moment-timezone
 * dependency is required, then converts the Gregorian parts to Jalali.
 */
export function formatJalaliTimestamp(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tehran',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const seg = parts.formatToParts(d);
  const get = (t: string): string => seg.find(p => p.type === t)?.value ?? '';
  const yyyy = get('year');
  const mm = get('month');
  const dd = get('day');
  const hh = get('hour') === '24' ? '00' : get('hour');
  const mi = get('minute');
  const g = moment.utc(`${yyyy}-${mm}-${dd} ${hh}:${mi}`, 'YYYY-MM-DD HH:mm', true);
  if (!g.isValid()) return '';
  return `${toPersianDigits(g.format('jYYYY/jMM/jDD'))} — ${toPersianDigits(`${hh}:${mi}`)}`;
}

/**
 * Resolve a meeting date from possibly-Jalali and/or Gregorian inputs into a
 * Gregorian `YYYY-MM-DD` string for backend storage. Priority:
 *  1. `jalaliInput` (if a valid Jalali date) → converted to Gregorian.
 *  2. `gregorianInput` (if a valid Gregorian date) → kept as-is.
 *  3. Invalid → `null`.
 *
 * This preserves the `meeting_date_snapshot` Gregorian storage contract while
 * accepting either calendar on input. No timezone conversion is performed.
 */
export function resolveMeetingDateGregorian(
  jalaliInput: string | null | undefined,
  gregorianInput: string | null | undefined,
): string | null {
  if (jalaliInput) {
    const g = jalaliToGregorianDate(jalaliInput);
    if (g) return g;
  }
  if (gregorianInput) {
    const raw = toEnglishDigits(gregorianInput).trim();
    const m = GREGORIAN_DATE_RE.exec(raw);
    if (m) {
      const [_, y, mm, d] = m;
      void _;
      const g = moment.utc(`${y}-${pad2(mm)}-${pad2(d)}`, 'YYYY-MM-DD', true);
      if (g.isValid()) return g.format('YYYY-MM-DD');
    }
  }
  return null;
}

/** Returns true when `due` is strictly before `start` (both `YYYY-MM-DD`). */
export function isDueBeforeStart(start: string | null | undefined, due: string | null | undefined): boolean {
  if (!start || !due) return false;
  return due < start;
}

function pad2(n: string | number): string {
  const s = String(n);
  return s.length < 2 ? `0${s}` : s;
}
