import React, { useState } from 'react';
import { X, Loader as Loader2 } from 'lucide-react';
import { type TaskRow, type Profile } from './types';
import { toJalali, jalaliToGregorian, INP, SEL } from './utils';
import { JalaliInput } from './JalaliInput';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

function TaskEditModal({ task, profiles, onClose, onSaved }: {
  task: TaskRow; profiles: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    title: task.title || '',
    description: task.description || '',
    status: task.status || 'pending',
    priority: task.priority || 'medium',
    assignee: task.assignee || '',
    due_date: task.due_date ? toJalali(task.due_date) : '',
    archived: task.archived || false,
    current_assignee_id: task.current_assignee_id || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      title: form.title,
      description: form.description,
      status: form.status,
      priority: form.priority,
      assignee: form.assignee,
      archived: form.archived,
      current_assignee_id: form.current_assignee_id || null,
    };
    if (form.due_date) {
      const iso = jalaliToGregorian(form.due_date);
      if (iso) payload.due_date = iso;
    }
    const { error } = await supabase.from('tasks').update(payload).eq('id', task.id);
    setSaving(false);
    if (error) { toast.error('خطا در ذخیره'); return; }
    toast.success('اقدام ویرایش شد');
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-bold text-gray-900 dark:text-white">ویرایش اقدام</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">عنوان</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} className={INP} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">توضیحات</label>
            <textarea rows={3} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} className={INP + ' resize-none'} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">وضعیت</label>
              <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className={SEL}>
                <option value="pending">در انتظار</option>
                <option value="in_progress">در حال انجام</option>
                <option value="completed">تکمیل شده</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">اولویت</label>
              <select value={form.priority || 'medium'} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))} className={SEL}>
                <option value="high">بالا</option>
                <option value="medium">متوسط</option>
                <option value="low">پایین</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">نام مسئول</label>
              <input value={form.assignee} onChange={e => setForm(p => ({ ...p, assignee: e.target.value }))} className={INP} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">مسئول (کاربر)</label>
              <select value={form.current_assignee_id} onChange={e => setForm(p => ({ ...p, current_assignee_id: e.target.value }))} className={SEL}>
                <option value="">انتخاب کنید...</option>
                {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">موعد انجام (شمسی)</label>
              <JalaliInput value={form.due_date} onChange={v => setForm(p => ({ ...p, due_date: v }))} placeholder="1403/06/15" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">بایگانی</label>
              <button type="button" onClick={() => setForm(p => ({ ...p, archived: !p.archived }))}
                className={`w-10 h-5 rounded-full relative transition-colors ${form.archived ? 'bg-gray-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.archived ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} ذخیره
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

export { TaskEditModal };
