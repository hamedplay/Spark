import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {transform} from 'esbuild';

const edge=readFileSync('supabase/functions/bale-link-generate/index.ts','utf8').replace(/^import.*$/gm,'');
async function endpoint({error=null,active=true,authorized=true}: {error?:any;active?:boolean;authorized?:boolean}={}) {
 let handler:any;let rpcCalls=0;
 const query:any={select(){return query;},eq(){return query;},maybeSingle:async()=>({data:{bot_username:'spark_bot',is_active:active},error:null})};
 const client={from:()=>query,rpc:async()=>{rpcCalls++;return {data:error?null:{ok:true,nonce:'a'.repeat(64),expires_at:'2026-11-07T20:00:00Z'},error};}};
 vm.runInNewContext((await transform(edge,{loader:'ts'})).code,{Request,Response,console:{error(){}},
  Deno:{serve:(fn:any)=>handler=fn,env:{get:()=> 'configured'}},createClient:()=>client,
  requireFullAuthAccess:async()=>({ok:authorized,userId:'verified-user'}),deniedResponse:()=>new Response('{}',{status:403})});
 const response=await handler(new Request('https://spark.test/functions/v1/bale-link-generate',{method:'POST'}));
 return {response,data:await response.json(),rpcCalls};
}
test('authenticated link generation returns a one-time Bale deep link without bot credentials',async()=>{
 const {response,data}=await endpoint();assert.equal(response.status,200);
 assert.equal(data.url,`https://ble.ir/spark_bot?start=${'a'.repeat(64)}`);assert.equal(data.ok,true);
 assert.ok(!JSON.stringify(data).includes('bot_token'));
});
for(const code of ['BALE_LINK_HMAC_KEY_NOT_CONFIGURED','BALE_CHAT_ENCRYPTION_KEY_NOT_CONFIGURED'])test(`missing Vault configuration is actionable without exposing server details (${code})`,async()=>{
 const {response,data}=await endpoint({error:{message:code}});
 assert.equal(response.status,503);assert.equal(data.errorCode,'BALE_LINK_CRYPTO_NOT_CONFIGURED');
 assert.ok(!JSON.stringify(data).includes(code));
});
test('missing database RPC has a distinct readiness result; unexpected failures remain failures',async()=>{
 const missing=await endpoint({error:{code:'PGRST202',message:'private diagnostic'}});
 assert.equal(missing.response.status,503);assert.equal(missing.data.errorCode,'BALE_LINK_DATABASE_NOT_READY');
 const failed=await endpoint({error:{code:'OTHER',message:'private diagnostic'}});
 assert.equal(failed.response.status,500);assert.ok(!JSON.stringify(failed.data).includes('private diagnostic'));
});
test('restricted users and disabled channels cannot create any nonce',async()=>{
 for(const options of [{authorized:false},{active:false}]){
  const result=await endpoint(options);assert.equal(result.response.status,403);assert.equal(result.rpcCalls,0);
 }
});

const source=readFileSync('src/components/Profile/BaleConnectSection.tsx','utf8');
const start=source.indexOf('  const handleConnect ='),end=source.indexOf('  const handleDisconnect =',start);
const clickSource=source.slice(start,end).replace('const handleConnect =','globalThis.connect =')
 .replace(/import\.meta\.env\.VITE_SUPABASE_URL/g,"'https://spark.test'").replace(/import\.meta\.env\.VITE_SUPABASE_ANON_KEY/g,"'public-key'");
for(const scenario of ['open','blocked','server-failure','invalid-url'])test(`connect click handles ${scenario} without losing the browser gesture`,async()=>{
 const order:string[]=[];const errors:string[]=[];const links:any[]=[];let polls=0;let closed=false;
 const popup={opener:{},closed:false,location:{replace:(url:string)=>order.push('navigate:'+url)},close(){closed=true;}};
 const sandbox:any={URL,window:{open(){order.push('open');return scenario==='blocked'?null:popup;}},
  setConnecting:(v:boolean)=>order.push('connecting:'+v),setConnectUrl:(url:any)=>links.push(url),startPolling:()=>polls++,
  supabase:{auth:{getSession:async()=>{order.push('session');return {data:{session:{access_token:'session-token'}}};}}},
  fetch:async()=>{order.push('fetch');return {json:async()=>scenario==='server-failure'?{ok:false,error:'سرویس آماده نیست'}
   :{ok:true,url:scenario==='invalid-url'?'https://outside.test/':'https://ble.ir/spark_bot?start=one-time'} };},
  toast:{error:(message:string)=>errors.push(message)}};
 vm.runInNewContext((await transform(clickSource,{loader:'ts'})).code,sandbox);await sandbox.connect();
 assert.ok(order.indexOf('open')<order.indexOf('session'));
 if(scenario==='server-failure'||scenario==='invalid-url'){
  assert.equal(polls,0);assert.equal(closed,true);assert.equal(errors.length,1);assert.ok(order.includes('connecting:false'));
 }else{
  assert.equal(polls,1);assert.equal(links.at(-1),'https://ble.ir/spark_bot?start=one-time');
  if(scenario==='open'){assert.equal(popup.opener,null);assert.ok(order.includes('navigate:https://ble.ir/spark_bot?start=one-time'));}
 }
});
