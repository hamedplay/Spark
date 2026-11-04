import test from 'node:test';
import assert from 'node:assert/strict';
import { describeUserAgent } from '../../src/components/UserGroups/eventClientContext';
import { sessionPresence, elapsed, sessionDate, type SessionInfo } from '../../src/features/auth/components/sessionPresentation';
import { connectionHeaders, recordLoginConnection } from '../../supabase/functions/_shared/sessionConnection';
const ua='Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/153.0.0.0 Safari/537.36';
test('client hints distinguish Windows 11 and true Android version without inventing hidden values',()=>{
 assert.equal(describeUserAgent(ua).os,'ویندوز ۱۰ یا ۱۱');
 assert.equal(describeUserAgent(ua,{platform:'Windows',platformVersion:'15.0.0'}).os,'ویندوز ۱۱');
 assert.equal(describeUserAgent(ua,{platform:'Windows',platformVersion:'10.0.0'}).os,'ویندوز ۱۰');
 const android='Mozilla/5.0 (Linux; Android 10; K) Chrome/153.0.0.0 Mobile Safari/537.36';
 assert.match(describeUserAgent(android).os,/دقیق اعلام نشده/);
 assert.equal(describeUserAgent(android,{platform:'Android',platformVersion:'16.0.0',model:'Pixel 9'}).os,'اندروید 16.0.0');
 assert.match(describeUserAgent(android,{model:'Pixel 9'}).device,/Pixel 9/);
 assert.equal(describeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15',{maxTouchPoints:5}).os,'iPadOS (نسخهٔ دقیق اعلام نشده)');
});
const now=Date.parse('2026-11-04T09:00:00Z');
const session={status:'active',last_observed_at:new Date(now-30000).toISOString(),idle_expiry_at:new Date(now+3600000).toISOString(),absolute_expiry_at:new Date(now+86400000).toISOString()} as SessionInfo;
test('presence is independent of authorization and offline duration does not claim logout',()=>{
 assert.equal(sessionPresence(session,now,360),'online');
 assert.equal(sessionPresence(session,now+400000,360),'offline');
 assert.equal(sessionPresence({...session,last_observed_at:null},now,360),'unknown');
 assert.equal(sessionPresence({...session,status:'revoked'},now,360),'ended');
 assert.equal(sessionPresence(session,now+7200000,360),'ended');
 assert.equal(elapsed(new Date(now-7560000).toISOString(),now),'۲ ساعت و ۶ دقیقه');
 assert.equal(elapsed(null,now),'ثبت نشده');assert.equal(sessionDate(null),'ثبت نشده');
});
test('internal hops forward only canonical ingress fields; never spoofable XFF, cookies or bearer tokens',()=>{
 const spoofed=new Request('https://spark.test',{headers:{'x-forwarded-for':'1.2.3.4','x-real-ip':'5.6.7.8','x-spark-client-ip':'9.9.9.9','authorization':'Bearer SECRET','cookie':'SECRET','user-agent':ua}});
 assert.deepEqual(connectionHeaders(spoofed),{'user-agent':ua});
 const good=new Request(spoofed,{headers:{...Object.fromEntries(spoofed.headers),'x-spark-client-ip-source':'nginx-v2','x-spark-client-ip':'2001:db8::1'}});
 assert.deepEqual(connectionHeaders(good),{'user-agent':ua,'x-spark-client-ip-source':'nginx-v2','x-spark-client-ip':'2001:db8::1'});
});
test('capture errors cannot block a verified login and contain no request credentials',async()=>{
 let args: unknown;
 await recordLoginConnection({rpc:async(_name,data)=>{args=data;return {error:null};}},new Request('https://spark.test',{headers:{authorization:'SECRET'}}),'session','user');
 assert.equal(JSON.stringify(args).includes('SECRET'),false);
 await recordLoginConnection({rpc:async()=>{throw Error('unavailable');}},new Request('https://spark.test'),'session','user');
});
