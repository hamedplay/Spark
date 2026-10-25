import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { focusCalendarNow } from '../../src/components/Calendar/focusCalendarNow';

const now = new Date(2026, 9, 26, 10, 30);
const card = (start: string, end: string, top: number) => ({ dataset: { startTime: start, endTime: end }, getBoundingClientRect: () => ({ top }) });
function schedule(cards: ReturnType<typeof card>[], today = true) {
  const group = { querySelectorAll: () => cards, getBoundingClientRect: () => ({ top: 80 }) };
  return { scrollTop: 500, querySelector: () => today ? group : null, getBoundingClientRect: () => ({ top: 20 }) } as unknown as HTMLElement;
}
test('schedule refresh targets an ongoing meeting instead of leaving the previous scroll position', () => {
  const list = schedule([card('08:00', '09:00', 100), card('10:00', '11:00', 300), card('14:00', '15:00', 600)]);
  focusCalendarNow('schedule', null, null, list, now, 20);
  assert.equal(list.scrollTop, 740);
});
test('schedule refresh targets the next meeting when no meeting is ongoing', () => {
  const list = schedule([card('08:00', '09:00', 100), card('14:00', '15:00', 600)]);
  focusCalendarNow('schedule', null, null, list, now, 20);
  assert.equal(list.scrollTop, 1040);
});
test('schedule refresh after the last meeting uses the last card; no meetings today starts at the upcoming day', () => {
  const list = schedule([card('08:00', '09:00', 100)]);
  focusCalendarNow('schedule', null, null, list, now, 20);
  assert.equal(list.scrollTop, 540);
  const future = schedule([], false);
  focusCalendarNow('schedule', null, null, future, now, 20);
  assert.equal(future.scrollTop, 0);
});
for (const mode of ['day', '3-day', '4-day', 'work-week', 'week']) {
  test(`${mode} refresh centers the current clock time and today column`, () => {
    let focused = 0;
    const root = { querySelector: () => ({ scrollIntoView() { focused++; } }) } as unknown as HTMLElement;
    const time = { scrollTop: 0, clientHeight: 500, querySelector: () => ({ offsetHeight: 100 }) } as unknown as HTMLElement;
    focusCalendarNow(mode, root, time, null, now, 40, 6);
    assert.equal(time.scrollTop, 160);
    assert.equal(focused, 1);
  });
}
for (const mode of ['month', 'year']) {
  test(`${mode} refresh reveals the today marker`, () => {
    let focused = false;
    focusCalendarNow(mode, { querySelector: () => ({ scrollIntoView() { focused = true; } }) } as unknown as HTMLElement, null, null, now, 20);
    assert.equal(focused, true);
  });
}
test('refresh refreshes data and issues a focus request even when already on today', async () => {
  const source = readFileSync(new URL('../../src/components/CalendarPageCore.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  const refreshCalendarToNow =');
  const end = source.indexOf('\n  useEffect', start);
  const calls: string[] = [];
  let requests = 0;
  const refresh = new Function('goToToday','fetchMeetings','setCurrentTime','setFocusNowRequest', `${stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' })}; return refreshCalendarToNow;`)(
    () => calls.push('today'), async () => { calls.push('fetch'); }, () => calls.push('clock'), (fn: (value: number) => number) => { requests = fn(requests); },
  );
  await refresh(); await refresh();
  assert.equal(requests, 2);
  assert.deepEqual(calls.slice(0, 4), ['today','fetch','today','clock']);
});


test('schedule prioritizes an ongoing meeting even if future cards appear earlier in the DOM', () => {
  const list = schedule([card('14:00', '15:00', 600), card('10:00', '11:00', 300)]);
  focusCalendarNow('schedule', null, null, list, now, 20);
  assert.equal(list.scrollTop, 740);
});
