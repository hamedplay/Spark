import assert from 'node:assert/strict';
import test from 'node:test';
import { processMeetingNotificationJobs } from '../../supabase/functions/meeting-notification-worker/processJobs';
const immediate = { loadPolicy: async()=>({} as any), evaluatePolicy: ()=>({sendNow:true,nextAllowedAt:null}) as any };
const job = {id:'job',lease:'lease',recipient_id:'person',event_type:'series_invite',audience:'participants',context:{summary:'Series summary'},event_key:'unique-event',actor_id:'owner',created_at:'2026-10-27T00:00:00Z'};
function fixture(result: any) {
  const calls: any[]=[];
  return {calls,client:{rpc:async(name:string,args:any)=>{calls.push({name,args});return{error:null};},functions:{invoke:async(name:string,args:any)=>{calls.push({name,args});if(result instanceof Error) throw result;return result;}}}};
}
test('series job uses stable dispatch identity and fenced completion',async()=>{
 const f=fixture({data:{status:'sent'},error:null});
 await processMeetingNotificationJobs(f.client,[job],immediate);
 assert.equal(f.calls[0].args.body.eventKey,'unique-event');
 assert.equal(f.calls[0].args.body.context.sms_policy_deferred_delivery,true);
 assert.deepEqual(f.calls[1].args,{p_id:'job',p_lease:'lease',p_status:'sent',p_error:null});
});
test('unknown network outcome is terminal uncertain, never blindly requeued',async()=>{
 const f=fixture(new Error('timeout'));
 await processMeetingNotificationJobs(f.client,[job],immediate);
 assert.equal(f.calls[1].args.p_status,'uncertain');
 assert.equal(f.calls.filter(c=>c.name==='send-sms').length,1);
});
test('SMS delivery window postpones the unsent job without invoking provider',async()=>{
 const f=fixture({});
 const next=new Date('2026-10-28T05:30:00Z');
 await processMeetingNotificationJobs(f.client,[job],{...immediate,evaluatePolicy:()=>({sendNow:false,nextAllowedAt:next}) as any});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'postpone_meeting_notification_job');assert.equal(f.calls[0].args.p_available_at,next.toISOString());
});
test('external recipient is dispatched individually with the same event deduplication key',async()=>{
 const f=fixture({data:{sent:1},error:null});
 await processMeetingNotificationJobs(f.client,[{...job,recipient_id:null,target_phone:'09000000000',audience:'external'}],immediate);
 assert.equal(f.calls[0].args.body.mode,'external');assert.deepEqual(f.calls[0].args.body.mobiles,['09000000000']);assert.equal(f.calls[1].args.p_status,'sent');
});
test('disabled provider rule is skipped; recording failures are visible',async()=>{
 const f=fixture({data:{status:'skipped',reason:'NO_RULE'},error:null});
 await processMeetingNotificationJobs(f.client,[job],immediate);
 assert.equal(f.calls[1].args.p_status,'skipped');
});
