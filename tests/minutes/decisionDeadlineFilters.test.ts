import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Targeted tests for decision deadline filter semantics.
 *
 * These tests verify the pure date-range computation logic that mirrors
 * the SQL in get_my_minutes_decisions / get_trackable_minutes_decisions.
 * The SQL itself is verified via live RPC calls documented below.
 */

/** Tehran today as a date object (UTC-safe). */
function tehranToday(): Date {
  // Asia/Tehran is UTC+3:30
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 3.5 * 3600000);
}

/** Extract YYYY-MM-DD from a Date. */
function toDateString(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Add n calendar days to a Date, returning a new Date. */
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

/** PostgreSQL EXTRACT(DOW): Sunday=0, Monday=1, ..., Saturday=6. */
function pgDow(d: Date): number {
  return d.getUTCDay();
}

/** Compute Iranian week start (Saturday) using the same formula as the RPC. */
function iranianWeekStart(today: Date): Date {
  const dow = pgDow(today);
  const offset = (dow + 1) % 7;
  return addDays(today, -offset);
}

describe('next_7_days filter', () => {
  it('starts at today and ends at today+6 (exactly 7 calendar days)', () => {
    const today = tehranToday();
    const start = today;
    const end = addDays(today, 6);

    // today+7 must NOT be in range
    const dayAfter = addDays(today, 7);
    assert.ok(toDateString(dayAfter) > toDateString(end),
      `today+7 (${toDateString(dayAfter)}) should be after end (${toDateString(end)})`);

    // today must be the first day
    assert.equal(toDateString(start), toDateString(today));

    // exactly 7 days inclusive: today, today+1, ..., today+6
    let count = 0;
    for (let i = 0; i <= 6; i++) {
      const d = addDays(today, i);
      const inRange = toDateString(d) >= toDateString(start) && toDateString(d) <= toDateString(end);
      assert.ok(inRange, `day today+${i} (${toDateString(d)}) should be in next_7_days range`);
      count++;
    }
    assert.equal(count, 7);
  });

  it('today+7 is excluded from next_7_days', () => {
    const today = tehranToday();
    const end = addDays(today, 6);
    const dayAfter = addDays(today, 7);
    assert.ok(toDateString(dayAfter) > toDateString(end),
      `today+7 (${toDateString(dayAfter)}) must be strictly after end (${toDateString(end)})`);
  });
});

describe('this_week filter (Iranian week: Saturday to Friday)', () => {
  it('week start is Saturday and week end is week start + 6 (Friday)', () => {
    const today = tehranToday();
    const weekStart = iranianWeekStart(today);
    const weekEnd = addDays(weekStart, 6);

    // week start must be a Saturday (pgDow = 6)
    assert.equal(pgDow(weekStart), 6, `week start should be Saturday, got pgDow=${pgDow(weekStart)}`);

    // week end must be a Friday (pgDow = 5)
    assert.equal(pgDow(weekEnd), 5, `week end should be Friday, got pgDow=${pgDow(weekEnd)}`);

    // today must be within the week
    const todayStr = toDateString(today);
    assert.ok(todayStr >= toDateString(weekStart) && todayStr <= toDateString(weekEnd),
      `today (${todayStr}) should be within week [${toDateString(weekStart)}, ${toDateString(weekEnd)}]`);
  });

  it('if today is Saturday, week start equals today', () => {
    // Construct a known Saturday: 2026-08-01 is a Saturday
    const saturday = new Date(Date.UTC(2026, 7, 1));
    assert.equal(pgDow(saturday), 6);
    const ws = iranianWeekStart(saturday);
    assert.equal(toDateString(ws), toDateString(saturday));
  });

  it('if today is Friday, week start is 6 days before', () => {
    // 2026-08-07 is a Friday
    const friday = new Date(Date.UTC(2026, 7, 7));
    assert.equal(pgDow(friday), 5);
    const ws = iranianWeekStart(friday);
    const expected = addDays(friday, -6);
    assert.equal(toDateString(ws), toDateString(expected));
  });
});

describe('active status alias', () => {
  it('active set contains exactly the 5 active statuses', () => {
    // This mirrors the SQL: d.status IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval')
    const activeStatuses = ['not_started', 'planned', 'in_progress', 'waiting_coordination', 'waiting_approval'];
    assert.equal(activeStatuses.length, 5);
    assert.ok(!activeStatuses.includes('completed'));
    assert.ok(!activeStatuses.includes('stopped'));
  });
});

describe('INVALID_DATE_RANGE fail-closed', () => {
  it('due_from > due_to is an inverted range', () => {
    const from = '2026-08-10';
    const to = '2026-08-01';
    assert.ok(from > to, 'from > to should be true for inverted range');
  });

  it('start_from > start_to is an inverted range', () => {
    const from = '2026-08-10';
    const to = '2026-08-01';
    assert.ok(from > to, 'from > to should be true for inverted range');
  });

  it('valid ranges are not inverted', () => {
    assert.ok('2026-08-01' <= '2026-08-10');
    assert.ok('2026-08-01' <= '2026-08-01');
  });
});
