import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarGoogleEventUrl, openGoogleCalendarWindow } from '../../src/components/Calendar/googleCalendarExport';
import { parseRequestDateToDateStr } from '../../src/components/Calendar/utils';

const event = { title: 'جلسه بررسی & برنامه', date: '2026-10-24', startTime: '09:30', endTime: '11:00', location: 'سالن شماره ۱', details: 'دستور جلسه:\n۱. بررسی\nیادداشت: + & #' };

test('Google event uses exact Tehran meeting time and encoded Persian content', () => {
  const url = new URL(buildCalendarGoogleEventUrl(event));
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/r/eventedit');
  assert.equal(url.searchParams.get('dates'), '20261024T060000Z/20261024T073000Z');
  for (const key of ['stz', 'etz', 'ctz']) assert.equal(url.searchParams.get(key), 'Asia/Tehran');
  assert.equal(url.searchParams.get('text'), event.title);
  assert.equal(url.searchParams.get('details'), event.details);
  assert.equal(url.searchParams.get('location'), event.location);
});

test('database times with seconds produce valid compact timestamps', () => {
  const url = new URL(buildCalendarGoogleEventUrl({ ...event, startTime: '09:30:15', endTime: '11:00:45.000000' }));
  assert.equal(url.searchParams.get('dates'), '20261024T060015Z/20261024T073045Z');
});

test('stored Tehran midnight retains the calendar day, including UTC day boundary', () => {
  const date = parseRequestDateToDateStr('2026-10-23T20:30:00Z');
  const url = new URL(buildCalendarGoogleEventUrl({ ...event, date, startTime: '00:15', endTime: '01:15' }));
  assert.equal(url.searchParams.get('dates'), '20261023T204500Z/20261023T214500Z');
});

test('overnight meeting ends on next day and year', () => {
  const url = new URL(buildCalendarGoogleEventUrl({ ...event, date: '2026-12-31', startTime: '23:45', endTime: '04:00' }));
  assert.equal(url.searchParams.get('dates'), '20261231T201500Z/20270101T003000Z');
});

test('invalid or missing meeting timing is rejected', () => {
  for (const change of [{date:null}, {date:'NaN-NaN-NaN'}, {date:'2026-02-30'}, {startTime:null}, {startTime:'25:00'}, {endTime:'12:60'}, {endTime:'09:30'}]) {
    assert.throws(() => buildCalendarGoogleEventUrl({...event,...change}), /INVALID_MEETING_TIME/);
  }
});

function fakeWindow() {
  const navigation: string[] = [];
  let closeCount = 0;
  return { tab: { opener: {} as unknown, closed: false, close() { closeCount++; }, location: { replace(url: string) { navigation.push(url); } } }, navigation, closes: () => closeCount };
}

test('tab opens synchronously before slow agenda load; final URL includes loaded data', async () => {
  const fake = fakeWindow();
  const calls: string[] = [];
  let finish!: (url: string) => void;
  const pending = openGoogleCalendarWindow(() => { calls.push('query'); return new Promise(resolve => { finish = resolve; }); }, () => { calls.push('open'); return fake.tab; });
  assert.deepEqual(calls, ['open', 'query']);
  assert.equal(fake.tab.opener, null);
  assert.deepEqual(fake.navigation, []);
  const url = buildCalendarGoogleEventUrl(event);
  finish(url);
  await pending;
  assert.deepEqual(fake.navigation, [url]);
});

test('blocked popup does not query agenda or silently fail', async () => {
  let queried = false;
  await assert.rejects(openGoogleCalendarWindow(async () => { queried = true; return ''; }, () => null), /GOOGLE_CALENDAR_POPUP_BLOCKED/);
  assert.equal(queried, false);
});

test('query error closes reserved tab instead of exporting an incomplete event', async () => {
  const fake = fakeWindow();
  await assert.rejects(openGoogleCalendarWindow(async () => { throw new Error('query failed'); }, () => fake.tab), /query failed/);
  assert.equal(fake.closes(), 1);
  assert.deepEqual(fake.navigation, []);
});

test('closing reserved tab while loading does not reopen it', async () => {
  const fake = fakeWindow();
  await openGoogleCalendarWindow(async () => { fake.tab.closed = true; return buildCalendarGoogleEventUrl(event); }, () => fake.tab);
  assert.deepEqual(fake.navigation, []);
});
