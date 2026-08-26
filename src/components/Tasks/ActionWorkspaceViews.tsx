import React from 'react';
import { Calendar, CheckCircle2, Clock3, MoreVertical, Plus, User } from 'lucide-react';
import { type ActionTask } from './TaskCard';
import { toJalali } from './utils';

const statusLabel: Record<string,string> = { pending:'در انتظار', in_progress:'در حال انجام', completed:'تکمیل شده' };
const priorityLabel: Record<string,string> = { high:'بالا', medium:'متوسط', low:'پایین' };

export function ActionListView({ tasks, onOpen, onStatus }: { tasks: ActionTask[]; onOpen:(t:ActionTask)=>void; onStatus:(id:string,status:ActionTask['status'])=>void }) {
  return <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-gray-50 dark:bg-gray-800/60 text-gray-500"><tr><th className="text-right px-4 py-3">عنوان اقدام</th><th className="text-right px-4 py-3">وضعیت</th><th className="text-right px-4 py-3">اولویت</th><th className="text-right px-4 py-3">اقدام‌کننده</th><th className="text-right px-4 py-3">سررسید</th><th className="text-right px-4 py-3">پیشرفت</th><th className="w-12"></th></tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-800">
      {tasks.map(t => <tr key={t.id} onDoubleClick={()=>onOpen(t)} className="hover:bg-violet-50/30 dark:hover:bg-violet-950/10 transition-colors">
        <td className="px-4 py-3"><button onClick={()=>onOpen(t)} className="font-medium text-gray-800 dark:text-gray-100 hover:text-violet-600 text-right">{t.title}</button><div className="text-xs text-gray-400 mt-1 line-clamp-1">{t.description}</div></td>
        <td className="px-4 py-3"><select value={t.status} onChange={e=>onStatus(t.id,e.target.value as ActionTask['status'])} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1 text-xs dark:text-gray-200"><option value="pending">در انتظار</option><option value="in_progress">در حال انجام</option><option value="completed">تکمیل شده</option></select></td>
        <td className="px-4 py-3"><span className={`px-2 py-1 rounded-lg text-xs ${t.priority==='high'?'bg-red-50 text-red-600 dark:bg-red-950/30':t.priority==='medium'?'bg-amber-50 text-amber-600 dark:bg-amber-950/30':'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30'}`}>{priorityLabel[t.priority]||t.priority}</span></td>
        <td className="px-4 py-3 text-gray-600 dark:text-gray-300"><span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5"/>{t.assignee||'—'}</span></td>
        <td className="px-4 py-3 text-gray-500"><span className="inline-flex items-center gap-1"><Calendar className="w-3.5 h-3.5"/>{t.due_date?toJalali(t.due_date):'—'}</span></td>
        <td className="px-4 py-3"><div className="flex items-center gap-2"><div className="w-20 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{width:`${t.status==='completed'?100:(t.progress_percent??0)}%`}}/></div><span className="text-xs text-gray-500">{t.status==='completed'?100:(t.progress_percent??0)}%</span></div></td>
        <td className="px-2"><button onClick={()=>onOpen(t)} className="p-2 text-gray-400 hover:text-violet-500"><MoreVertical className="w-4 h-4"/></button></td>
      </tr>)}
    </tbody></table></div>
  </div>;
}

export function ActionKanbanBoard({ tasks, onOpen, onStatus, onCreate }: { tasks:ActionTask[]; onOpen:(t:ActionTask)=>void; onStatus:(id:string,status:ActionTask['status'])=>void; onCreate:()=>void }) {
  const columns:{key:ActionTask['status'];label:string;sub:string;className:string;dot:string}[] = [
    {key:'pending',label:'در انتظار',sub:'آماده شروع',className:'border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/10',dot:'bg-amber-500'},
    {key:'in_progress',label:'در حال انجام',sub:'در جریان کار',className:'border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/10',dot:'bg-blue-500'},
    {key:'completed',label:'تکمیل شده',sub:'خروجی نهایی',className:'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/10',dot:'bg-emerald-500'},
  ];
  return <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
    {columns.map(c=>{ const items=tasks.filter(t=>t.status===c.key && (!t.archived || c.key==='completed')); return <section key={c.key} className={`rounded-3xl border ${c.className} p-3 min-h-[420px] shadow-sm`}>
      <div className="flex items-center justify-between px-2 py-2 mb-2"><div><div className="flex items-center gap-2 font-bold text-gray-800 dark:text-white"><span className={`w-2.5 h-2.5 rounded-full ${c.dot}`}/>{c.label}<span className="text-xs px-2 py-0.5 rounded-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700">{items.length}</span></div><div className="text-[11px] text-gray-400 mt-1">{c.sub}</div></div><button onClick={onCreate} className="p-2 rounded-xl bg-white/70 dark:bg-gray-900/70 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-violet-600"><Plus className="w-4 h-4"/></button></div>
      <div className="space-y-3">{items.map(t=><article key={t.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer" onClick={()=>onOpen(t)}>
        <div className="flex items-start justify-between gap-3"><div className="font-semibold text-gray-800 dark:text-gray-100 leading-6">{t.title}</div><MoreVertical className="w-4 h-4 text-gray-400 flex-shrink-0"/></div>
        {!!t.tags?.length && <div className="flex flex-wrap gap-1 mt-2">{t.tags.slice(0,3).map(x=><span key={x} className="text-[10px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-gray-800 text-gray-500">{x}</span>)}</div>}
        <div className="mt-4 flex items-center justify-between text-xs text-gray-500"><span className="inline-flex items-center gap-1"><Clock3 className="w-3.5 h-3.5"/>{t.due_date?toJalali(t.due_date):'بدون سررسید'}</span><span className={`px-2 py-1 rounded-lg ${t.priority==='high'?'bg-red-50 text-red-600 dark:bg-red-950/30':t.priority==='medium'?'bg-amber-50 text-amber-600 dark:bg-amber-950/30':'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30'}`}>{priorityLabel[t.priority]||t.priority}</span></div>
        <div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-2 min-w-0"><div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 flex items-center justify-center"><User className="w-3.5 h-3.5"/></div><span className="text-xs text-gray-600 dark:text-gray-300 truncate">{t.assignee||'بدون مسئول'}</span></div>{t.status==='completed'?<CheckCircle2 className="w-5 h-5 text-emerald-500"/>:<select value={t.status} onClick={e=>e.stopPropagation()} onChange={e=>onStatus(t.id,e.target.value as ActionTask['status'])} className="text-[11px] rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-2 py-1 dark:text-gray-200"><option value="pending">در انتظار</option><option value="in_progress">در حال انجام</option><option value="completed">تکمیل</option></select>}</div>
        <div className="mt-3 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden"><div className="h-full bg-violet-500" style={{width:`${t.status==='completed'?100:(t.progress_percent??0)}%`}}/></div>
      </article>)}{items.length===0&&<div className="text-center text-xs text-gray-400 py-12">اقدامی در این ستون نیست</div>}</div>
    </section>})}
  </div>;
}
