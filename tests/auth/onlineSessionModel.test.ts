import test from 'node:test';import assert from 'node:assert/strict';
import { groupOnlineSessions, type OnlineSession } from '../../src/components/PortalConfig/onlineSessionModel';
import { createSessionContextRecorder } from '../../src/features/auth/services/sessionEventContext';
test('multiple devices stay distinct under their verified user; IPs are not selected from another session',()=>{
 const rows=[{user_id:'a',session_id:'a1',ip_address:'192.0.2.1'},{user_id:'b',session_id:'b1',ip_address:null},{user_id:'a',session_id:'a2',ip_address:'2001:db8::1'}] as OnlineSession[];
 const grouped=groupOnlineSessions(rows);assert.equal(grouped.length,2);assert.deepEqual(grouped[0].sessions.map(s=>s.ip_address),['192.0.2.1','2001:db8::1']);assert.equal(grouped[1].sessions[0].ip_address,null);
});
test('a false recorder response is retried instead of being cached as a successful observation',async()=>{
 let n=0;const record=createSessionContextRecorder(async()=>({error:null,data:++n>1}));
 const state={access_level:'FULL',user_id:'u',session_id:'s'};await record(state);await record(state);await record(state);assert.equal(n,2);
});
