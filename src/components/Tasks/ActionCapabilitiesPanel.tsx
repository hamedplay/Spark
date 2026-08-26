import React, { useEffect, useMemo, useState } from 'react';
import { CheckSquare, FileText, FolderKanban, Link2, Plus, Trash2, Upload, Bell, Clock3, GitBranch } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { type ActionTask } from './TaskCard';

interface ChecklistItem { id: string; task_id: string; title: string; is_completed: boolean; sort_order: number; }
interface Attachment { id: string; task_id: string; file_name: string; file_path: string; file_size: number | null; mime_type: string | null; created_at: string; }
interface ProjectOption { id: string; name: string; code: string; }
interface TaskOption { id: string; title: string; }

type CapabilityTask = ActionTask & {
  project_id?: string | null;
  reminder_at?: string | null;
  actual_minutes?: number | null;
  parent_task_id?: string | null;
};

export function ActionCapabilitiesPanel({ task, onTaskChanged }: { task: CapabilityTask; onTaskChanged?: () => void; }) {
  const [tab, setTab] = useState<'checklist'|'files'|'relations'>('checklist');
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [allTasks, setAllTasks] = useState<TaskOption[]>([]);
  const [dependencyIds, setDependencyIds] = useState<string[]>([]);
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState(task.project_id || '');
  const [parentTaskId, setParentTaskId] = useState(task.parent_task_id || '');
  const [reminderAt, setReminderAt] = useState(task.reminder_at ? String(task.reminder_at).slice(0, 16) : '');
  const [actualMinutes, setActualMinutes] = useState(task.actual_minutes == null ? '' : String(task.actual_minutes));

  const syncTaskState = () => {
    setProjectId(task.project_id || '');
    setParentTaskId(task.parent_task_id || '');
    setReminderAt(task.reminder_at ? String(task.reminder_at).slice(0, 16) : '');
    setActualMinutes(task.actual_minutes == null ? '' : String(task.actual_minutes));
  };

  const load = async () => {
    const [checkRes, fileRes, projectRes, taskRes, depRes] = await Promise.all([
      supabase.from('task_checklist_items').select('*').eq('task_id', task.id).order('sort_order').order('created_at'),
      supabase.from('task_attachments').select('*').eq('task_id', task.id).order('created_at', { ascending: false }),
      supabase.from('projects').select('id,name,code').order('name'),
      supabase.from('tasks').select('id,title').neq('id', task.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('task_dependencies').select('depends_on_task_id').eq('task_id', task.id),
    ]);

    const firstError = checkRes.error || fileRes.error || projectRes.error || taskRes.error || depRes.error;
    if (firstError) {
      console.error('[action-capabilities] load failed', firstError);
      toast.error('بارگذاری قابلیت‌های اقدام ناموفق بود');
    }

    if (checkRes.data) setItems(checkRes.data as ChecklistItem[]);
    if (fileRes.data) setAttachments(fileRes.data as Attachment[]);
    if (projectRes.data) setProjects(projectRes.data as ProjectOption[]);
    if (taskRes.data) setAllTasks(taskRes.data as TaskOption[]);
    if (depRes.data) setDependencyIds(depRes.data.map((x: { depends_on_task_id: string }) => x.depends_on_task_id));
  };

  useEffect(() => {
    syncTaskState();
    void load();
  }, [task.id]);

  const completed = useMemo(() => items.filter(i => i.is_completed).length, [items]);

  const addChecklist = async () => {
    if (!newItem.trim()) return;
    const { error } = await supabase.from('task_checklist_items').insert({ task_id: task.id, title: newItem.trim(), sort_order: items.length });
    if (error) return toast.error('خطا در افزودن چک‌لیست');
    setNewItem('');
    await load();
  };

  const toggleChecklist = async (item: ChecklistItem) => {
    const next = !item.is_completed;
    const { error } = await supabase.from('task_checklist_items').update({ is_completed: next, completed_at: next ? new Date().toISOString() : null }).eq('id', item.id);
    if (error) return toast.error('خطا در بروزرسانی چک‌لیست');
    await load();
  };

  const deleteChecklist = async (id: string) => {
    const { error } = await supabase.from('task_checklist_items').delete().eq('id', id);
    if (error) return toast.error('حذف آیتم چک‌لیست ناموفق بود');
    await load();
  };

  const uploadFile = async (file: File) => {
    setBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error('no-user');
      const safeName = file.name.replace(/[^a-zA-Z0-9._\-\u0600-\u06FF]/g, '_');
      const path = `${uid}/${task.id}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage.from('task-attachments').upload(path, file, { upsert: false });
      if (upErr) throw upErr;
      const { error: rowErr } = await supabase.from('task_attachments').insert({ task_id: task.id, file_name: file.name, file_path: path, file_size: file.size, mime_type: file.type || null });
      if (rowErr) {
        await supabase.storage.from('task-attachments').remove([path]);
        throw rowErr;
      }
      toast.success('فایل اضافه شد');
      await load();
    } catch (error) {
      console.error('[action-capabilities] upload failed', error);
      toast.error('بارگذاری فایل ناموفق بود');
    } finally {
      setBusy(false);
    }
  };

  const openAttachment = async (a: Attachment) => {
    const { data, error } = await supabase.storage.from('task-attachments').createSignedUrl(a.file_path, 300);
    if (error || !data?.signedUrl) return toast.error('دریافت فایل ناموفق بود');
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const deleteAttachment = async (a: Attachment) => {
    const { error: storageError } = await supabase.storage.from('task-attachments').remove([a.file_path]);
    if (storageError) return toast.error('حذف فایل ناموفق بود');
    const { error: rowError } = await supabase.from('task_attachments').delete().eq('id', a.id);
    if (rowError) return toast.error('حذف اطلاعات فایل ناموفق بود');
    await load();
  };

  const updateTaskField = async (patch: Record<string, unknown>, applyLocal?: () => void) => {
    const { error } = await supabase.from('tasks').update(patch).eq('id', task.id);
    if (error) return toast.error('ذخیره تغییرات ناموفق بود');
    applyLocal?.();
    toast.success('ذخیره شد');
    onTaskChanged?.();
  };

  const toggleDependency = async (depId: string) => {
    if (dependencyIds.includes(depId)) {
      const { error } = await supabase.from('task_dependencies').delete().eq('task_id', task.id).eq('depends_on_task_id', depId);
      if (error) return toast.error('حذف وابستگی ناموفق بود');
    } else {
      const { error } = await supabase.from('task_dependencies').insert({ task_id: task.id, depends_on_task_id: depId });
      if (error) return toast.error('ثبت وابستگی ناموفق بود');
    }
    await load();
  };

  return (
    <section className="rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="px-4 pt-4">
        <h3 className="font-bold text-gray-800 dark:text-white">قابلیت‌های اقدام</h3>
        <p className="mt-1 text-xs text-gray-400">چک‌لیست، فایل‌ها، پروژه، اقدام والد، وابستگی‌ها، یادآور و زمان واقعی</p>
      </div>
      <div className="flex border-b border-gray-200 dark:border-gray-700 text-sm mt-3">
        <button onClick={() => setTab('checklist')} className={`flex-1 py-3 ${tab==='checklist'?'font-bold text-violet-600 bg-violet-50/60 dark:bg-violet-900/20':'text-gray-500'}`}>چک‌لیست {items.length ? `(${completed}/${items.length})` : ''}</button>
        <button onClick={() => setTab('files')} className={`flex-1 py-3 ${tab==='files'?'font-bold text-violet-600 bg-violet-50/60 dark:bg-violet-900/20':'text-gray-500'}`}>فایل‌ها {attachments.length ? `(${attachments.length})` : ''}</button>
        <button onClick={() => setTab('relations')} className={`flex-1 py-3 ${tab==='relations'?'font-bold text-violet-600 bg-violet-50/60 dark:bg-violet-900/20':'text-gray-500'}`}>ارتباطات</button>
      </div>

      {tab === 'checklist' && <div className="p-4 space-y-3">
        <div className="flex gap-2"><input value={newItem} onChange={e=>setNewItem(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void addChecklist();}}} placeholder="آیتم جدید چک‌لیست..." className="flex-1 px-3 py-2 rounded-xl border dark:border-gray-700 dark:bg-gray-800 text-sm"/><button onClick={()=>void addChecklist()} className="px-3 rounded-xl bg-violet-600 text-white" aria-label="افزودن آیتم"><Plus className="w-4 h-4"/></button></div>
        {items.length===0 ? <div className="text-sm text-gray-400 py-6 text-center">چک‌لیستی ثبت نشده است.</div> : items.map(item => <div key={item.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800/60"><button onClick={()=>void toggleChecklist(item)} className={`w-5 h-5 rounded border flex items-center justify-center ${item.is_completed?'bg-emerald-500 border-emerald-500 text-white':'border-gray-300'}`}>{item.is_completed && <CheckSquare className="w-3.5 h-3.5"/>}</button><span className={`flex-1 text-sm ${item.is_completed?'line-through text-gray-400':'text-gray-700 dark:text-gray-200'}`}>{item.title}</span><button onClick={()=>void deleteChecklist(item.id)} className="text-gray-400 hover:text-red-500" aria-label="حذف آیتم"><Trash2 className="w-4 h-4"/></button></div>)}
      </div>}

      {tab === 'files' && <div className="p-4 space-y-3">
        <label className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-xl py-5 text-sm cursor-pointer ${busy?'opacity-50 pointer-events-none':'text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-900/20'}`}><Upload className="w-4 h-4"/> {busy ? 'در حال بارگذاری...' : 'افزودن فایل'}<input type="file" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f) void uploadFile(f);e.currentTarget.value='';}}/></label>
        {attachments.length === 0 && <div className="text-sm text-gray-400 py-6 text-center">فایلی پیوست نشده است.</div>}
        {attachments.map(a => <div key={a.id} className="flex items-center gap-3 border rounded-xl p-3 dark:border-gray-700"><FileText className="w-4 h-4 text-violet-500"/><button onClick={()=>void openAttachment(a)} className="flex-1 text-right text-sm text-gray-700 dark:text-gray-200 hover:text-violet-600 truncate">{a.file_name}</button><span className="text-xs text-gray-400">{a.file_size ? `${Math.max(1,Math.round(a.file_size/1024))} KB` : ''}</span><button onClick={()=>void deleteAttachment(a)} className="text-gray-400 hover:text-red-500" aria-label="حذف فایل"><Trash2 className="w-4 h-4"/></button></div>)}
      </div>}

      {tab === 'relations' && <div className="p-4 space-y-4">
        <div>
          <label className="text-xs text-gray-500 flex items-center gap-1 mb-1"><FolderKanban className="w-3.5 h-3.5"/> پروژه مرتبط</label>
          <select value={projectId} onChange={e=>{const value=e.target.value; void updateTaskField({project_id:value||null},()=>setProjectId(value));}} className="w-full px-3 py-2 rounded-xl border dark:border-gray-700 dark:bg-gray-800 text-sm"><option value="">بدون پروژه</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name} {p.code ? `(${p.code})` : ''}</option>)}</select>
        </div>
        <div>
          <label className="text-xs text-gray-500 flex items-center gap-1 mb-1"><GitBranch className="w-3.5 h-3.5"/> اقدام والد</label>
          <select value={parentTaskId} onChange={e=>{const value=e.target.value; void updateTaskField({parent_task_id:value||null},()=>setParentTaskId(value));}} className="w-full px-3 py-2 rounded-xl border dark:border-gray-700 dark:bg-gray-800 text-sm"><option value="">بدون اقدام والد</option>{allTasks.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select>
        </div>
        <div>
          <label className="text-xs text-gray-500 flex items-center gap-1 mb-1"><Bell className="w-3.5 h-3.5"/> یادآور</label>
          <input type="datetime-local" value={reminderAt} onChange={e=>setReminderAt(e.target.value)} onBlur={e=>{const value=e.target.value; void updateTaskField({reminder_at:value?new Date(value).toISOString():null},()=>setReminderAt(value));}} className="w-full px-3 py-2 rounded-xl border dark:border-gray-700 dark:bg-gray-800 text-sm"/>
        </div>
        <div>
          <label className="text-xs text-gray-500 flex items-center gap-1 mb-1"><Clock3 className="w-3.5 h-3.5"/> زمان صرف‌شده (دقیقه)</label>
          <input type="number" min={0} value={actualMinutes} onChange={e=>setActualMinutes(e.target.value)} onBlur={e=>{const value=e.target.value; void updateTaskField({actual_minutes:value===''?null:Number(value)},()=>setActualMinutes(value));}} className="w-full px-3 py-2 rounded-xl border dark:border-gray-700 dark:bg-gray-800 text-sm"/>
        </div>
        <div>
          <label className="text-xs text-gray-500 flex items-center gap-1 mb-2"><Link2 className="w-3.5 h-3.5"/> وابستگی به اقدامات دیگر</label>
          <div className="max-h-48 overflow-y-auto space-y-1 border rounded-xl p-2 dark:border-gray-700">{allTasks.length === 0 ? <div className="text-xs text-gray-400 p-3 text-center">اقدام دیگری برای انتخاب وجود ندارد.</div> : allTasks.map(t=><label key={t.id} className="flex items-center gap-2 text-sm p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg cursor-pointer"><input type="checkbox" checked={dependencyIds.includes(t.id)} onChange={()=>void toggleDependency(t.id)}/><span className="truncate">{t.title}</span></label>)}</div>
        </div>
      </div>}
    </section>
  );
}
