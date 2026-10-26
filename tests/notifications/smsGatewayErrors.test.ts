import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync(new URL('../../src/features/notifications/gateways/smsNotificationGateway.ts',import.meta.url),'utf8');
const fn=stripTypeScriptTypes(source.slice(source.indexOf('export async function')).replace('export async function','async function'),{mode:'transform'});

test('gateway preserves structured non-2xx Edge Function error',async()=>{
  const httpError={message:'Edge Function returned a non-2xx status code',context:new Response(JSON.stringify({status:'failed',errorCode:'SMS_TEMPLATE_CONTEXT_MISSING',error:'meeting_date'}),{status:422})};
  const dispatch=new Function('supabase',`${fn}; return dispatchSmsNotification;`)({functions:{invoke:async()=>({data:null,error:httpError})}});
  const result=await dispatch({userId:'user',category:'meeting',eventType:'meeting_confirmed',audience:'all',message:'text'});
  assert.equal(result.errorCode,'SMS_TEMPLATE_CONTEXT_MISSING');
  assert.equal(result.error,'meeting_date');
  assert.equal(result.status,'failed');
});
