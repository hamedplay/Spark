import React, { useState } from 'react';
import { X, Loader as Loader2 } from 'lucide-react';
import { type MeetingRow } from './types';
import { toJalali, jalaliToGregorian, INP, SEL } from './utils';
import { JalaliInput } from './JalaliInput';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

function MeetingEditModal({ meeting, onClose, onSaved }: {
  meeting: MeetingRow; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState({
    subject: meeting.subject || '',
    representative: meeting.representative || '',
    phone: meeting.phone || '',
    location: meeting.location || '',
    duration: meeting.duration || '',
    notes: meeting.notes || '',
    priority: meeting.priority || 'medium',
    status: meeting.status || 'open',
    status_type: meeting.status_type || 'requested',
    request_date: meeting.request_date || '',
    start_time: meeting.start_time ? toJalali(meeting.start_time) : '',
    end_time: meeting.end_time ? toJalali(meeting.end_time) : '',
    members_only: meeting.members_only || false,
    repeat_type: meeting.repeat_type || '',
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const payload: Record<string, any> = {
      subject: form.subject,
      representative: form.representative,
      phone: form.phone,
      location: form.location,
      duration: form.duration,
      notes: form.notes,
      priority: form.priority,
      status: form.status,
      status_type: form.status_type,
      members_only: form.members_only,
      repeat_type: form.repeat_type || null,
    };
    // Convert jalali back to ISO
    if (form.start_time) {
      const iso = jalaliToGregorian(form.start_time);
      if (iso) payload.start_time = iso;
    }
    if (form.end_time) {
      const iso = jalaliToGregorian(form.end_time);
      if (iso) payload.end_time = iso;
    }
    const { error } = await supabase.from('meetings').update(payload).eq('id', meeting.id);
    setSaving(false);
    if (error) { toast.error('خطا در ذخیره'); return; }
    toast.success('جلسه ویرایش شد');
    onSaved();
    onClose();
  };

  const f = (label: string, key: keyof typeof form, type: 'text' | 'select' | 'textarea' | 'jalali' | 'toggle' = 'text', opts?: { value: string; label: string }[]) => (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</label>
      {type === 'textarea' ? (
        <textarea rows={2} value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={INP + ' resize-none'} />
      ) : type === 'select' && opts ? (
        <select value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={SEL}>
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : type === 'toggle' ? (
        <button type="button" onClick={() => setForm(p => ({ ...p, [key]: !p[key] }))}
          className={`w-10 h-5 rounded-full relative transition-colors ${form[key] ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      ) : type === 'jalali' ? (
        <JalaliInput value={form[key] as string} onChange={v => setForm(p => ({ ...p, [key]: v }))} />
      ) : (
        <input type="text" value={form[key] as string} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} className={INP} />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <h3 className="font-bold text-gray-900 dark:text-white">ویرایش جلسه</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {f('موضوع جلسه', 'subject')}
            {f('نماینده', 'representative')}
            {f('تلفن', 'phone')}
            {f('مکان', 'location')}
            {f('مدت', 'duration')}
            {f('تکرار', 'repeat_type', 'select', [
              { value: '', label: 'بدون تکرار' },
              { value: 'daily', label: 'روزانه' },
              { value: 'weekly', label: 'هفتگی' },
              { value: 'monthly', label: 'ماهانه' },
            ])}
            {f('وضعیت', 'status', 'select', [
              { value: 'open', label: 'باز' },
              { value: 'closed', label: 'بسته' },
            ])}
            {f('نوع', 'status_type', 'select', [
              { value: 'requested', label: 'درخواست شده' },
              { value: 'approved', label: 'تایید شده' },
            ])}
            {f('اولویت', 'priority', 'select', [
              { value: 'high', label: 'بالا' },
              { value: 'medium', label: 'متوسط' },
              { value: 'low', label: 'پایین' },
            ])}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">فقط اعضا</label>
              <button type="button" onClick={() => setForm(p => ({ ...p, members_only: !p.members_only }))}
                className={`w-10 h-5 rounded-full relative transition-colors ${form.members_only ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.members_only ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">زمان شروع (شمسی)</label>
              <JalaliInput value={form.start_time} onChange={v => setForm(p => ({ ...p, start_time: v }))} placeholder="1403/06/15" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">زمان پایان (شمسی)</label>
              <JalaliInput value={form.end_time} onChange={v => setForm(p => ({ ...p, end_time: v }))} placeholder="1403/06/15" />
            </div>
          </div>
          {f('یادداشت', 'notes', 'textarea')}
        </div>
        <div className="flex gap-3 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
          <button onClick={save} disabled={saving} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} ذخیره
          </button>
          <button onClick={onClose} className="flex-1 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

export { MeetingEditModal };
