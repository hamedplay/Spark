import React, { useEffect, useMemo, useState } from 'react';
import { Bell, CalendarDays, CheckSquare, FileUp, FolderKanban, Link2, ListChecks, Plus, Save, Trash2, X } from 'lucide-react';
import { Task } from '../../types';
import { supabase } from '../../lib/supabase';
import { type OrgUserProfile } from '../../lib/useOrgUsers';
import { type UserProfile } from './types';
import { JalaliDateInput } from './JalaliDateInput';
import { UserSelector } from './UserSelector';
import { type ActionTask } from './TaskCard';
import { type PersonalTaskProject } from './PersonalTaskProjects';
import { type ManagementProjectOption } from './ActionCreateDrawer';

export interface ActionEditPayload {
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
  removedAttachments: Array<{ id: string; file_path: string }>;
}

type AttachmentRow = { id: string; file_name: string; file_path: string };

const asDate = (value?: string | null) => value ? new Date(value) : null;

export function ActionEditDrawer({
  task, users, groups, tasks, managementProjects, personalProjects, busy, onClose, onSave, onManagePersonalProjects,
}: {
  task: ActionTask;
  users: UserProfile[];
  groups: { label: string; users: OrgUserProfile[] }[];
  tasks: ActionTask[];
  managementProjects: ManagementProjectOption[];
  personalProjects: PersonalTaskProject[];
  busy?: boolean;
  onClose: () => void;
  onSave: (payload: ActionEditPayload) => void;
  onManagePersonalProjects: () => void;
}) {
  const source = task as ActionTask & Record<string, any>;
  const initialAssignee = users.find(user => user.user_id === task.current_assignee_id);
  const [form, setForm] = useState({
    title: task.title || '',
    description: task.description || '',
    priority: task.priority || 'medium' as Task['priority'],
    status: task.status || 'pending' as Task['status'],
    assigneeId: task.current_assignee_id || '',
    assigneeName: initialAssignee?.full_name || task.assignee || '',
    estimatedHours: source.estimated_minutes ? String(Math.round((source.estimated_minutes / 60) * 10) / 10) : '',
    tagsText: Array.isArray(source.tags) ? source.tags.join('، ') : '',
    projectId: source.project_id || '',
    personalProjectId: source.personal_project_id || '',
    parentTaskId: source.parent_task_id || '',
  });
  const [startDate, setStartDate] = useState<Date | null>(asDate(source.start_date));
  const [dueDate, setDueDate] = useState<Date | null>(asDate(task.due_date));
  const [reminderAt, setReminderAt] = useState<Date | null>(asDate(source.reminder_at));
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [checklist, setChecklist] = useState<string[]>([]);
  const [checkText, setCheckText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [removedAttachments, setRemovedAttachments] = useState<AttachmentRow[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingRelated(true);
    Promise.all([
      supabase.from('task_checklist_items').select('id,title,sort_order').eq('task_id', task.id).order('sort_order'),
      supabase.from('task_dependencies').select('depends_on_task_id').eq('task_id', task.id),
      supabase.from('task_attachments').select('id,file_name,file_path').eq('task_id', task.id).order('created_at'),
    ]).then(([checkRes, depRes, attachmentRes]) => {
      if (cancelled) return;
      setChecklist((checkRes.data || []).map((item: any) => item.title));
      setDependencyIds((depRes.data || []).map((item: any) => item.depends_on_task_id));
      setAttachments((attachmentRes.data || []) as AttachmentRow[]);
      setLoadingRelated(false);
    });
    return () => { cancelled = true; };
  }, [task.id]);

  const availableDependencies = useMemo(
    () => tasks.filter(item => item.id !== task.id && item.id !== form.parentTaskId && !item.archived),
    [tasks, task.id, form.parentTaskId],
  );

  const addChecklist = () => {
    if (!checkText.trim()) return;
    setChecklist(value => [...value, checkText.trim()]);
    setCheckText('');
  };
  const toggleDependency = (id: string) => setDependencyIds(value => value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  const handleParentTaskChange = (parentTaskId: string) => {
    setForm(value => ({ ...value, parentTaskId }));
    if (parentTaskId) setDependencyIds(value => value.filter(id => id !== parentTaskId));
  };
  const removeAttachment = (attachment: AttachmentRow) => {
    setAttachments(value => value.filter(item => item.id !== attachment.id));
    setRemovedAttachments(value => [...value, attachment]);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || loadingRelated) return;
    onSave({ ...form, startDate, dueDate, reminderAt, dependencyIds, checklist, files, removedAttachments });
  };

  return <div className="fixed inset-0 z-[9999] bg-black/45 backdrop-blur-sm flex justify-end" dir="rtl" onMouseDown={e => { if (!busy && e.target === e.currentTarget) onClose(); }}>
    <form onSubmit={submit} className="h-full w-full xl:w-[1180px] bg-white dark:bg-gray-950 shadow-2xl overflow-y-auto border-r border-gray-200 dark:border-gray-800">
      <div className="sticky top-0 z-20 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-b border-gray-200 dark:border-gray-800 px-5 md:px-7 py-4 flex items-center justify-between">
        <div><h2 className="text-xl font-bold text-gray-900 dark:text-white">ویرایش اقدام</h2><p className="text-xs text-gray-500 mt-1">تمام امکانات جدید اقدام برای رکوردهای قدیمی و جدید قابل ویرایش است.</p></div>
        <div className="flex items-center gap-2"><button type="button" disabled={busy} onClick={onClose} className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-40"><X className="w-5 h-5" /></button><button disabled={busy || loadingRelated} type="submit" className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-medium disabled:opacity-50 flex items-center gap-2"><Save className="w-4 h-4" /> {busy ? 'در حال ذخیره...' : 'ذخیره تغییرات'}</button></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(330px,0.9fr)] min-h-[calc(100vh-78px)]">
        <div className="p-5 md:p-7 space-y-6 lg:border-l border-gray-200 dark:border-gray-800">
          <div><label className="field-label">عنوان اقدام *</label><input required value={form.title} onChange={e=>setForm(v=>({...v,title:e.target.value}))} className="action-input text-base" /></div>
          <div><label className="field-label">توضیحات *</label><textarea required rows={8} value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))} className="action-input resize-none leading-7" /></div>

          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3"><h3 className="font-semibold dark:text-white flex items-center gap-2"><CheckSquare className="w-4 h-4 text-violet-500" /> چک‌لیست</h3><span className="text-xs text-gray-400">{checklist.length} آیتم</span></div>
            <div className="flex gap-2"><input value={checkText} onChange={e=>setCheckText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addChecklist();}}} placeholder="آیتم جدید..." className="action-input"/><button type="button" onClick={addChecklist} className="px-3 rounded-xl border border-violet-300 text-violet-600"><Plus className="w-4 h-4" /></button></div>
            <div className="mt-3 space-y-2">{checklist.map((item,index)=><div key={`${item}-${index}`} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 rounded-xl px-3 py-2 text-sm"><ListChecks className="w-4 h-4 text-gray-400"/><span className="flex-1 dark:text-gray-200">{item}</span><button type="button" onClick={()=>setChecklist(value=>value.filter((_,i)=>i!==index))} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4"/></button></div>)}</div>
          </section>

          <section className="rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
            <h3 className="font-semibold dark:text-white flex items-center gap-2 mb-3"><FileUp className="w-4 h-4 text-violet-500" /> فایل‌ها</h3>
            {!!attachments.length && <div className="space-y-2 mb-3">{attachments.map(file=><div key={file.id} className="flex items-center gap-2 rounded-xl bg-gray-50 dark:bg-gray-900 px-3 py-2 text-sm"><span className="flex-1 truncate dark:text-gray-200">{file.file_name}</span><button type="button" onClick={()=>removeAttachment(file)} className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4"/></button></div>)}</div>}
            <label className="block border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-7 text-center cursor-pointer hover:border-violet-400 transition-colors"><FileUp className="w-7 h-7 mx-auto text-gray-400 mb-2"/><div className="text-sm text-gray-600 dark:text-gray-300">افزودن فایل جدید</div><input type="file" multiple className="hidden" onChange={e=>setFiles(Array.from(e.target.files || []))}/></label>
            {!!files.length && <div className="mt-3 text-xs text-gray-500">{files.map(file=>file.name).join(' • ')}</div>}
          </section>
        </div>

        <aside className="p-5 md:p-7 space-y-5 bg-gray-50/60 dark:bg-gray-900/30">
          <div><label className="field-label">اقدام‌کننده *</label><UserSelector users={users} groups={groups} value={form.assigneeId} onChange={(id,name)=>setForm(v=>({...v,assigneeId:id,assigneeName:name}))} placeholder="انتخاب اقدام‌کننده"/></div>
          <div className="grid grid-cols-2 gap-3"><div><label className="field-label">وضعیت</label><select value={form.status} onChange={e=>setForm(v=>({...v,status:e.target.value as Task['status']}))} className="action-input"><option value="pending">در انتظار</option><option value="in_progress">در حال انجام</option><option value="completed">تکمیل شده</option></select></div><div><label className="field-label">اولویت</label><select value={form.priority} onChange={e=>setForm(v=>({...v,priority:e.target.value as Task['priority']}))} className="action-input"><option value="high">بالا</option><option value="medium">متوسط</option><option value="low">پایین</option></select></div></div>

          <div className="rounded-2xl border border-violet-200 dark:border-violet-900/50 p-4 bg-violet-50/50 dark:bg-violet-950/15 space-y-4">
            <div><label className="field-label flex items-center gap-2"><FolderKanban className="w-4 h-4"/> پروژه مدیریت پروژه</label><select value={form.projectId} onChange={e=>setForm(v=>({...v,projectId:e.target.value}))} className="action-input"><option value="">بدون ارتباط</option>{managementProjects.map(project=><option key={project.id} value={project.id}>{project.name}{project.code?` (${project.code})`:''}</option>)}</select></div>
            <div><div className="flex items-center justify-between mb-1"><label className="field-label !mb-0">پروژه شخصی من</label><button type="button" onClick={onManagePersonalProjects} className="text-xs text-violet-600 hover:underline">مدیریت پروژه‌های شخصی</button></div><select value={form.personalProjectId} onChange={e=>setForm(v=>({...v,personalProjectId:e.target.value}))} className="action-input"><option value="">بدون پروژه شخصی</option>{personalProjects.map(project=><option key={project.id} value={project.id}>{project.name}</option>)}</select></div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><label className="field-label">تاریخ شروع</label><JalaliDateInput value={startDate} onChange={setStartDate}/></div><div><label className="field-label">سررسید *</label><JalaliDateInput value={dueDate} onChange={setDueDate}/></div></div>
          <div><label className="field-label">زمان تخمینی (ساعت)</label><input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e=>setForm(v=>({...v,estimatedHours:e.target.value}))} className="action-input" /></div>
          <div><label className="field-label flex items-center gap-2"><Bell className="w-4 h-4"/> یادآور</label><JalaliDateInput value={reminderAt} onChange={setReminderAt}/></div>
          <div><label className="field-label">برچسب‌ها</label><input value={form.tagsText} onChange={e=>setForm(v=>({...v,tagsText:e.target.value}))} className="action-input" /></div>
          <div><label className="field-label flex items-center gap-2"><CalendarDays className="w-4 h-4"/> اقدام والد</label><select value={form.parentTaskId} onChange={e=>handleParentTaskChange(e.target.value)} className="action-input"><option value="">بدون اقدام والد</option>{tasks.filter(item=>item.id!==task.id&&!item.archived).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
          <div><label className="field-label flex items-center gap-2"><Link2 className="w-4 h-4"/> وابستگی‌ها</label><div className="max-h-44 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 space-y-1">{availableDependencies.length===0?<div className="text-xs text-gray-400 text-center py-5">اقدام دیگری موجود نیست.</div>:availableDependencies.map(item=><label key={item.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-sm cursor-pointer"><input type="checkbox" checked={dependencyIds.includes(item.id)} onChange={()=>toggleDependency(item.id)}/><span className="truncate dark:text-gray-200">{item.title}</span></label>)}</div></div>
        </aside>
      </div>
      <style>{`.field-label{display:block;font-size:.78rem;font-weight:600;color:rgb(75 85 99);margin-bottom:.35rem}.dark .field-label{color:rgb(209 213 219)}.action-input{width:100%;border:1px solid rgb(209 213 219);border-radius:.8rem;padding:.68rem .8rem;background:white;color:rgb(17 24 39);font-size:.875rem;outline:none}.action-input:focus{border-color:rgb(139 92 246);box-shadow:0 0 0 3px rgba(139,92,246,.10)}.dark .action-input{background:rgb(17 24 39);border-color:rgb(55 65 81);color:white}`}</style>
    </form>
  </div>;
}
