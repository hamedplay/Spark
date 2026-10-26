import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

test('fresh banners display in the same turn without waiting behind a six-second toast',async t=>{
  const shown:{id:string;notificationId:string}[]=[];const removed:string[]=[];
  (globalThis as any).__latencyToast={custom(render:Function){const id=`toast-${shown.length+1}`;const element=render({id,visible:true});shown.push({id,notificationId:element.props.notification.id});return id;},remove(id:string){removed.push(id);},dismiss(){}};
  const server=await createServer({configFile:false,ssr:{noExternal:['react-hot-toast']},server:{middlewareMode:true},appType:'custom',plugins:[react(),{name:'latency-toast-fixture',enforce:'pre',resolveId(source){if(source==='react-hot-toast')return '\0latency-toast';},load(id){if(id==='\0latency-toast')return 'export default globalThis.__latencyToast';}}]});
  let reset:Function|undefined;
  try{
    const module=await server.ssrLoadModule('/src/features/notifications/services/showIncomingNotification.tsx');reset=module.resetIncomingNotificationQueue;
    t.mock.timers.enable({apis:['setTimeout']});
    Object.assign(globalThis,{window:{setTimeout:(fn:Function,ms:number)=>setTimeout(fn as any,ms),clearTimeout:(id:any)=>clearTimeout(id)}});
    const n=(id:string)=>({id,title:id,message:id,type:'system',read:false,created_at:'2026-10-27T00:00:00Z'});
    module.showIncomingNotification(n('first'));assert.equal(shown.length,1);
    module.showIncomingNotification(n('second'));assert.equal(shown.length,2);assert.equal(shown[1].notificationId,'second');assert.deepEqual(removed,['toast-1']);
    module.showIncomingNotification(n('second'));assert.equal(shown.length,2,'active duplicate does not re-alert');
    module.showIncomingNotification(n('third'));assert.equal(shown.length,3);assert.equal(shown[2].notificationId,'third');
    t.mock.timers.tick(20_000);assert.equal(shown.length,3,'old timeout cannot resurrect queued banners');
  }finally{reset?.();delete (globalThis as any).window;await server.close();}
});
