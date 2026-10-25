import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';

const source = readFileSync(new URL('../../src/components/Calendar/CalendarViewShared.tsx', import.meta.url), 'utf8');
function fixture() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const listeners = new Map<string, Function>();
  const addEventListener = (name: string, callback: Function) => listeners.set(name, callback);
  const removeEventListener = (name: string) => listeners.delete(name);
  const holds = new Map();
  const touchHolds = new Map();
  const changes: unknown[] = [];
  const deps = {
    canMove: true, meeting: { id: 'meeting' }, endSlot: 16,
    MEETING_RESIZE_LONG_PRESS_MS: 1200, MEETING_TOUCH_MOVE_CANCEL_PX: 12,
    meetingTouchSuppressClickUntil: new Map(), meetingResizeMouseHolds: holds,
    meetingTouchSingleTapTimers: new Map(), meetingTouchLastTapAt: new Map(),
    meetingResizeTouchHoldStates: touchHolds,
    clearMeetingResizeTouchHold: (id: string) => touchHolds.delete(id),
    setResizeMeeting: (value: unknown) => changes.push(value), setResizeStartY() {}, setResizeOriginalEndSlot() {}, setResizeCurrentDelta() {},
    window: { setTimeout: (callback: () => void, delay: number) => { timers.set(++next, { at: now + delay, callback }); return next; }, clearTimeout: (id: number) => timers.delete(id), addEventListener, removeEventListener },
    document: { addEventListener, removeEventListener },
  };
  const start = source.indexOf('  const onResizeDown =');
  const end = source.indexOf('  const onResizeTouch =', start);
  const runtime = new Function(...Object.keys(deps), `${stripTypeScriptTypes(source.slice(start, end), { mode: 'transform' })}; return onResizeDown;`)(...Object.values(deps));
  const cancelStart = source.indexOf('  const onResizeTouchCancel =');
  const cancelEnd = source.indexOf('\n\n', cancelStart);
  const cancel = new Function(...Object.keys(deps), `${stripTypeScriptTypes(source.slice(cancelStart, cancelEnd), { mode: 'transform' })}; return onResizeTouchCancel;`)(...Object.values(deps));
  runtime({ button: 0, clientX: 100, clientY: 100, nativeEvent: {}, currentTarget: { isConnected: true }, stopPropagation() {}, preventDefault() {} });
  return { changes, listeners, holds, touchHolds, cancel, tick: (ms: number) => {
    now += ms;
    for (const [id, task] of [...timers]) if (task.at <= now) { timers.delete(id); task.callback(); }
  } };
}

test('bottom handle does not resize until the deliberate 1.2 second mouse hold', () => {
  const f = fixture();
  f.tick(1199);
  assert.equal(f.changes.length, 0);
  f.tick(1);
  assert.deepEqual(f.changes, [{ id: 'meeting' }]);
  f.listeners.get('mouseup')!();
  assert.equal(f.listeners.size, 0);
});
for (const action of ['mouseup', 'mousemove']) {
  test(`early ${action} cancels the handle hold`, () => {
    const f = fixture();
    f.listeners.get(action)!({ clientX: 100, clientY: 120 });
    f.tick(2000);
    assert.equal(f.changes.length, 0);
    assert.equal(f.holds.size, 0);
    assert.equal(f.listeners.size, 0);
  });
}
test('losing focus cancels an active resize', () => {
  const f = fixture();
  f.tick(1200);
  f.listeners.get('blur')!();
  assert.deepEqual(f.changes, [{ id: 'meeting' }, null]);
  assert.equal(f.listeners.size, 0);
});
test('touch cancellation clears active resize instead of leaking it into the next gesture', () => {
  const f = fixture();
  f.touchHolds.set('meeting', { activated: true });
  f.cancel({ stopPropagation() {} });
  assert.deepEqual(f.changes, [null]);
  assert.equal(f.touchHolds.size, 0);
  f.listeners.get('mouseup')!();
});
