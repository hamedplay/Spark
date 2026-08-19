import React, { useMemo, useState } from 'react';
import { Bell, CalendarDays, CheckSquare, FileUp, FolderKanban, Link2, ListChecks, Plus, Trash2, X } from 'lucide-react';
import { Task } from '../../types';
import { type OrgUserProfile } from '../../lib/useOrgUsers';
import { type UserProfile } from './types';
import { JalaliDateInput } from './JalaliDateInput';
import { UserSelector } from './UserSelector';
import { type ActionTask } from './TaskCard';
import { type PersonalTaskProject } from './PersonalTaskProjects';

export interface ManagementProjectOption { id: string; name: string; code?: string | null; }

export interface ActionCreatePayload {
  title: string;
  description: string;
  priority: Task['priority'];
  status: Task['status'];
  assigneeId: string;
  assigneeName: string;
  estimatedHours: string;
  tagsText: string;
  startDate: Date | null;
  dueDate: Date | null;
  projectId: string;
  personalProjectId: string;
  reminderAt: Date | null;
  parentTaskId: string;
  dependencyIds: string[];
  checklist: string[];
  files: File[];
}

export function ActionCreateDrawer({
  users, groups, tasks, managementProjects, personalProjects, sourceFromChat, initialDescription = '', busy, onClose, onCreate, onManagePersonalProjects,
}: {
  users: UserProfile[];
  groups: { label: string; users: OrgUserProfile[] }[];
  tasks: ActionTask[];
  managementProjects: ManagementProjectOption[];
  personalProjects: PersonalTaskProject[];
  sourceFromChat?: boolean;
  initialDescription?: string;
  busy?: boolean;
  onClose: () => void;
  onCreate: (payload: ActionCreatePayload) => void;
  onManagePersonalProjects: () => void;
}) {
  const [form, setForm] = useState({ title: '', description: initialDescription, priority: 'medium' as Task['priority'], status: 'pending' as Task['status'], assigneeId: '', assigneeName: '', estimatedHours: '', tagsText: '', projectId: '', personalProjectId: '', parentTaskId: '' });
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [dueDate, setDueDate] = useState<Date | null>(sourceFromChat ? new Date() : null);
  const [reminderAt, setReminderAt] = useState<Date | null>(null);
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [checkText, setCheckText] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const availableDependencies = useMemo(() => tasks.filter(t => t.id !== form.parentTaskId && !t.archived), [tasks, form.parentTaskId]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({ ...form, startDate, dueDate, reminderAt, dependencyIds, checklist, files });
  };
  const addChecklist = () => { if (checkText.trim()) { setChecklist(v => [...v, checkText.trim()]); setCheckText(''); } };
  const toggleDependency = (id: string) => setDependencyIds(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]);

  return <div className="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-sm flex justify-end" dir="rtl" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <form onSubmit={submit} className="h-full w-full xl:w-[1180px] bg-white dark:bg-gray-950 shadow-2xl overflow-y-auto border-r border-gray-200 dark:border-gray-800">
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-5 md:px-7 py-4 flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-gray-900 dark:text-white">ایجاد اقدام جدید</h2><p className="text-xs text-gray-500 mt-1">همه قابلیت‌های قبلی حفظ شده و امکانات پروژه، وابستگی، یادآور، چک‌لیست و فایل نیز اضافه شده‌اند.</p></div>
        <div className="flex items-center gap-2"><button type="button" onClick={onClose} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-5 h-5" /></button><button disabled={busy} type="submit" className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium disabled:opacity-50 flex items-center gap-2"><Plus className="w-4 h-4" /> ایجاد اقدام</button></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(330px,0.9fr)] min-h-[calc(100vh-78px)]">
        <div className="p-5 md:p-7 space-y-6 lg:border-l border-gray-200 dark:border-gray-800">
          {sourceFromChat && <div className="rounded-2xl bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 p-3 text-sm text-teal-700 dark:text-teal-300">این اقدام از چت/کانال ایجاد می‌شود و ارتباط مبدا حفظ خواهد شد.</div>}
          <div><label className="field-label">عنوان اقدام *</label><input required value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} placeholder="عنوان اقدام را وارد کنید..." className="action-input text-base" /></div>
          <div><label className="field-label">توضیحات *</label><textarea required rows={8} value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} placeholder="شرح کامل اقدام، خروجی مورد انتظار و نکات اجرایی..." className="action-input resize-none leading-7" /></div>

          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold dark:text-white flex items-center gap-2"><CheckSquare className="w-4 h-4 text-violet-500" /> چک‌لیست</h3><span className="text-xs text-gray-400">{checklist.length} آیتم</span></div>
            <div className="flex gap-2"><input value={checkText} onChange={e=>setCheckText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addChecklist();}}} placeholder="آیتم جدید..." className="action-input"/><button type="button" onClick={addChecklist} className="px-3 rounded-xl border border-violet-300 text-violet-600"><Plus className="w-4 h-4" /></button></div>
            <div className="mt-3 space-y-2">{checklist.map((x,i)=><div key={`${x}-${i}`} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2 text-sm"><ListChecks className="w-4 h-4 text-gray-400"/><span className="flex-1 dark:text-gray-200">{x}</span><button type="button" onClick={()=>setChecklist(v=>v.filter((_,idx)=>idx!==i))} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4"/></button></div>)}</div>
          </section>

          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="font-semibold dark:text-white flex items-center gap-2 mb-3"><FileUp className="w-4 h-4 text-violet-500" /> فایل‌ها</h3>
            <label className="block border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-7 text-center cursor-pointer hover:border-violet-400 transition-colors"><FileUp className="w-7 h-7 mx-auto text-gray-400 mb-2"/><div className="text-sm text-gray-600 dark:text-gray-300">فایل‌ها را انتخاب کنید</div><div className="text-xs text-gray-400 mt-1">پس از ایجاد اقدام بارگذاری می‌شوند.</div><input type="file" multiple className="hidden" onChange={e=>setFiles(Array.from(e.target.files || []))}/></label>
            {!!files.length && <div className="mt-3 text-xs text-gray-500">{files.map(f=>f.name).join(' • ')}</div>}
          </section>
        </div>

        <aside className="p-5 md:p-7 space-y-5 bg-gray-50/60 dark:bg-gray-900/30">
          <div><label className="field-label">اقدام‌کننده *</label><UserSelector users={users} groups={groups} value={form.assigneeId} onChange={(id,name)=>setForm(v=>({...v,assigneeId:id,assigneeName:name}))} placeholder="انتخاب اقدام‌کننده"/></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="field-label">وضعیت اولیه</label><select value={form.status} onChange={e=>setForm(v=>({...v,status:e.target.value as Task['status']}))} className="action-input"><option value="pending">در انتظار</option><option value="in_progress">در حال انجام</option><option value="completed">تکمیل شده</option></select></div><div><label className="field-label">اولویت</label><select value={form.priority} onChange={e=>setForm(v=>({...v,priority:e.target.value as Task['priority']}))} className="action-input"><option value="high">بالا</option><option value="medium">متوسط</option><option value="low">پایین</option></select></div></div>

          <div className="rounded-2xl border border-violet-200 dark:border-violet-900/50 p-4 bg-violet-50/50 dark:bg-violet-950/15 space-y-4">
            <div><label className="field-label flex items-center gap-2"><FolderKanban className="w-4 h-4"/> پروژه مدیریت پروژه</label><select value={form.projectId} onChange={e=>setForm(v=>({...v,projectId:e.target.value}))} className="action-input"><option value="">بدون ارتباط</option>{managementProjects.map(p=><option key={p.id} value={p.id}>{p.name}{p.code?` (${p.code})`:''}</option>)}</select></div>
            <div><div className="flex items-center justify-between mb-1"><label className="field-label !mb-0">پروژه شخصی من</label><button type="button" onClick={onManagePersonalProjects} className="text-xs text-violet-600 hover:underline">مدیریت پروژه‌های شخصی</button></div><select value={form.personalProjectId} onChange={e=>setForm(v=>({...v,personalProjectId:e.target.value}))} className="action-input"><option value="">بدون پروژه شخصی</option>{personalProjects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><p className="text-[11px] text-gray-400 mt-1">این پروژه‌ها از پروژه‌های سازمانی کاملاً جدا هستند.</p></div>
          </div>

          <div className="grid grid-cols-2 gap-3"><div><label className="field-label">تاریخ شروع</label><JalaliDateInput value={startDate} onChange={setStartDate}/></div><div><label className="field-label">سررسید *</label><JalaliDateInput value={dueDate} onChange={setDueDate}/></div></div>
          <div><label className="field-label">زمان تخمینی (ساعت)</label><input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e=>setForm(v=>({...v,estimatedHours:e.target.value}))} placeholder="مثلاً 2" className="action-input" /></div>
          <div><label className="field-label flex items-center gap-2"><Bell className="w-4 h-4"/> یادآور</label><JalaliDateInput value={reminderAt} onChange={setReminderAt}/></div>
          <div><label className="field-label">برچسب‌ها</label><input value={form.tagsText} onChange={e=>setForm(v=>({...v,tagsText:e.target.value}))} placeholder="فوری، طراحی، پیگیری" className="action-input" /></div>

          <div><label className="field-label flex items-center gap-2"><CalendarDays className="w-4 h-4"/> اقدام والد</label><select value={form.parentTaskId} onChange={e=>setForm(v=>({...v,parentTaskId:e.target.value}))} className="action-input"><option value="">بدون اقدام والد</option>{tasks.filter(t=>!t.archived).map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></div>
          <div><label className="field-label flex items-center gap-2"><Link2 className="w-4 h-4"/> وابستگی‌ها</label><div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-1">{availableDependencies.length===0?<div className="text-xs text-gray-400 text-center py-5">اقدام دیگری موجود نیست.</div>:availableDependencies.map(t=><label key={t.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-sm cursor-pointer"><input type="checkbox" checked={dependencyIds.includes(t.id)} onChange={()=>toggleDependency(t.id)}/><span className="truncate dark:text-gray-200">{t.title}</span></label>)}</div></div>
        </aside>
      </div>
      <style>{`.field-label{display:block;font-size:.78rem;font-weight:600;color:rgb(75 85 99);margin-bottom:.35rem}.dark .field-label{color:rgb(209 213 219)}.action-input{width:100%;border:1px solid rgb(209 213 219);border-radius:.8rem;padding:.68rem .8rem;background:white;color:rgb(17 24 39);font-size:.875rem;outline:none}.action-input:focus{border-color:rgb(139 92 246);box-shadow:0 0 0 3px rgba(139,92,246,.10)}.dark .action-input{background:rgb(17 24 39);border-color:rgb(55 65 81);color:white}`}</style>
    </form>
  </div>;
}
