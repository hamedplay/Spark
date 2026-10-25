import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { clampWeekZoom, weekZoomHeight, weekZoomPixels, fitWeekSlotHeight, mobileZoomDayCount } from '../../src/components/Calendar/weekZoom';

// Exercise the actual native event handlers with a deterministic frame scheduler.
// No live authentication or meeting writes are needed for the gesture lifecycle.
function fixture(enabled = true) {
  const listeners = new Map<string, Function>();
  const commands = new Map<string, Function>();
  const pinchLifecycle: string[] = [];
  const committed = { current: 1 };
  const variables = new Map<string, string>();
  const frames = new Map<number, Function>();
  let nextFrame = 0;
  let stateCommits = 0;
  let cancelledDrags = 0;
  let zoom = 1;
  let slotHeight = 40;
  let cleanup: (() => void) | undefined;
  const el = {
    clientWidth: 390, clientHeight: 844, scrollLeft: 0, scrollTop: 800, dataset: {} as Record<string, string>,
    style: { setProperty: (k: string, v: string) => variables.set(k, v), removeProperty: (k: string) => variables.delete(k) },
    getBoundingClientRect: () => ({ right: 390, top: 0 }),
    querySelector: () => ({ offsetHeight: 100 }),
    addEventListener: (type: string, handler: Function) => listeners.set(type, handler),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const props = {
    slotHeight, timeScrollRef: { current: el },
    setPreviewMeeting: () => {}, setDragMoveMeeting: () => {}, setResizeMeeting: () => {}, setAllDayDragging: () => {},
    cancelTouchDrag: () => { cancelledDrags++; }, handleHourColTouchEnd: () => {},
    adjustSlotHeight: (delta: number) => { slotHeight += delta; },
  };
  const src = readFileSync(new URL('../../src/components/Calendar/useMobileWeekZoom.ts', import.meta.url), 'utf8');
  const start = src.indexOf('  useEffect(() => {\n    const el = p.timeScrollRef.current;\n    if (!el || !enabled)');
  const end = src.indexOf('\n\n  return { enabled', start);
  const code = stripTypeScriptTypes(src.slice(start, end), { mode: 'transform' });
  new Function('p', 'enabled', 'live', 'committed', 'setZoom', 'useEffect', 'requestAnimationFrame', 'cancelAnimationFrame', 'clampWeekZoom', 'weekZoomHeight', 'window', 'beginCalendarPinch', 'endCalendarPinch', code)(
    props, enabled, { current: props }, committed, (value: number) => { zoom = value; stateCommits++; },
    (effect: () => (() => void) | undefined) => { cleanup = effect(); },
    (callback: Function) => { frames.set(++nextFrame, callback); return nextFrame; },
    (id: number) => frames.delete(id), clampWeekZoom, weekZoomHeight, { addEventListener: (name: string, fn: Function) => commands.set(name, fn), removeEventListener: (name: string) => commands.delete(name) }, () => pinchLifecycle.push('begin'), () => pinchLifecycle.push('end'),
  );
  const event = (distance: number, count = 2) => ({
    touches: count === 2 ? [{ clientX: 200 - distance / 2, clientY: 300 }, { clientX: 200 + distance / 2, clientY: 300 }] : count === 1 ? [{ clientX: 200, clientY: 300 }] : [],
    cancelable: true, preventDefault() {}, stopImmediatePropagation() {},
    target: { dispatchEvent() { cancelledDrags++; } },
  });
  return { el, listeners, variables, frames, event, commands, pinchLifecycle,
    commit: () => { committed.current = zoom; props.slotHeight = slotHeight; variables.set('--calendar-week-x', '1'); variables.set('--calendar-week-y', '1'); },
    flush: () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
    result: () => ({ zoom, slotHeight, stateCommits, cancelledDrags }), cleanup: () => cleanup?.() };
}

test('continuous pinch batches moves into one frame and commits React state only on release', () => {
  const f = fixture();
  f.listeners.get('touchstart')!(f.event(100));
  for (let distance = 101; distance <= 400; distance++) f.listeners.get('touchmove')!(f.event(distance));
  assert.equal(f.frames.size, 1);
  assert.equal(f.result().stateCommits, 0);
  f.flush();
  assert.equal(f.variables.get('--calendar-week-x'), '4');
  assert.equal(f.variables.get('--calendar-week-y'), '2');
  // Anchor 134px into the RTL day grid, and 1000px into the time grid.
  assert.equal(f.el.scrollLeft, 190 - 56 - 134 * 4);
  assert.equal(f.el.scrollTop, 1000 * 2 + 100 - 300);
  f.listeners.get('touchend')!(f.event(0, 1));
  assert.deepEqual(f.result(), { zoom: 4, slotHeight: 80, stateCommits: 1, cancelledDrags: 2 });
  // Remaining finger cannot start another gesture or accidentally click a meeting.
  f.listeners.get('touchstart')!(f.event(100));
  assert.equal(f.result().cancelledDrags, 2);
  let stopped = false;
  f.listeners.get('click')!({ preventDefault() {}, stopImmediatePropagation() { stopped = true; } });
  assert.equal(stopped, true);
  f.listeners.get('touchend')!(f.event(0, 0));
  f.cleanup();
  assert.equal(f.listeners.size, 0);
  assert.equal(f.variables.size, 0);
});

test('desktop and other calendar modes do not install the mobile gesture handlers', () => {
  const f = fixture(false);
  assert.equal(f.listeners.size, 0);
  f.cleanup();
});

test('fit-week and maximum zoom remain bounded, while vertical density stays usable', () => {
  assert.equal(clampWeekZoom(0.1), 1);
  assert.equal(clampWeekZoom(99), 8);
  assert.equal(weekZoomHeight(8, 100), 120);
  assert.equal(weekZoomHeight(0.125, 20), 20);
  assert.equal(weekZoomPixels(40, false), '40px');
  assert.equal(weekZoomPixels(40, true), 'calc(40px * var(--calendar-week-y, 1))');
  for (const width of [320, 360, 390, 430]) assert.equal(56 + ((width - 56) / 7) * 7, width);
});

test('cancelled pinch cleans the pending frame and suppresses compatibility clicks', () => {
  const f = fixture();
  f.listeners.get('touchstart')!(f.event(100));
  f.listeners.get('touchmove')!(f.event(200));
  assert.equal(f.frames.size, 1);
  f.listeners.get('touchcancel')!(f.event(0, 0));
  assert.equal(f.frames.size, 0);
  assert.equal(f.result().stateCommits, 1);
  assert.equal(f.el.dataset.weekPinching, undefined);
  f.cleanup();
});


test('fits the configured working day into the available time area on short and tall phones', () => {
  for (const available of [250, 360, 520, 700]) {
    const slot = fitWeekSlotHeight(available, 7 * 60, 19 * 60 + 30)!;
    assert.equal(slot * 25, available);
    assert.ok(slot < 44);
    assert.equal(weekZoomHeight(1, slot, 4), slot);
    assert.ok(weekZoomHeight(4, slot, 4) > slot);
  }
  assert.equal(fitWeekSlotHeight(400, 600, 600), null);
  assert.equal(fitWeekSlotHeight(0, 420, 1170), null);
});


test('magnifier commands zoom both day widths and time height and reverse cleanly', () => {
  const f = fixture();
  const command = f.commands.get('spark-calendar-mobile-week-zoom')!;
  command({ detail: { delta: 4 } });
  assert.equal(f.result().zoom, 1.25);
  assert.ok(f.result().slotHeight > 40);
  assert.equal(f.result().stateCommits, 1);
  f.commit();
  command({ detail: { delta: -4 } });
  assert.equal(f.result().zoom, 1);
  assert.ok(Math.abs(f.result().slotHeight - 40) < 0.00001);
  f.commit();
  const commits = f.result().stateCommits;
  command({ detail: { delta: -4 } });
  assert.equal(f.result().stateCommits, commits);
  f.cleanup();
  assert.equal(f.commands.size, 0);
});


test('three-day and four-day views share fit-width mobile zoom with the weekly view', () => {
  for (const [mode, count] of [['3-day', 3], ['4-day', 4], ['week', 7]] as const) {
    assert.equal(mobileZoomDayCount(mode), count);
    for (const width of [320, 390, 430]) {
      const dayWidth = (width - 56) / mobileZoomDayCount(mode);
      assert.ok(Math.abs(56 + dayWidth * count - width) < 0.000001);
    }
  }
  for (const mode of ['day', 'month', 'year', 'schedule']) assert.equal(mobileZoomDayCount(mode), 0);
});


test('native pinch locks card activation until the last finger is released', () => {
  const f = fixture();
  f.listeners.get('touchstart')!(f.event(100));
  assert.deepEqual(f.pinchLifecycle, ['begin']);
  f.listeners.get('touchend')!(f.event(0, 1));
  assert.deepEqual(f.pinchLifecycle, ['begin']);
  f.listeners.get('touchend')!(f.event(0, 0));
  assert.deepEqual(f.pinchLifecycle, ['begin', 'end']);
  f.cleanup();
});
