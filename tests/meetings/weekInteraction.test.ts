import assert from 'node:assert/strict';
import test from 'node:test';
import { weekDayIndex, weekDragInsets } from '../../src/components/Calendar/weekInteraction';

for (const dayWidth of [38, 112, 224, 304]) {
  test(`day hit testing uses actual day geometry at width ${dayWidth}, including a horizontally scrolled RTL grid`, () => {
    for (const right of [334, 1006]) {
      const grid = { right, width: 7 * dayWidth };
      for (let day = 0; day < 7; day++) assert.equal(weekDayIndex(right - (day + 0.5) * dayWidth, grid), day);
      assert.equal(weekDayIndex(right + 56, grid), 0);
      assert.equal(weekDayIndex(right - grid.width - 50, grid), 6);
    }
  });
}
test('drag ghost moves by full day columns even for overlapping narrow cards', () => {
  assert.deepEqual(weekDragInsets(1, 0, 100), { right: 'calc(100% + 2px)', left: 'calc(-100% + 2px)' });
  assert.deepEqual(weekDragInsets(1, 0, 50), { right: 'calc(100% + 2px)', left: 'calc(-50% + 2px)' });
  assert.deepEqual(weekDragInsets(-2, 50, 50), { right: 'calc(-150% + 2px)', left: 'calc(200% + 2px)' });
});

import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

test('edge drag scrolls the zoomed week and retains the original day when confirming the move', async () => {
  const source = readFileSync(new URL('../../src/components/CalendarPageCore.tsx', import.meta.url), 'utf8');
  const start = source.indexOf('  useEffect(() => {', source.indexOf('// Global move/resize handlers')) + '  useEffect(() => {'.length;
  const end = source.indexOf('\n  }, [', start);
  const listeners = new Map<string, Function>();
  const frames = new Map<number, Function>();
  let frameId = 0;
  let scroll = 0;
  let delta = 0;
  let pending: any = null;
  const scroller = {
    get scrollLeft() { return scroll; },
    set scrollLeft(value: number) { scroll = Math.max(-400, Math.min(0, value)); },
    getBoundingClientRect: () => ({ left: 0, right: 390 }),
  };
  const dependencies = {
    weekDays: [{ jy: 1405, jm: 8, jd: 4 }], jalaaliToYYYYMMDD: () => '2026-10-26',
    getDayIndexFromX: (x: number) => weekDayIndex(x, { right: 334 - scroll, width: 700 }),
    dragMoveMeeting: { id: 'meeting' }, resizeMeeting: null,
    dragMoveStartX: 284, dragMoveStartY: 100, resizeStartY: 100, slotHeight: 20,
    viewMode: 'week', dragMovedRef: { current: false }, dragMoveOriginalDate: '2026-10-26',
    dragMoveOriginalSlot: 14, dragMoveOriginalEndSlot: 16, resizeOriginalEndSlot: 16,
    timeScrollRef: { current: scroller }, HOURS_START: 0, HOURS_END: 24,
    minutesToTime: (n: number) => String(n), timeToMinutes: () => 420,
    setDragMoveCurrentDeltaSlot() {}, setDragMoveCurrentDeltaDay: (n: number) => { delta = n; },
    setResizeCurrentDelta() {}, setDragMoveMeeting() {}, setResizeMeeting() {},
    setPendingMove: (move: any) => { pending = move; }, setPendingResize() {},
    document: { addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) },
    requestAnimationFrame: (fn: Function) => { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  };
  const cleanup = new Function(...Object.keys(dependencies), stripTypeScriptTypes(`function mount() { ${source.slice(start, end)} }`, { mode: 'transform' }) + '; return mount();')(...Object.values(dependencies));
  listeners.get('touchmove')!({ touches: [{ clientX: 10, clientY: 100 }], preventDefault() {} });
  const before = delta;
  for (let i = 0; i < 80; i++) {
    const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn());
  }
  assert.ok(scroll < 0);
  assert.ok(delta > before, 'the stationary pointer reaches later days as the viewport scrolls');
  await listeners.get('touchend')!({ changedTouches: [{ clientX: 10, clientY: 100 }] });
  assert.equal(pending.oldDateIso, '2026-10-26');
  assert.equal(pending.newDateIso, '2026-11-01');
  assert.equal(pending.ns, 14);
  cleanup();
  assert.equal(frames.size, 0);
  assert.equal(listeners.size, 0);
});
