import assert from 'node:assert/strict';
import test from 'node:test';
import { liveReaderHarness } from './liveReaderHarness';

test('calendar starts one loader per resource and changing month reloads meetings only',async()=>{
  Object.defineProperty(globalThis,'window',{value:new EventTarget(),configurable:true});
  Object.defineProperty(globalThis,'document',{value:new EventTarget(),configurable:true});
  const calls:string[]=[];
  const client={from(table:string){calls.push(table);const q:any={then:(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve)};for(const method of ['select','eq','neq','gte','lte','order'])q[method]=()=>q;return q;},rpc:async(name:string)=>{calls.push(name);return {data:[],error:null};}};
  const h=await liveReaderHarness(['/useCalendarDataActions.ts','/useLiveData.ts'],client);
  try{
    const {useCalendarDataActions}=await h.load('/src/components/Calendar/useCalendarDataActions.ts');
    const noop=()=>{};
    const scope:any={currentJy:1405,currentJm:8,currentUserId:'owner',providedUserId:'owner',allDayEvents:[],calendars:[],subscriptions:[],usersById:{},setIsRefreshing:noop,setMeetings:noop,setCalendars:noop,setSubscribedCalendars:noop,setOccasionsEnabled:noop,setEnabledCalendarIds:noop,setAllDayEvents:noop};
    h.render(()=>useCalendarDataActions(scope));
    assert.equal(calls.length,0,'mount effects do not duplicate shared initial requests');
    assert.equal(h.watches.length,3);
    await Promise.all(h.watches.map((w:any)=>w.refresh()));
    assert.equal(calls.filter(x=>x==='meetings').length,1);
    assert.equal(calls.filter(x=>x==='all_day_events').length,1);
    assert.equal(calls.filter(x=>x==='calendars').length,1);
    h.render(()=>useCalendarDataActions({...scope,currentJm:9}));
    assert.equal(h.watches.length,4,'only month-dependent meeting reader is replaced');
    assert.equal(h.watches[0].disposed,true);
    await h.watches[3].refresh();
    assert.equal(calls.filter(x=>x==='meetings').length,2);
    assert.equal(calls.filter(x=>x==='calendars').length,1);
  }finally{await h.close();}
});
