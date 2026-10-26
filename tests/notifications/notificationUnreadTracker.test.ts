import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotificationUnreadTracker } from '../../src/features/notifications/models/notificationUnreadTracker';
import type { AppNotification } from '../../src/features/notifications/types/appNotification';
const n=(id:string,read=false)=>({id,read,title:id,message:id,type:'system',created_at:'2026-10-27T00:00:00Z'} as AppNotification);

test('new unread badge updates synchronously and a slower earlier count cannot undo it',()=>{
  const t=createNotificationUnreadTracker();t.applyResponse(t.beginRequest(),120);
  const pending=t.beginRequest();assert.equal(t.inserted(n('new')),121);
  assert.equal(t.applyResponse(pending,120),false);assert.equal(t.count,121);
  assert.equal(t.applyResponse(t.beginRequest(),121),true);
});
test('catch-up snapshots plus insert callbacks count once and preserve totals above the visible list limit',()=>{
  const t=createNotificationUnreadTracker();t.snapshot([n('old')]);t.applyResponse(t.beginRequest(),100);
  t.snapshot([n('new'),n('old')]);assert.equal(t.inserted(n('new')),101);assert.equal(t.inserted(n('new')),101);
});
test('read/delete events and their local echoes do not decrement the badge twice',()=>{
  const t=createNotificationUnreadTracker();t.snapshot([n('one'),n('two')]);t.applyResponse(t.beginRequest(),50);
  assert.equal(t.updated(n('one',true)),49);assert.equal(t.updated(n('one',true)),49);
  assert.equal(t.deleted('two'),48);assert.equal(t.deleted('two'),48);
  assert.equal(t.updated(n('one',false)),49);
});
test('mark-all-read keeps later arrivals and rejects older count responses',()=>{
  const t=createNotificationUnreadTracker();t.snapshot([n('one')]);t.applyResponse(t.beginRequest(),10);
  const old=t.beginRequest();assert.equal(t.markAllRead(),0);assert.equal(t.inserted(n('later')),1);
  assert.equal(t.applyResponse(old,10),false);assert.equal(t.count,1);
});
test('reset invalidates another account count and newer responses win',()=>{
  const t=createNotificationUnreadTracker();const old=t.beginRequest();t.reset();assert.equal(t.applyResponse(old,90),false);
  const a=t.beginRequest(),b=t.beginRequest();assert.equal(t.applyResponse(b,8),true);assert.equal(t.applyResponse(a,3),false);assert.equal(t.count,8);
});
