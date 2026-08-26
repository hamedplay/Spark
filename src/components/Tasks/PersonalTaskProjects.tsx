import React, { useEffect, useState } from 'react';
import { FolderPlus, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

export interface PersonalTaskProject {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  color: string | null;
}

export function PersonalTaskProjects({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged?: () => void }) {
  const [projects, setProjects] = useState<PersonalTaskProject[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from('task_personal_projects').select('*').eq('owner_id', userId).order('created_at', { ascending: false });
    if (error) return toast.error('دریافت پروژه‌های شخصی ناموفق بود');
    setProjects((data || []) as PersonalTaskProject[]);
  };

  useEffect(() => { void load(); }, [userId]);

  const createProject = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const { error } = await supabase.from('task_personal_projects').insert({ owner_id: userId, name: name.trim(), description: description.trim() || null });
    setBusy(false);
    if (error) return toast.error(error.code === '23505' ? 'پروژه‌ای با این نام وجود دارد' : 'ایجاد پروژه ناموفق بود');
    setName(''); setDescription('');
    toast.success('پروژه شخصی ایجاد شد');
    await load(); onChanged?.();
  };

  const removeProject = async (id: string) => {
    const { error } = await supabase.from('task_personal_projects').delete().eq('id', id).eq('owner_id', userId);
    if (error) return toast.error('حذف پروژه ناموفق بود');
    await load(); onChanged?.();
  };

  return <div className="fixed inset-0 z-[10000] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" dir="rtl">
    <div className="w-full max-w-2xl rounded-3xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div><h3 className="font-bold text-lg dark:text-white">پروژه‌های شخصی اقدامات</h3><p className="text-xs text-gray-500 mt-1">این پروژه‌ها مستقل از ماژول مدیریت پروژه هستند و فقط برای خود شما نمایش داده می‌شوند.</p></div>
        <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800"><X className="w-5 h-5" /></button>
      </div>
      <div className="p-5 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.5fr_auto] gap-3">
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="نام پروژه شخصی" className="px-3 py-2.5 rounded-xl border dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          <input value={description} onChange={e=>setDescription(e.target.value)} placeholder="توضیح کوتاه (اختیاری)" className="px-3 py-2.5 rounded-xl border dark:border-gray-700 dark:bg-gray-800 dark:text-white" />
          <button disabled={busy || !name.trim()} onClick={()=>void createProject()} className="px-4 py-2.5 rounded-xl bg-violet-600 text-white flex items-center justify-center gap-2 disabled:opacity-50"><FolderPlus className="w-4 h-4" /> ایجاد</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {projects.length === 0 ? <div className="sm:col-span-2 text-sm text-gray-400 text-center py-10">هنوز پروژه شخصی نساخته‌اید.</div> : projects.map(p => <div key={p.id} className="rounded-2xl border border-gray-200 dark:border-gray-700 p-4 bg-gray-50/60 dark:bg-gray-800/40">
            <div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-gray-800 dark:text-white">{p.name}</div><div className="text-xs text-gray-500 mt-1 line-clamp-2">{p.description || 'بدون توضیح'}</div></div><button onClick={()=>void removeProject(p.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></div>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}
