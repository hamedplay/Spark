import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';

test('notification transport uses shared invalidations and retries PostgreSQL system errors after socket join', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  const channels:any[]=[];let invalidate!:()=>Promise<void>;let stopped=0,refreshes=0;
  const errors:unknown[]=[];
  Object.assign(globalThis,{window:new EventTarget(),document:Object.assign(new EventTarget(),{visibilityState:'visible'})});
  (globalThis as any).__notificationTransport={
    realtime:{async setAuth(){}},async removeChannel(){},
    channel(name:string){const handlers=new Map<string,Function>();const ch={name,handlers,on(type:string,filter:any,fn:Function){handlers.set(type==='system'?type:filter.event,fn);return ch;},subscribe(fn:Function){ch.status=fn;return ch;},status:undefined as any};channels.push(ch);return ch;},
  };
  (globalThis as any).__notificationWatch=(tables:string[],callback:()=>Promise<void>)=>{assert.deepEqual(tables,['notifications']);invalidate=callback;return()=>{stopped++;};};
  const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',plugins:[{name:'notification-transport-fixtures',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return '\0notification-client';if(source.endsWith('/shared/realtime/liveDataBus'))return '\0notification-watch';},load(id){if(id==='\0notification-client')return 'export const supabase=globalThis.__notificationTransport';if(id==='\0notification-watch')return 'export const watchLiveData=globalThis.__notificationWatch';}}]});
  try {
    const {subscribeToUserNotificationChanges}=await server.ssrLoadModule('/src/features/notifications/services/notificationRealtime.ts');
    const stop=subscribeToUserNotificationChanges('owner',{onInsert(){},onUpdate(){},onInvalidated:async()=>{refreshes++;},onError:(error:unknown)=>errors.push(error)});
    await Promise.resolve();await Promise.resolve();
    const joined=channels.find(ch=>ch.name==='notifications-bell-owner');assert.ok(joined);
    joined.status('SUBSCRIBED');
    await invalidate();assert.equal(refreshes,1);
    joined.handlers.get('system')({extension:'postgres_changes',status:'error',message:'subscription unavailable'});
    assert.equal(errors.length,1);
    t.mock.timers.tick(1000);await Promise.resolve();await Promise.resolve();
    assert.equal(channels.filter(ch=>ch.name==='notifications-bell-owner').length,2);
    stop();assert.equal(stopped,1);await invalidate();assert.equal(refreshes,1);
  }finally{await server.close();delete (globalThis as any).window;delete (globalThis as any).document;}
});
