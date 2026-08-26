import { useCallback, useEffect, useState } from 'react';
import { Archive, ChevronDown, ChevronUp, Clock, MessageSquare, BarChart3, PenLine, Users, Loader as Loader2, RefreshCw, WifiOff, UserX, CalendarDays } from 'lucide-react';
import moment from 'moment-jalaali';
import { supabase } from '../../../lib/supabase';

interface AttendanceSummaryItem {
  user_id: string; display_name: string; role: string; first_join: string | null; last_leave: string | null;
  join_count: number; disconnect_count?: number; presence_seconds?: number; absent?: boolean;
}
interface MessageSnapshot { id:string; display_name?:string; body?:string; created_at?:string; is_deleted?:boolean; }
interface PollVote { user_id:string; option_index:number; }
interface PollSnapshot { id:string; question:string; options:string[]; votes?:PollVote[]; created_at?:string; ended_at?:string|null; }
interface ConferenceArchive {
  id:string; room_id:string; room_name:string; host_id:string; meeting_id:string|null; started_at:string|null; ended_at:string;
  ended_reason:string|null; participant_count:number; message_count:number; poll_count:number; whiteboard_stroke_count:number;
  disconnect_count?:number; absent_count?:number; attendance_summary:AttendanceSummaryItem[];
  messages_snapshot?:MessageSnapshot[]; polls_snapshot?:PollSnapshot[]; whiteboard_snapshot?:unknown[]; output_package?:Record<string,unknown>;
}

function formatDateTime(value:string|null|undefined){ return value ? moment(value).format('jYYYY/jMM/jDD HH:mm') : '—'; }
function durationLabel(seconds?:number|null){
  const s=Math.max(0,Number(seconds||0)); if(!s)return '۰ دقیقه'; const minutes=Math.round(s/60);
  if(minutes<60)return `${minutes} دقیقه`; const h=Math.floor(minutes/60),m=minutes%60; return m?`${h} ساعت و ${m} دقیقه`:`${h} ساعت`;
}

export function ConferenceArchiveList(){
  const [items,setItems]=useState<ConferenceArchive[]>([]); const [loading,setLoading]=useState(true); const [expanded,setExpanded]=useState<string|null>(null);
  const load=useCallback(async()=>{ setLoading(true); try{
    const {data,error}=await supabase.from('conference_archives')
      .select('id,room_id,room_name,host_id,meeting_id,started_at,ended_at,ended_reason,participant_count,message_count,poll_count,whiteboard_stroke_count,disconnect_count,absent_count,attendance_summary,messages_snapshot,polls_snapshot,whiteboard_snapshot,output_package')
      .order('ended_at',{ascending:false}).limit(30);
    if(error)throw error; setItems((data||[]) as ConferenceArchive[]);
  }catch(error){console.error('conference archive load error:',error);setItems([]);}finally{setLoading(false);}},[]);
  useEffect(()=>{void load();},[load]);

  return <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 sm:p-5" dir="rtl">
    <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-extrabold text-slate-900 dark:text-white"><Archive className="h-4 w-4 text-violet-500"/> بسته خروجی جلسات آنلاین</h3><p className="mt-1 text-[11px] text-slate-400">گزارش حضور، قطعی، غیبت، چت، نظرسنجی و وایت‌بورد پس از پایان جلسه.</p></div><button onClick={()=>void load()} disabled={loading} aria-label="بروزرسانی" className="rounded-xl border border-slate-200 p-2 text-slate-500 dark:border-slate-700"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/></button></div>
    {loading?<div className="flex min-h-24 items-center justify-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin"/></div>:items.length===0?<div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-xs text-slate-400 dark:border-slate-800">هنوز بسته خروجی جلسه‌ای وجود ندارد.</div>:<div className="space-y-2">{items.map(item=>{
      const attendance=Array.isArray(item.attendance_summary)?item.attendance_summary:[];
      const messages=Array.isArray(item.messages_snapshot)?item.messages_snapshot:[];
      const polls=Array.isArray(item.polls_snapshot)?item.polls_snapshot:[];
      const whiteboard=Array.isArray(item.whiteboard_snapshot)?item.whiteboard_snapshot:[];
      const isOpen=expanded===item.id;
      return <article key={item.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
        <button onClick={()=>setExpanded(v=>v===item.id?null:item.id)} className="flex w-full items-center gap-3 bg-slate-50/70 px-3 py-3 text-right dark:bg-slate-900/60">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{item.room_name||'جلسه ویدیویی'}</p><p className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-slate-400"><span className="flex items-center gap-1"><Clock className="h-3 w-3"/> پایان: {formatDateTime(item.ended_at)}</span>{item.meeting_id&&<span className="flex items-center gap-1 text-violet-500"><CalendarDays className="h-3 w-3"/> متصل به جلسه Spark</span>}</p></div>
          <div className="hidden items-center gap-3 text-[10px] text-slate-500 md:flex"><span className="flex items-center gap-1"><Users className="h-3 w-3"/>{item.participant_count}</span><span className="flex items-center gap-1"><WifiOff className="h-3 w-3"/>{item.disconnect_count||0}</span><span className="flex items-center gap-1"><UserX className="h-3 w-3"/>{item.absent_count||0}</span><span className="flex items-center gap-1"><MessageSquare className="h-3 w-3"/>{item.message_count}</span></div>{isOpen?<ChevronUp className="h-4 w-4 text-slate-400"/>:<ChevronDown className="h-4 w-4 text-slate-400"/>}
        </button>
        {isOpen&&<div className="space-y-4 border-t border-slate-200 p-3 dark:border-slate-800">
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-6">{[
            ['شرکت‌کننده',item.participant_count],['قطعی',item.disconnect_count||0],['غایب',item.absent_count||0],['پیام',item.message_count],['نظرسنجی',item.poll_count],['وایت‌بورد',item.whiteboard_stroke_count]
          ].map(([label,value])=><div key={String(label)} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-900"><p className="text-lg font-extrabold">{value}</p><p className="text-[10px] text-slate-400">{label}</p></div>)}</div>

          <div><p className="mb-2 text-xs font-bold text-slate-700 dark:text-slate-200">گزارش حضور</p>{attendance.length===0?<p className="text-xs text-slate-400">برای این آرشیو قدیمی اطلاعات حضور تفصیلی ثبت نشده است.</p>:<div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800"><table className="w-full min-w-[780px] text-xs"><thead className="bg-slate-50 text-slate-500 dark:bg-slate-900"><tr><th className="px-3 py-2 text-right">نام</th><th>اولین ورود</th><th>آخرین خروج</th><th>مدت حضور واقعی</th><th>ورود</th><th>قطعی</th><th>وضعیت</th></tr></thead><tbody>{attendance.map(a=><tr key={a.user_id} className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-2 font-medium">{a.display_name||'—'}</td><td className="px-2 py-2 text-center text-slate-500">{formatDateTime(a.first_join)}</td><td className="px-2 py-2 text-center text-slate-500">{formatDateTime(a.last_leave)}</td><td className="px-2 py-2 text-center">{durationLabel(a.presence_seconds)}</td><td className="px-2 py-2 text-center">{a.join_count||0}</td><td className="px-2 py-2 text-center">{a.disconnect_count||0}</td><td className={`px-2 py-2 text-center font-bold ${a.absent?'text-red-500':'text-emerald-600'}`}>{a.absent?'غایب':'حاضر'}</td></tr>)}</tbody></table></div>}</div>

          <div className="grid gap-3 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold"><MessageSquare className="h-3.5 w-3.5 text-blue-500"/> آرشیو چت ({messages.length})</h4><div className="max-h-48 space-y-1.5 overflow-y-auto">{messages.length===0?<p className="text-xs text-slate-400">پیامی ثبت نشده است.</p>:messages.slice(0,100).map(m=><div key={m.id} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900"><div className="flex justify-between gap-2"><b>{m.display_name||'کاربر'}</b><span className="text-[10px] text-slate-400">{formatDateTime(m.created_at)}</span></div><p className="mt-1 whitespace-pre-wrap text-slate-600 dark:text-slate-300">{m.is_deleted?'[پیام حذف شده]':m.body||'—'}</p></div>)}</div></section>
            <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold"><BarChart3 className="h-3.5 w-3.5 text-violet-500"/> آرشیو نظرسنجی ({polls.length})</h4><div className="max-h-48 space-y-2 overflow-y-auto">{polls.length===0?<p className="text-xs text-slate-400">نظرسنجی ثبت نشده است.</p>:polls.map(p=><div key={p.id} className="rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-900"><b>{p.question}</b><div className="mt-1 space-y-1">{(p.options||[]).map((option,index)=><div key={index} className="flex justify-between"><span>{option}</span><span className="text-slate-400">{(p.votes||[]).filter(v=>v.option_index===index).length} رأی</span></div>)}</div></div>)}</div></section>
          </div>
          <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><h4 className="flex items-center gap-1.5 text-xs font-bold"><PenLine className="h-3.5 w-3.5 text-amber-500"/> وایت‌بورد</h4><p className="mt-1 text-xs text-slate-500">{whiteboard.length} رویداد ترسیم به‌صورت immutable در بسته خروجی این جلسه ذخیره شده است.</p></section>
        </div>}
      </article>;
    })}</div>}
  </section>;
}
