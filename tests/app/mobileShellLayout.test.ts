import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationPanelLayout } from '../../src/features/notifications/models/notificationPanelLayout';
import { trapOverlayTab } from '../../src/app/layout/hooks/useModalFocus';
import { detectMobileNavigation } from '../../src/app/layout/hooks/useMobileNavigation';

for (const [width,height] of [[320,568],[360,640],[390,844],[430,932],[844,390],[1440,900]]) {
  test(`notification panel fits ${width}x${height}, stays bounded, and preserves page context`, () => {
    for (const anchor of [40,width/2,width-10]) {
      const layout = notificationPanelLayout(width,height,{right:anchor,bottom:54});
      assert.ok(layout.left>=8);
      assert.ok(layout.left+layout.width<=width-8);
      assert.ok(layout.top>=8);
      assert.ok(layout.top+layout.maxHeight<=height-8);
      assert.ok(layout.maxHeight<=height*0.62);
      assert.ok(layout.width<=420);
    }
  });
}
test('navigation treats a touch phone with a desktop-like viewport as mobile', t => {
  const previous = (globalThis as any).window;
  t.after(() => { (globalThis as any).window = previous; });
  (globalThis as any).window = { innerWidth:1280,innerHeight:900,screen:{width:390,height:844},matchMedia:()=>({matches:true}) };
  assert.equal(detectMobileNavigation(),true);
  (globalThis as any).window = { innerWidth:1440,innerHeight:900,screen:{width:1440,height:900},matchMedia:()=>({matches:false}) };
  assert.equal(detectMobileNavigation(),false);
});
test('modal keyboard navigation wraps inside the open panel and skips hidden controls', t => {
  const previous = (globalThis as any).document;
  t.after(() => { (globalThis as any).document = previous; });
  let focused = '';
  let prevented = 0;
  const first = {getClientRects:()=>[1],focus:()=>{focused='first';}};
  const last = {getClientRects:()=>[1],focus:()=>{focused='last';}};
  const hidden = {getClientRects:()=>[],focus:()=>{focused='hidden';}};
  const panel = {querySelectorAll:()=>[first,hidden,last],contains:(target:unknown)=>target===first||target===last||target===panel,focus:()=>{focused='panel';}} as unknown as HTMLElement;
  const event = (shift=false) => ({key:'Tab',shiftKey:shift,preventDefault(){prevented++;}} as KeyboardEvent);
  (globalThis as any).document = {activeElement:last};
  trapOverlayTab(event(),panel);
  assert.equal(focused,'first');
  (globalThis as any).document.activeElement=first;
  trapOverlayTab(event(true),panel);
  assert.equal(focused,'last');
  (globalThis as any).document.activeElement={};
  trapOverlayTab(event(),panel);
  assert.equal(focused,'first');
  assert.equal(prevented,3);
});
test('a loading or empty overlay keeps focus on its own container', t => {
  const previous = (globalThis as any).document;
  t.after(() => { (globalThis as any).document = previous; });
  (globalThis as any).document = {activeElement:null};
  let focused=false;
  const panel={querySelectorAll:()=>[],focus:()=>{focused=true;}} as unknown as HTMLElement;
  trapOverlayTab({key:'Tab',preventDefault(){}} as KeyboardEvent,panel);
  assert.equal(focused,true);
});
