import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = readFileSync(new URL('../../src/components/CalendarPageCore.tsx', import.meta.url), 'utf8');
function handlers(resize: boolean) {
  const start = source.indexOf('    const onMove =', source.indexOf('// Global move/resize handlers'));
  const end = source.indexOf('    const mm =', start);
  let pending = 0;
  let visualDelta = 0;
  const dependencies: Record<string, unknown> = {
    dragMoveMeeting: resize ? null : { id: 'meeting' }, resizeMeeting: resize ? { id: 'meeting', start_time: '07:00' } : null,
    dragMoveStartX: 100, dragMoveStartY: 100, resizeStartY: 100,
    slotHeight: 8, viewMode: 'week', originDay: 0, getDayIndexFromX: () => 0,
    dragMovedRef: { current: false }, dragMoveOriginalSlot: 14, dragMoveOriginalEndSlot: 16,
    dragMoveOriginalDate: '2026-10-26', resizeOriginalEndSlot: 16,
    HOURS_END: 24, HOURS_START: 0, minutesToTime: (minutes: number) => String(minutes), timeToMinutes: () => 420,
    setDragMoveCurrentDeltaSlot: (v: number) => { visualDelta = v; }, setDragMoveCurrentDeltaDay() {},
    setResizeCurrentDelta: (v: number) => { visualDelta = v; },
    setDragMoveMeeting() {}, setResizeMeeting() {},
    setPendingMove: () => { pending++; }, setPendingResize: () => { pending++; },
  };
  const runtime = new Function(...Object.keys(dependencies), `${stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' })}; return {onMove,onEnd};`)(...Object.values(dependencies));
  return { ...runtime, result: () => ({ pending, visualDelta }) };
}
for (const resize of [false, true]) {
  test(`${resize ? 'resize' : 'move'} ignores touch jitter after a hold in a compressed working-day view`, async () => {
    const h = handlers(resize);
    h.onMove(100, 105, true);
    assert.equal(h.result().visualDelta, 0);
    await h.onEnd(100, 105, true);
    assert.equal(h.result().pending, 0);
  });
  test(`${resize ? 'resize' : 'move'} still accepts deliberate touch movement`, async () => {
    const h = handlers(resize);
    h.onMove(100, 116, true);
    assert.notEqual(h.result().visualDelta, 0);
    await h.onEnd(100, 116, true);
    assert.equal(h.result().pending, 1);
  });
}
test('desktop mouse movement retains its existing precision', async () => {
  const h = handlers(false);
  await h.onEnd(100, 105, false);
  assert.equal(h.result().pending, 1);
});
