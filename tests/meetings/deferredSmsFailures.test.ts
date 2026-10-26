import assert from 'node:assert/strict';
import test from 'node:test';
import { deferredSmsFailure } from '../../supabase/functions/_shared/deferredSmsFailure';
import { handleDispatchMode, handleExternalMode } from '../../supabase/functions/send-sms/requestModes';

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status});
function fixture(requestDate: string | null, jalaliDate: string | null = null) {
  const queued: any[] = [];
  const db = { from(table: string) {
    const query: any = {
      select() {return query;},eq() {return query;},
      maybeSingle() {
        if(table==='sms_delivery_policies') return Promise.resolve({data:{delivery_mode:'window',window_start:new Date(Date.now()+3600000).toISOString().slice(11,16),window_end:new Date(Date.now()+3660000).toISOString().slice(11,16),timezone:'UTC'}});
        if(table==='profiles') return Promise.resolve({data:{full_name:'همکار'}});
        if(table==='meetings') return Promise.resolve({data:{subject:'تست',request_date:requestDate,request_jalaali_date:jalaliDate,start_time:'16:00',end_time:'18:00'}});
        if(table==='sms_templates') return Promise.resolve({data:{id:'template',body:'جلسه {{meeting_subject}} در {{meeting_date}}'}});
        throw new Error(table);
      },
      insert(value: any) {if(table==='sms_dispatch_logs') return query;assert.equal(table,'deferred_sms_queue');queued.push(value);return Promise.resolve({error:null});},
      single() {return Promise.resolve({data:{id:'log'}});},update() {return query;},
    };
    return query;
  }};
  const body = {targetUserId:'recipient',category:'meeting',eventType:'meeting_confirmed',meetingId:'meeting',mobiles:['09123456789'],context:{meeting_date:''}};
  return {db,body,queued};
}
for (const [name, handler] of [['internal',handleDispatchMode],['external',handleExternalMode]] as const) {
  test(`${name}: stored Jalali date prevents a false missing-date error`,async()=>{
    const f=fixture(null,'۱۴۰۵/۰۷/۰۵');
    const response=await handler({supabase:f.db,body:f.body,caller:{userId:'actor',isAdmin:true},json});
    assert.equal(response.status,200);
    assert.equal(f.queued[0].context.meeting_date,'1405/07/05');
  });
  test(`${name}: legacy caller text cannot bypass an incomplete meeting template`,async()=>{
    const f=fixture(null);
    const response=await handler({supabase:f.db,body:{...f.body,message:'متن ناقص بدون تاریخ',context:{sms_policy_deferred_delivery:true}},caller:{userId:'actor',isAdmin:true},json});
    assert.equal(response.status,422);
    assert.equal((await response.json()).errorCode,'SMS_TEMPLATE_CONTEXT_MISSING');
  });

  test(`${name}: missing date cannot enter deferred queue`,async()=>{
    const f=fixture(null);
    const response=await handler({supabase:f.db,body:f.body,caller:{userId:'actor',isAdmin:true},json});
    assert.equal(response.status,422);
    assert.equal((await response.json()).errorCode,'SMS_TEMPLATE_CONTEXT_MISSING');
    assert.equal(f.queued.length,0);
  });
  test(`${name}: resolved original date is snapshotted for later delivery`,async()=>{
    const f=fixture('2026-10-26');
    const response=await handler({supabase:f.db,body:f.body,caller:{userId:'actor',isAdmin:true},json});
    assert.equal(response.status,200);
    assert.equal(f.queued.length,1);
    assert.equal(f.queued[0].context.meeting_date,'1405/08/04');
  });
}
test('reads permanent error code from non-2xx response without consuming original body',async()=>{
  const context=json({errorCode:'SMS_TEMPLATE_CONTEXT_MISSING',error:'meeting_date'},422);
  assert.equal(await deferredSmsFailure(null,{message:'Edge Function returned a non-2xx status code',context}),'SMS_TEMPLATE_CONTEXT_MISSING: meeting_date');
  assert.equal((await context.json()).errorCode,'SMS_TEMPLATE_CONTEXT_MISSING');
});
test('network errors remain retryable diagnostics',async()=>{
  assert.equal(await deferredSmsFailure(null,{message:'network timeout'}),'network timeout');
});
test('invalid HTTP response body preserves transport failure',async()=>{
  assert.equal(await deferredSmsFailure(null,{message:'proxy failure',context:new Response('bad gateway',{status:502})}),'proxy failure');
});
