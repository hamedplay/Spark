import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {connectionHeaders} from '../../supabase/functions/_shared/sessionConnection';
async function invoke(accessLevel: string, body: unknown) {
 const calls: {name:string;args:unknown}[]=[];
 let handler!: (req: Request)=>Promise<Response>;
 let forwarded: Record<string,string>={};let clients=0;
 const admin={auth:{getUser:async()=>({data:{user:{id:'verified-user'}},error:null})},
  from:(name:string)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:name==='profiles'?{auth_epoch:1}:{session_management_enabled:true,session_idle_timeout_minutes:480,session_heartbeat_interval_seconds:300},error:null})})})}),
  rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:{ok:true},error:null};}};
 const user={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return name==='get_my_auth_access_state_v3'?{data:{access_level:accessLevel},error:null}:{data:true,error:null};}};
 const source=readFileSync('supabase/functions/session-management/index.ts','utf8').replace(/^import .*;\n/gm,'');
 const context={Request,Response,JSON,atob,console,connectionHeaders,
  createClient:(_url:string,_key:string,options:{global?:{headers:Record<string,string>}})=>{clients++;if(clients===1)return admin;forwarded=options.global!.headers;return user;},
  Deno:{env:{get:()=> 'test-env'},serve:(fn:typeof handler)=>{handler=fn;}}};
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 const token=`e30.${btoa(JSON.stringify({sub:'claimed-user',session_id:'session-1'}))}.signature`;
 const response=await handler(new Request('https://spark.test/functions/v1/session-management',{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-forwarded-for':'SPOOFED','x-spark-client-ip':'2001:db8::8','x-spark-client-ip-source':'nginx-v2','user-agent':'Android browser'},body:JSON.stringify(body)}));
 return {response,calls,forwarded};
}
test('heartbeat forwards canonical IP across the internal hop and uses verified actor plus user-bound evidence RPC',async()=>{
 const {response,calls,forwarded}=await invoke('FULL',{mode:'heartbeat',client_hints:{platform:'Android',platformVersion:'16.0.0'}});
 assert.equal(response.status,200);
 assert.equal(forwarded['x-spark-client-ip'],'2001:db8::8');assert.equal(forwarded['x-forwarded-for'],undefined);
 const touch=calls.find(c=>c.name==='touch_session_security_state')!;assert.equal((touch.args as Record<string,unknown>).p_user_id,'verified-user');
 const evidence=calls.find(c=>c.name==='record_my_session_connection_v1')!;assert.deepEqual(JSON.parse(JSON.stringify(evidence.args)),{p_client_hints:{platform:'Android',platformVersion:'16.0.0'}});
});
test('limited access cannot record presence or extend session lifetimes',async()=>{
 const {response,calls}=await invoke('MFA_REQUIRED',{mode:'heartbeat',client_hints:{platform:'Windows'}});
 assert.equal(response.status,403);assert.equal(calls.length,1);assert.equal(calls[0].name,'get_my_auth_access_state_v3');
});
