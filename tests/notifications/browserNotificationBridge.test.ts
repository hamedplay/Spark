import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
let server: ViteDevServer;
let counter = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
before(async () => {
  server = await createServer({ configFile: false, ssr: { noExternal: ['react-hot-toast'] }, server: { middlewareMode: true }, appType: 'custom', plugins: [react(), {
    name: 'notification-test-client', enforce: 'pre',
    resolveId(source, importer) { if (source === 'react-hot-toast') return '\0notification-toast'; if ((source === './supabase' && importer?.includes('pwaNotificationBridge')) || source.endsWith('/lib/supabase')) return '\0notification-client'; },
    load(id) { if (id === '\0notification-toast') return 'export default {success(){}, error(){}}'; if (id === '\0notification-client') return 'export const supabase = {functions:{invoke:(...args)=>globalThis.__pushClient.functions.invoke(...args)}, rpc:(...args)=>globalThis.__pushClient.rpc(...args)}'; },
  }] });
});
after(async () => { await server.close(); });
async function fixture(permission = 'default', ios = false) {
  const storage = new Map<string,string>(); const workerMessages: any[] = [], rpc: any[] = [];
  let requests = 0, invokes = 0, unsubscribed = 0;
  const subscription = { endpoint: 'https://push.example.test/temporary', options: {}, toJSON: () => ({ keys: { p256dh: 'key', auth: 'auth' } }), unsubscribe: async () => { unsubscribed++; return true; } };
  const serviceWorker = Object.assign(new EventTarget(), { getRegistration: async () => registration, ready: Promise.resolve(undefined), register: async () => registration });
  const registration = { active: { postMessage: (value: any) => workerMessages.push(value) }, pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } };
  const window = Object.assign(new EventTarget(), { isSecureContext: true, location: { origin: 'https://spark.test' }, matchMedia: () => ({ matches: false }), atob: globalThis.atob });
  const document = { visibilityState: 'visible' };
  class Notification { static permission = permission; static async requestPermission() { requests++; this.permission = 'granted'; return 'granted'; } }
  Object.defineProperty(globalThis,'window',{value:window,configurable:true});
  Object.defineProperty(globalThis,'document',{value:document,configurable:true});
  Object.defineProperty(globalThis,'Notification',{value:Notification,configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{serviceWorker,userAgent:ios?'iPhone':'Desktop',platform:'',maxTouchPoints:0},configurable:true});
  Object.defineProperty(globalThis,'localStorage',{value:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)},configurable:true});
  (globalThis as any).__pushClient = { functions: { async invoke() { invokes++; return { data: { publicKey: 'AQID' }, error: null }; } }, async rpc(name: string,args: any) { rpc.push({name,args}); return { data: null, error: null }; } };
  const bridge = await server.ssrLoadModule(`/src/lib/pwaNotificationBridge.ts?test=${++counter}`);
  return { bridge, window, Notification, workerMessages, rpc, storage, client:(globalThis as any).__pushClient, stats:()=>({requests,invokes,unsubscribed}) };
}
test('desktop web registers without PWA installation; permission is requested only by explicit activation', async () => {
  const h = await fixture(); const stop = h.bridge.startPwaNotificationBridge('owner',true);
  await tick(); assert.equal(h.stats().requests,0); assert.equal(h.stats().invokes,0);
  const activation = h.bridge.enableBrowserNotifications(); assert.equal(h.stats().requests,1); await activation; await tick();
  assert.equal(h.bridge.getBrowserPushState().status,'ready'); assert.equal(h.rpc[0].name,'upsert_my_pwa_push_subscription');
  await h.bridge.notifyBrowser({id:'one',user_id:'owner'},'owner'); await h.bridge.notifyBrowser({id:'one',user_id:'owner'},'owner');
  await h.bridge.notifyBrowser({id:'read',read:true},'owner'); await h.bridge.notifyBrowser({id:'other',user_id:'other'},'owner');
  assert.equal(h.workerMessages.length,1); stop(); await tick();
});
test('denied permission and iPhone browser display actionable status without a registration attempt', async () => {
  const denied = await fixture('denied'); const a=denied.bridge.startPwaNotificationBridge('owner',true);
  await tick(); assert.equal(denied.bridge.getBrowserPushState().status,'permission-denied'); assert.equal(denied.stats().invokes,0); a(); await tick();
  const ios=await fixture(); Object.assign(navigator,{userAgent:'iPhone'});
  const b=ios.bridge.startPwaNotificationBridge('owner',true); await ios.bridge.enableBrowserNotifications();
  assert.equal(ios.bridge.getBrowserPushState().status,'not-installed'); assert.equal(ios.stats().requests,0); b(); await tick();
});
test('disabled preferences suppress registration and notifications; local disable retires this device only', async () => {
  const h=await fixture('granted'); let stop=h.bridge.startPwaNotificationBridge('owner',false);
  await tick(); await h.bridge.notifyBrowser({id:'disabled'},'owner'); assert.equal(h.stats().invokes,0); assert.equal(h.workerMessages.length,0);
  stop(); stop=h.bridge.startPwaNotificationBridge('owner',true); await tick();
  await h.bridge.disableBrowserNotifications(); assert.equal(h.bridge.getBrowserPushState().status,'disabled-by-preference');
  assert.ok(h.rpc.some((call:any)=>call.name==='disable_my_pwa_push_subscription')); assert.equal(h.stats().unsubscribed,1);
  await h.bridge.notifyBrowser({id:'disabled-device'},'owner'); assert.equal(h.workerMessages.length,0); stop(); await tick();
});
test('logout cancels a pending subscription before it can be saved for the wrong account', async () => {
  const h=await fixture('granted'); let release!: Function;
  h.client.functions.invoke=()=>new Promise(resolve=>{release=resolve;});
  const stop=h.bridge.startPwaNotificationBridge('owner',true); await tick(); stop();
  release({data:{publicKey:'AQID'},error:null}); await tick();
  assert.ok(!h.rpc.some((call:any)=>call.name==='upsert_my_pwa_push_subscription'));
});
test('StrictMode restart does not unsubscribe a still-mounted account', async () => {
  const h=await fixture('granted'); const a=h.bridge.startPwaNotificationBridge('owner',true); a();
  const b=h.bridge.startPwaNotificationBridge('owner',true); await tick(); assert.equal(h.stats().unsubscribed,0); b(); await tick();
});

test('saved messages expose a visible clear-history control; ordinary chats do not', async () => {
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { ConversationHeader } = await server.ssrLoadModule('/src/components/Chat/Conversation/ConversationHeader.tsx');
  const props = { conversation:{id:'self',otherUser:{}}, otherName:'Saved', isSavedMessages:true,
    isUserOnline:()=>false,getLastSeenText:()=>'',localStarredCount:0,remindersCount:0 };
  const saved = renderToStaticMarkup(createElement(ConversationHeader,props));
  assert.ok(saved.includes('پاک کردن تاریخچه پیام‌های ذخیره‌شده'));
  const regular = renderToStaticMarkup(createElement(ConversationHeader,{...props,isSavedMessages:false}));
  assert.ok(!regular.includes('پاک کردن تاریخچه پیام‌های ذخیره‌شده'));
});
