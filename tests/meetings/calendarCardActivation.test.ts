import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import * as gestures from '../../src/components/Calendar/calendarCardGestures';

const source = readFileSync(new URL('../../src/components/Calendar/CalendarViewShared.tsx', import.meta.url), 'utf8');
let baseline = 10000;
function fixture(t: any, editable = true) {
  let now = baseline += 10000;
  const originalNow = Date.now;
  const originalWindow = (globalThis as any).window;
  let next = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const windowMock = {
    setTimeout(callback: () => void, delay: number) { timers.set(++next, { at: now + delay, callback }); return next; },
    clearTimeout(id: number) { timers.delete(id); }, addEventListener() {}, removeEventListener() {},
  };
  Object.assign(globalThis, { window: windowMock });
  Date.now = () => now;
  gestures.beginCalendarPinch(); gestures.endCalendarPinch(); now += 600;
  t.after(() => { gestures.beginCalendarPinch(); gestures.endCalendarPinch(); Date.now = originalNow; (globalThis as any).window = originalWindow; });
  const actions: string[] = [];
  const deps = {
    ...gestures, canMove: editable, meeting: {id: 'card'}, origDateStr: '2026-10-26', startSlot:14, endSlot:16,
    MEETING_TOUCH_LONG_PRESS_MS:1000, MEETING_RESIZE_LONG_PRESS_MS:1200, MEETING_TOUCH_MOVE_CANCEL_PX:12, MEETING_DOUBLE_TAP_MS:320,
    dragMovedRef: {current:false}, resizeMeeting:null,
    setPreviewMeeting: (m: unknown) => { if(m) actions.push('preview'); }, setDetailMeeting: () => actions.push('details'),
    handleBlockClick: () => actions.push('preview'), handleEditMeeting: () => actions.push('edit'),
    setDragMoveMeeting: (m: unknown) => {if(m) actions.push('drag');}, setDragMoveStartY() {}, setDragMoveStartX() {},
    setDragMoveOriginalSlot() {}, setDragMoveOriginalEndSlot() {}, setDragMoveCurrentDeltaSlot() {}, setDragMoveCurrentDeltaDay() {}, setDragMoveOriginalDate() {},
    setResizeMeeting: (m: unknown) => { if(m) actions.push('resize'); }, setResizeStartY() {}, setResizeOriginalEndSlot() {}, setResizeCurrentDelta() {},
    window:windowMock, document:{addEventListener() {},removeEventListener() {}},
  };
  const start = source.indexOf('  const onBlockTouch =');
  const end = source.indexOf('  let ghostStyle:', start);
  const handlers = new Function(...Object.keys(deps), `${stripTypeScriptTypes(source.slice(start,end), {mode:'transform'})}; return {onBlockTouch,onBlockTouchMove,onBlockTouchEnd,onCardClick,onCardDoubleClick,onResizeTouch,onResizeTouchMove,onResizeTouchEnd,onResizeDown};`)(...Object.values(deps));
  const target = {isConnected:true};
  const event = (count = 1, y = 100) => ({button:0,clientX:100,clientY:y,nativeEvent:{},currentTarget:target,touches:Array.from({length:count},()=>({clientX:100,clientY:y})),stopPropagation(){},preventDefault(){}});
  const tick = (ms:number) => {
    now += ms;
    for (const [id, task] of [...timers]) if(task.at<=now) {timers.delete(id);task.callback();}
  };
  return {handlers,event,tick,actions,timers};
}

test('single touch opens the preview with choices; double touch edits without a delayed preview', t => {
  const f=fixture(t);
  f.handlers.onBlockTouch(f.event()); f.handlers.onBlockTouchEnd(f.event(0)); f.tick(320);
  assert.deepEqual(f.actions,['preview']);
  f.actions.length=0; f.tick(500);
  f.handlers.onBlockTouch(f.event()); f.handlers.onBlockTouchEnd(f.event(0)); f.tick(80);
  f.handlers.onBlockTouch(f.event()); f.handlers.onBlockTouchEnd(f.event(0)); f.tick(1200);
  assert.deepEqual(f.actions,['edit']);
});
test('mouse double-click edits directly and cancels both queued single clicks', t => {
  const f=fixture(t);
  f.handlers.onCardClick(f.event()); f.tick(80); f.handlers.onCardClick(f.event()); f.handlers.onCardDoubleClick(f.event()); f.tick(1500);
  assert.deepEqual(f.actions,['edit']);
});
test('read-only double tap opens details without granting edit access', t => {
  const f=fixture(t,false);
  f.handlers.onBlockTouch(f.event()); f.handlers.onBlockTouchEnd(f.event(0)); f.tick(80);
  f.handlers.onBlockTouch(f.event()); f.handlers.onBlockTouchEnd(f.event(0)); f.tick(500);
  assert.deepEqual(f.actions,['details']);
});
test('a short bottom-edge touch behaves like a card tap even on a tiny card', t => {
  const f=fixture(t);
  f.handlers.onResizeTouch(f.event()); f.tick(50); f.handlers.onResizeTouchEnd(f.event(0)); f.tick(320);
  assert.deepEqual(f.actions,['preview']);
});
test('bottom-edge double tap edits, while scrolling across the edge does not open anything', t => {
  const f=fixture(t);
  f.handlers.onResizeTouch(f.event()); f.handlers.onResizeTouchEnd(f.event(0)); f.tick(80);
  f.handlers.onResizeTouch(f.event()); f.handlers.onResizeTouchEnd(f.event(0)); f.tick(1500);
  assert.deepEqual(f.actions,['edit']);
  f.actions.length=0; f.tick(1000);
  f.handlers.onResizeTouch(f.event()); f.handlers.onResizeTouchMove(f.event(1,140)); f.handlers.onResizeTouchEnd(f.event(0,140)); f.tick(1500);
  assert.deepEqual(f.actions,[]);
});
test('pinch cancels pending holds and previews across cards and keeps activation blocked until all fingers finish', t => {
  const f=fixture(t);
  f.handlers.onCardClick(f.event());
  f.handlers.onBlockTouch(f.event());
  f.handlers.onResizeTouch(f.event());
  assert.ok(f.timers.size>0);
  gestures.beginCalendarPinch();
  assert.equal(f.timers.size,0);
  f.tick(2000);
  f.handlers.onBlockTouchEnd(f.event(1));
  f.handlers.onCardClick(f.event()); f.handlers.onCardDoubleClick(f.event());
  assert.deepEqual(f.actions,[]);
  gestures.endCalendarPinch();
  f.handlers.onCardClick(f.event()); f.tick(100);
  assert.deepEqual(f.actions,[]);
  f.tick(600);
  f.handlers.onCardClick(f.event()); f.tick(320);
  assert.deepEqual(f.actions,['preview']);
});


test('a second finger detected on the card itself cancels its first-finger hold', t => {
  const f=fixture(t);
  f.handlers.onBlockTouch(f.event()); f.tick(50);
  f.handlers.onBlockTouchMove(f.event(2)); f.tick(1500);
  f.handlers.onBlockTouchEnd(f.event(0)); f.tick(600);
  assert.deepEqual(f.actions,[]);
  assert.equal(f.timers.size,0);
});
