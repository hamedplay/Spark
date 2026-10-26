import assert from 'node:assert/strict';
import test from 'node:test';
import { shareMeetingImage, shareMeetingText } from '../../src/features/meetings/sharing/nativeMeetingShare';

function browser(t: any, value: object) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete (globalThis as any).navigator;
  });
}
const file = new File(['png'], 'meeting.png', { type: 'image/png' });

test('text invokes native sharing immediately in the click activation, without copying', async t => {
  let called = false;
  browser(t, { share(data: ShareData) { called = true; assert.deepEqual(data, {title:'جلسه',text:'متن'}); return Promise.resolve(); } });
  const result = shareMeetingText('جلسه','متن');
  assert.equal(called,true);
  assert.equal(await result,'shared');
});
test('text falls back to clipboard when native sharing is unavailable', async t => {
  let copied = '';
  browser(t,{clipboard:{writeText(text: string) {copied=text;return Promise.resolve();}}});
  assert.equal(await shareMeetingText('جلسه','متن'),'copied');
  assert.equal(copied,'متن');
});
test('denied native text sharing falls back to clipboard', async t => {
  browser(t,{share:()=>Promise.reject(new DOMException('denied','NotAllowedError')),clipboard:{writeText:()=>Promise.resolve()}});
  assert.equal(await shareMeetingText('جلسه','متن'),'copied');
});
test('clipboard denial and missing APIs request the selectable-text fallback', async t => {
  browser(t,{clipboard:{writeText:()=>Promise.reject(new Error('denied'))}});
  assert.equal(await shareMeetingText('جلسه','متن'),'unsupported');
  Object.defineProperty(globalThis,'navigator',{value:{},configurable:true});
  assert.equal(await shareMeetingText('جلسه','متن'),'unsupported');
});
test('cancelling native share does not trigger clipboard or download fallbacks', async t => {
  browser(t,{share:()=>Promise.reject(new DOMException('cancel','AbortError')),clipboard:{writeText:()=>{throw new Error('must not copy');}}});
  assert.equal(await shareMeetingText('جلسه','متن'),'cancelled');
  assert.equal(await shareMeetingImage('جلسه',file),'cancelled');
});
test('image sharing works without canShare and invokes native sharing synchronously', async t => {
  let called = false;
  browser(t,{share(data: ShareData) {called=true;assert.deepEqual(data.files,[file]);return Promise.resolve();}});
  const result=shareMeetingImage('جلسه',file);
  assert.equal(called,true);
  assert.equal(await result,'shared');
});
test('unsupported image sharing requests a download instead of silently stopping', async t => {
  browser(t,{canShare:()=>false,share:()=>{throw new Error('must not share');}});
  assert.equal(await shareMeetingImage('جلسه',file),'unsupported');
});
test('rejected file share requests a download', async t => {
  browser(t,{canShare:()=>true,share:()=>Promise.reject(new DOMException('denied','NotAllowedError'))});
  assert.equal(await shareMeetingImage('جلسه',file),'unsupported');
});
