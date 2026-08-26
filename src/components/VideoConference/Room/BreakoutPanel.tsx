import { useCallback, useEffect, useMemo, useState } from 'react';
import { DoorOpen, Loader2, RefreshCw, UsersRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { ConferenceParticipant } from '../types';
import { useConferenceClient } from '../conferenceClient';

type BreakoutRoom = { id:string; name:string; status:string; created_at:string };
type Assignment = { user_id:string; breakout_room_id:string };

export function BreakoutPanel({ roomId, currentUserId, participants, canManage, currentBreakoutId, onClose }:{
  roomId:string; currentUserId:string; participants:ConferenceParticipant[]; canManage:boolean; currentBreakoutId:string|null; onClose:()=>void;
}){
  const supabase=useConferenceClient();
  const [rooms,setRooms]=useState<BreakoutRoom[]>([]); const [assignments,setAssignments]=useState<Assignment[]>([]);
  const [loading,setLoading]=useState(true); const [creating,setCreating]=useState(false); const [groupCount,setGroupCount]=useState(2);

  const load=useCallback(async()=>{setLoading(true);try{
    const [{data:r,error:re},{data:a,error:ae}]=await Promise.all([
      supabase.from('conference_breakout_rooms').select('id,name,status,created_at').eq('main_room_id',roomId).eq('status','active').order('created_at'),
      supabase.from('conference_breakout_assignments').select('user_id,breakout_room_id').eq('main_room_id',roomId),
    ]); if(re)throw re;if(ae)throw ae;setRooms((r||[]) as BreakoutRoom[]);setAssignments((a||[]) as Assignment[]);
  }catch(e){console.error(e);toast.error('خطا در دریافت اتاق‌های گروهی');}finally{setLoading(false);}},[roomId,supabase]);
  useEffect(()=>{void load();const ch=supabase.channel(`breakout-ui-${roomId}`)
    .on('postgres_changes',{event:'*',schema:'public',table:'conference_breakout_rooms',filter:`main_room_id=eq.${roomId}`},()=>void load())
    .on('postgres_changes',{event:'*',schema:'public',table:'conference_breakout_assignments',filter:`main_room_id=eq.${roomId}`},()=>void load()).subscribe();
    return()=>{supabase.removeChannel(ch);};},[load,roomId,supabase]);
  const assignmentMap=useMemo(()=>new Map(assignments.map(a=>[a.user_id,a.breakout_room_id])),[assignments]);
  const currentName=rooms.find(r=>r.id===currentBreakoutId)?.name;

  const createGroups=async()=>{setCreating(true);try{const names=Array.from({length:groupCount},(_,i)=>`گروه ${i+1}`);const{data,error}=await supabase.rpc('create_conference_breakouts',{p_main_room_id:roomId,p_names:names});if(error)throw error;if(!data?.ok)throw new Error(data?.reason||'CREATE_FAILED');await load();toast.success(`${groupCount} اتاق گروهی ایجاد شد`);}catch(e:any){toast.error('خطا در ایجاد گروه‌ها: '+(e?.message||''));}finally{setCreating(false);}};
  const assign=async(userId:string,breakoutId:string)=>{try{if(!breakoutId){const{data,error}=await supabase.rpc('clear_conference_breakout_assignment',{p_main_room_id:roomId,p_user_id:userId});if(error||data!==true)throw error||new Error('CLEAR_FAILED');}else{const{data,error}=await supabase.rpc('assign_conference_breakout',{p_main_room_id:roomId,p_breakout_room_id:breakoutId,p_user_id:userId});if(error||data!==true)throw error||new Error('ASSIGN_FAILED');}await load();}catch(e:any){toast.error('تغییر گروه ناموفق بود: '+(e?.message||''));}};
  const endAll=async()=>{if(!confirm('همه اتاق‌های گروهی بسته شوند و افراد به جلسه اصلی برگردند؟'))return;try{const{data,error}=await supabase.rpc('end_conference_breakouts',{p_main_room_id:roomId});if(error||data!==true)throw error||new Error('END_FAILED');await load();toast.success('همه افراد به جلسه اصلی برگشتند');}catch(e:any){toast.error('خطا در پایان Breakout: '+(e?.message||''));}};

  return <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 p-4" dir="rtl"><div className="w-full max-w-2xl max-h-[88vh] overflow-y-auto rounded-2xl border border-gray-700 bg-gray-900 text-white shadow-2xl">
    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-900 px-4 py-3"><div><h3 className="flex items-center gap-2 font-bold"><UsersRound className="h-4 w-4 text-teal-400"/> اتاق‌های گروهی</h3><p className="mt-1 text-xs text-gray-400">صدا و تصویر هر گروه از سایر گروه‌ها جداست؛ چت، Poll و Whiteboard فضای مشترک جلسه باقی می‌مانند.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-800"><X className="h-4 w-4"/></button></div>
    <div className="space-y-4 p-4">
      {currentBreakoutId?<div className="rounded-xl border border-teal-700/50 bg-teal-950/30 p-3 text-sm">شما اکنون در <b>{currentName||'اتاق گروهی'}</b> هستید.</div>:<div className="rounded-xl border border-gray-700 bg-gray-800/60 p-3 text-sm text-gray-300">شما در جلسه اصلی هستید.</div>}
      {canManage&&<div className="flex flex-wrap gap-2 rounded-xl border border-gray-700 p-3"><select value={groupCount} onChange={e=>setGroupCount(Number(e.target.value))} className="rounded-lg bg-gray-800 px-3 py-2 text-sm">{[2,3,4,5,6].map(n=><option key={n} value={n}>{n} گروه</option>)}</select><button onClick={createGroups} disabled={creating} className="flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-bold disabled:opacity-50">{creating?<Loader2 className="h-4 w-4 animate-spin"/>:<DoorOpen className="h-4 w-4"/>} ایجاد/بازسازی گروه‌ها</button>{rooms.length>0&&<button onClick={endAll} className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold">پایان همه گروه‌ها</button>}<button onClick={()=>void load()} className="rounded-lg bg-gray-800 p-2"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/></button></div>}
      {rooms.length===0?<p className="py-8 text-center text-sm text-gray-500">اتاق گروهی فعالی وجود ندارد.</p>:<div className="grid gap-3 md:grid-cols-2">{rooms.map(r=><section key={r.id} className={`rounded-xl border p-3 ${currentBreakoutId===r.id?'border-teal-600 bg-teal-950/20':'border-gray-700'}`}><h4 className="font-bold">{r.name}</h4><p className="mt-1 text-xs text-gray-500">{assignments.filter(a=>a.breakout_room_id===r.id).length} نفر</p></section>)}</div>}
      {canManage&&rooms.length>0&&<div><h4 className="mb-2 text-sm font-bold">تخصیص افراد</h4><div className="space-y-2">{participants.filter(p=>p.status==='joined').map(p=><div key={p.user_id} className="flex items-center gap-3 rounded-xl bg-gray-800/70 p-2.5"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{p.display_name}</p><p className="text-[10px] text-gray-500">{p.user_id===currentUserId?'شما · ':''}{p.role}</p></div><select value={assignmentMap.get(p.user_id)||''} onChange={e=>void assign(p.user_id,e.target.value)} className="max-w-[180px] rounded-lg border border-gray-700 bg-gray-900 px-2 py-2 text-xs"><option value="">جلسه اصلی</option>{rooms.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></div>)}</div></div>}
    </div></div></div>;
}
