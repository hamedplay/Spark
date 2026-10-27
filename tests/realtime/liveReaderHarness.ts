import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

export async function liveReaderHarness(targets: string[], client: any = {}) {
  const cells: any[]=[];let cursor=0;let effects: (()=>void)[]=[];
  const watches: any[]=[];
  const same=(a:any[],b:any[])=>a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]));
  const harness: any={client,watches,
    useRef(initial:any){const i=cursor++;return cells[i]??=( {current:initial} );},
    useState(initial:any){const i=cursor++;if(!cells[i]){const cell={value:typeof initial==='function'?initial():initial,set:(v:any)=>{cell.value=typeof v==='function'?v(cell.value):v;}};cells[i]=cell;}return[cells[i].value,cells[i].set];},
    useEffect(run:Function,deps:any[]){const i=cursor++;const previous=cells[i];if(!previous || !same(previous.deps,deps)){effects.push(()=>{previous?.cleanup?.();cells[i]={deps,cleanup:run()};});}},
    useMemo(run:Function,deps:any[]){const i=cursor++;if(!cells[i]||!same(cells[i].deps,deps))cells[i]={deps,value:run()};return cells[i].value;},
    useCallback(fn:Function,deps:any[]){return harness.useMemo(()=>fn,deps);},
    watch(tables:any,refresh:any,client:any){const entry={tables,refresh,client,disposed:false};watches.push(entry);return()=>{entry.disposed=true;};},
    render(run:Function){cursor=0;const result=run();const pending=effects;effects=[];pending.forEach(fn=>fn());return result;},
    cleanup(){cells.forEach(c=>c?.cleanup?.());},
  };
  (globalThis as any).__liveReaderHarness=harness;
  const server=await createServer({configFile:false,server:{middlewareMode:true},appType:'custom',ssr:{noExternal:['react-hot-toast']},plugins:[react(),{
    name:'live-reader-harness',enforce:'pre',
    transform(code,id){if(targets.some(target=>id.endsWith(target)))return code.replace(/from ['"]react['"]/g,"from 'virtual:reader-hooks'");},
    resolveId(source){
      if(source==='virtual:reader-hooks')return '\0reader-hooks';
      if(source.endsWith('/liveDataBus')||source==='./liveDataBus')return '\0reader-bus';
      if(source.endsWith('/lib/supabase'))return '\0reader-client';
      if(source==='react-hot-toast')return '\0reader-toast';
      if(source==='./ChatConversationItem')return '\0reader-avatar';
    },
    load(id){
      if(id==='\0reader-hooks')return 'export const {useRef,useState,useEffect,useMemo,useCallback}=globalThis.__liveReaderHarness;';
      if(id==='\0reader-bus')return 'export const watchLiveData=(...args)=>globalThis.__liveReaderHarness.watch(...args);';
      if(id==='\0reader-client')return 'export const supabase=globalThis.__liveReaderHarness.client;';
      if(id==='\0reader-toast')return 'export default {success(){},error(){}};';
      if(id==='\0reader-avatar')return 'export const UserAvatar=()=>null;';
    },
  }]});
  return {...harness,load:(path:string)=>server.ssrLoadModule(path),async close(){harness.cleanup();await server.close();delete (globalThis as any).__liveReaderHarness;}};
}
