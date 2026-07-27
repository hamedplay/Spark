import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeMeetingDate,
  jalaliToGregorianDate,
  gregorianToJalaliDate,
  normalizeClockTime,
  formatPersianClock,
  toEnglishDigits,
  toPersianDigits,
  isDueBeforeStart,
  resolveMeetingDateGregorian,
  formatJalaliTimestamp,
} from '../../src/lib/minutesDate';

// ── 1. Gregorian → Jalali ────────────────────────────────────────────────────

test('gregorianToJalaliDate: 2026-07-26 → 1405/05/04', () => {
  assert.equal(gregorianToJalaliDate('2026-07-26'), '1405/05/04');
});

test('gregorianToJalaliDate: null/empty → null', () => {
  assert.equal(gregorianToJalaliDate(null), null);
  assert.equal(gregorianToJalaliDate(''), null);
  assert.equal(gregorianToJalaliDate('not-a-date'), null);
});

// ── 2. Detect Jalali input ───────────────────────────────────────────────────

test('normalizeMeetingDate: 1405/05/04 detected as Jalali', () => {
  assert.equal(normalizeMeetingDate('1405/05/04'), '1405/05/04');
});

// ── 3. Persian digits ────────────────────────────────────────────────────────

test('normalizeMeetingDate: ۱۴۰۵/۰۵/۰۴ (Persian digits) → 1405/05/04', () => {
  assert.equal(normalizeMeetingDate('۱۴۰۵/۰۵/۰۴'), '1405/05/04');
});

// ── 4. Dash separators ────────────────────────────────────────────────────────

test('normalizeMeetingDate: 1405-05-04 (dash) → 1405/05/04', () => {
  assert.equal(normalizeMeetingDate('1405-05-04'), '1405/05/04');
});

test('normalizeMeetingDate: 2026-07-26 (dash, Gregorian) → 1405/05/04', () => {
  assert.equal(normalizeMeetingDate('2026-07-26'), '1405/05/04');
});

// ── 5. No double-conversion of Jalali ────────────────────────────────────────

test('normalizeMeetingDate: Jalali not re-interpreted as Gregorian', () => {
  // 1405/05/04 is a valid Jalali date; it must NOT be treated as Gregorian.
  const result = normalizeMeetingDate('1405/05/04');
  assert.equal(result, '1405/05/04');
  assert.notEqual(result, gregorianToJalaliDate('1405-05-04'));
});

// ── 6. No timezone shift for date-only ───────────────────────────────────────

test('gregorianToJalaliDate: date-only not shifted by timezone', () => {
  // 2026-07-26 must always map to 1405/05/04 regardless of the host TZ.
  const result = gregorianToJalaliDate('2026-07-26');
  assert.equal(result, '1405/05/04');
});

// ── 7. Normalize clock time 8:30 ─────────────────────────────────────────────

test('normalizeClockTime: 8:30 → 08:30', () => {
  assert.equal(normalizeClockTime('8:30'), '08:30');
});

// ── 8. Normalize clock time with seconds ─────────────────────────────────────

test('normalizeClockTime: 08:30:00 → 08:30 (seconds dropped)', () => {
  assert.equal(normalizeClockTime('08:30:00'), '08:30');
});

// ── 9. Already-normalized clock time unchanged ───────────────────────────────

test('normalizeClockTime: 08:30 unchanged', () => {
  assert.equal(normalizeClockTime('08:30'), '08:30');
});

test('normalizeClockTime: Persian digits ۰۸:۳۰ → 08:30', () => {
  assert.equal(normalizeClockTime('۰۸:۳۰'), '08:30');
});

test('normalizeClockTime: invalid → null', () => {
  assert.equal(normalizeClockTime('25:00'), null);
  assert.equal(normalizeClockTime('abc'), null);
  assert.equal(normalizeClockTime(null), null);
});

// ── 10. Reject invalid dates (no today fallback) ──────────────────────────────

test('normalizeMeetingDate: invalid → null (not today)', () => {
  assert.equal(normalizeMeetingDate('2026-13-40'), null);
  assert.equal(normalizeMeetingDate('not-a-date'), null);
  assert.equal(normalizeMeetingDate(null), null);
  assert.equal(normalizeMeetingDate(''), null);
});

// ── 11. Decision date Gregorian → Jalali display ──────────────────────────────

test('gregorianToJalaliDate: 2026-07-27 → 1405/05/05', () => {
  assert.equal(gregorianToJalaliDate('2026-07-27'), '1405/05/05');
});

// ── 12. Jalali selection → YYYY-MM-DD ─────────────────────────────────────────

test('jalaliToGregorianDate: 1405/05/04 → 2026-07-26', () => {
  assert.equal(jalaliToGregorianDate('1405/05/04'), '2026-07-26');
});

test('jalaliToGregorianDate: Persian digits ۱۴۰۵/۰۵/۰۴ → 2026-07-26', () => {
  assert.equal(jalaliToGregorianDate('۱۴۰۵/۰۵/۰۴'), '2026-07-26');
});

test('jalaliToGregorianDate: invalid → null', () => {
  assert.equal(jalaliToGregorianDate('not-jalali'), null);
  assert.equal(jalaliToGregorianDate(null), null);
});

// ── 13. Round-trip ───────────────────────────────────────────────────────────

test('round-trip: Gregorian → Jalali → Gregorian is idempotent', () => {
  const greg = '2026-07-26';
  const jalali = gregorianToJalaliDate(greg);
  assert.ok(jalali);
  const back = jalaliToGregorianDate(jalali);
  assert.equal(back, greg);
});

test('round-trip: Jalali → Gregorian → Jalali is idempotent', () => {
  const jalali = '1405/05/04';
  const greg = jalaliToGregorianDate(jalali);
  assert.ok(greg);
  const back = gregorianToJalaliDate(greg);
  assert.equal(back, jalali);
});

// ── 14. Reject due before start ──────────────────────────────────────────────

test('isDueBeforeStart: due before start → true', () => {
  assert.equal(isDueBeforeStart('2026-07-28', '2026-07-26'), true);
});

test('isDueBeforeStart: due on start → false', () => {
  assert.equal(isDueBeforeStart('2026-07-26', '2026-07-26'), false);
});

test('isDueBeforeStart: due after start → false', () => {
  assert.equal(isDueBeforeStart('2026-07-26', '2026-07-28'), false);
});

test('isDueBeforeStart: missing values → false', () => {
  assert.equal(isDueBeforeStart(null, '2026-07-28'), false);
  assert.equal(isDueBeforeStart('2026-07-26', null), false);
});

// ── 15. Form vs preview display equality ─────────────────────────────────────

test('display parity: form and preview use same gregorianToJalaliDate', () => {
  const stored = '2026-07-26';
  const formDisplay = gregorianToJalaliDate(stored);
  const previewDisplay = gregorianToJalaliDate(stored);
  assert.equal(formDisplay, previewDisplay);
  assert.equal(formDisplay, '1405/05/04');
});

// ── 16. Timestamp with Asia/Tehran ────────────────────────────────────────────

test('formatJalaliTimestamp: renders Persian date and time in Asia/Tehran', () => {
  // 2026-07-26T10:00:00Z is 13:30 in Tehran (UTC+3:30, no DST in July).
  const out = formatJalaliTimestamp('2026-07-26T10:00:00Z');
  assert.ok(out.includes('۱۴۰۵/۰۵/۰۴'), `expected Jalali date in: ${out}`);
  assert.ok(out.includes('۱۳:۳۰'), `expected Tehran time in: ${out}`);
});

test('formatJalaliTimestamp: null/invalid → empty string', () => {
  assert.equal(formatJalaliTimestamp(null), '');
  assert.equal(formatJalaliTimestamp(''), '');
  assert.equal(formatJalaliTimestamp('not-a-timestamp'), '');
});

// ── Digit helpers ─────────────────────────────────────────────────────────────

test('toEnglishDigits: Persian → Latin', () => {
  assert.equal(toEnglishDigits('۱۴۰۵/۰۵/۰۴'), '1405/05/04');
});

test('toPersianDigits: Latin → Persian', () => {
  assert.equal(toPersianDigits('1405/05/04'), '۱۴۰۵/۰۵/۰۴');
});

test('formatPersianClock: 08:30 → ۰۸:۳۰', () => {
  assert.equal(formatPersianClock('08:30'), '۰۸:۳۰');
});

test('formatPersianClock: invalid → empty', () => {
  assert.equal(formatPersianClock('abc'), '');
});

// ── resolveMeetingDateGregorian priority ─────────────────────────────────────

test('resolveMeetingDateGregorian: Jalali input takes priority', () => {
  assert.equal(resolveMeetingDateGregorian('1405/05/04', '2026-07-26'), '2026-07-26');
});

test('resolveMeetingDateGregorian: falls back to Gregorian when Jalali invalid', () => {
  assert.equal(resolveMeetingDateGregorian('bad', '2026-07-26'), '2026-07-26');
});

test('resolveMeetingDateGregorian: both invalid → null', () => {
  assert.equal(resolveMeetingDateGregorian('bad', 'also-bad'), null);
  assert.equal(resolveMeetingDateGregorian(null, null), null);
});

// ── ISO timestamp handling ─────────────────────────────────────────────────────

test('resolveMeetingDateGregorian: ISO timestamp extracts Tehran calendar date', () => {
  // 2026-07-27T20:30:00.000Z is 2026-07-28 01:00 in Tehran (UTC+3:30, no DST).
  // The meeting day in Tehran is the 28th, not the 27th.
  assert.equal(resolveMeetingDateGregorian(null, '2026-07-27T20:30:00.000Z'), '2026-07-28');
});

test('resolveMeetingDateGregorian: ISO timestamp near midnight UTC stays same day in Tehran', () => {
  // 2026-07-26T10:00:00Z is 13:30 in Tehran — same calendar day (26th).
  assert.equal(resolveMeetingDateGregorian(null, '2026-07-26T10:00:00Z'), '2026-07-26');
});

test('resolveMeetingDateGregorian: ISO timestamp with timezone offset', () => {
  // 2026-07-27T23:00:00+00:00 is 2026-07-28 02:30 in Tehran.
  assert.equal(resolveMeetingDateGregorian(null, '2026-07-27T23:00:00+00:00'), '2026-07-28');
});

test('resolveMeetingDateGregorian: plain YYYY-MM-DD still works', () => {
  assert.equal(resolveMeetingDateGregorian(null, '2026-07-26'), '2026-07-26');
});

test('resolveMeetingDateGregorian: Jalali priority over ISO timestamp', () => {
  assert.equal(resolveMeetingDateGregorian('1405/05/04', '2026-07-27T20:30:00.000Z'), '2026-07-26');
});

test('resolveMeetingDateGregorian: invalid ISO → null (not today)', () => {
  assert.equal(resolveMeetingDateGregorian(null, 'not-a-timestamp'), null);
  assert.equal(resolveMeetingDateGregorian(null, '2026-13-40T99:99:99Z'), null);
});
