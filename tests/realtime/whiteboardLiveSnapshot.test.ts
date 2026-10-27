import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
const source=readFileSync(new URL('../../src/components/VideoConference/Whiteboard.tsx',import.meta.url),'utf8');
const body=source.slice(source.indexOf('function boardReducer('),source.indexOf('// ─── Drawing helpers'));
const reduce=new Function(stripTypeScriptTypes(body,{mode:'transform'})+'; return boardReducer;')();
const entry=(id:string,dbRowId?:string)=>({stroke:{id},dbRowId,isOwn:true});
test('live whiteboard snapshot removes deleted rows while retaining unsaved strokes and redo',()=>{
 const local=entry('local');const redo=entry('redo','redo-db');
 const next=reduce({entries:[entry('deleted','old'),local],redoStack:[redo]},{type:'SYNC',rows:[entry('remote','new')]});
 assert.deepEqual(next.entries.map((e:any)=>e.stroke.id),['remote','local']);assert.deepEqual(next.redoStack,[redo]);
});
test('late persistence acknowledgement does not duplicate a stroke already present in the live snapshot',()=>{
 const next=reduce({entries:[entry('stroke','db')],redoStack:[]},{type:'ADD_OWN',stroke:{id:'stroke'},dbRowId:'db'});
 assert.equal(next.entries.length,1);
});
