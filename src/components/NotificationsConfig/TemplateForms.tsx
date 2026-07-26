import { useState, useRef } from 'react';
import { X, ChevronDown, Plus, Save, Loader as Loader2, CreditCard as Edit2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invalidateTemplateCache } from '../../lib/notifications';
import toast from 'react-hot-toast';
import {
  TEMPLATE_CATEGORIES as NOTIF_CATEGORIES,
  TEMPLATE_EVENT_TYPES as EVENT_TYPES,
  TEMPLATE_AUDIENCES as AUDIENCES,
  TEMPLATE_PLACEHOLDERS as ALL_PLACEHOLDERS,
  extractPlaceholders,
  findUnknownPlaceholders,
  TEMPLATE_EVENTS,
  validateTemplateForEvent,
} from '../../config/templateCatalog';
import { COLORS, inp, type NotificationTemplate } from './types';
import { Toggle } from './Toggle';

export function TemplateEditor({ template, onSave, onCancel }: {
  template: NotificationTemplate; onSave: (t: NotificationTemplate) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...template });
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [activeField, setActiveField] = useState<'title' | 'body'>('body');

  const insertPlaceholder = (ph: string) => {
    if (activeField === 'title') {
      const el = titleRef.current;
      if (el) {
        const s = el.selectionStart ?? form.title.length;
        const e = el.selectionEnd ?? form.title.length;
        const val = form.title.slice(0, s) + `{{${ph}}}` + form.title.slice(e);
        setForm(f => ({ ...f, title: val }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    } else {
      const el = bodyRef.current;
      if (el) {
        const s = el.selectionStart ?? form.body.length;
        const e = el.selectionEnd ?? form.body.length;
        const val = form.body.slice(0, s) + `{{${ph}}}` + form.body.slice(e);
        setForm(f => ({ ...f, body: val }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    }
    if (!form.placeholders.includes(ph)) setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('عنوان اعلان الزامی است'); return; }
    if (!form.body.trim()) { toast.error('متن اعلان نمی‌تواند خالی باشد'); return; }
    const unknown = findUnknownPlaceholders(form.body);
    if (unknown.length > 0) {
      toast.error(`متغیر ناشناخته: ${unknown.join('، ')}`);
      return;
    }
    const eventDef = TEMPLATE_EVENTS.find(e => e.key === form.event_type && e.category === form.category);
    if (eventDef) {
      const validation = validateTemplateForEvent(form.body, eventDef, ALL_PLACEHOLDERS.map(p => p.key));
      if (validation.missingRequiredPlaceholders.length > 0) {
        const labels = validation.missingRequiredPlaceholders.map(k => ALL_PLACEHOLDERS.find(p => p.key === k)?.label || k);
        toast.error(`متغیرهای اجباری استفاده‌نشده: ${labels.join('، ')}`);
        return;
      }
    }
    const extracted = extractPlaceholders(form.body);
    setSaving(true);
    const { error } = await supabase.from('notification_templates')
      .update({
        title: form.title,
        body: form.body,
        icon: form.icon,
        color: form.color,
        placeholders: extracted.length > 0 ? extracted : form.placeholders,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', form.id);
    if (error) { toast.error('خطا در ذخیره قالب'); setSaving(false); return; }
    toast.success('قالب اعلان ذخیره شد');
    invalidateTemplateCache();
    setSaving(false);
    onSave({ ...form });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-700 p-6 space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Edit2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">ویرایش قالب اعلان</h4>
          <p className="text-xs text-gray-400">{NOTIF_CATEGORIES.find(c => c.key === template.category)?.label} — {template.event_type} — {AUDIENCES.find(a => a.key === template.audience)?.label}</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          درج متغیر در <span className="text-amber-600 dark:text-amber-400 font-semibold">{activeField === 'title' ? 'عنوان' : 'متن'}</span>:
        </p>
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
          {ALL_PLACEHOLDERS.map(p => (
            <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)}
              title={p.label}
              className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:border-amber-300 transition-colors font-mono">
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">عنوان اعلان *</label>
        <input ref={titleRef} className={inp} value={form.title}
          onFocus={() => setActiveField('title')}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="عنوان اعلان" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">متن اعلان *</label>
          <span className="text-xs text-gray-400">{form.body.length} کاراکتر</span>
        </div>
        <textarea ref={bodyRef} rows={3} className={inp + ' resize-none'}
          onFocus={() => setActiveField('body')}
          value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="متن اعلان را وارد کنید..." />
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div>
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">رنگ اعلان:</p>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, color: c.key }))}
                className={`w-6 h-6 rounded-full ${c.cls} transition-transform ${form.color === c.key ? 'scale-125 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-gray-400' : 'hover:scale-110'}`}
                title={c.label} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-2.5 mr-auto">
          <span className="text-sm text-gray-600 dark:text-gray-300">قالب فعال باشد</span>
          <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'ذخیره...' : 'ذخیره قالب'}
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          انصراف
        </button>
      </div>
    </div>
  );
}

export function NewTemplateForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    category: 'meeting', event_type: '', audience: 'all',
    title: '', body: '', icon: 'bell', color: 'blue',
    placeholders: [] as string[], is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [phInput, setPhInput] = useState('');
  const [activeField, setActiveField] = useState<'title' | 'body'>('body');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const insertPlaceholder = (ph: string) => {
    if (activeField === 'title') {
      const el = titleRef.current;
      if (el) {
        const s = el.selectionStart ?? form.title.length;
        const e = el.selectionEnd ?? form.title.length;
        setForm(f => ({ ...f, title: f.title.slice(0, s) + `{{${ph}}}` + f.title.slice(e) }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    } else {
      const el = bodyRef.current;
      if (el) {
        const s = el.selectionStart ?? form.body.length;
        const e = el.selectionEnd ?? form.body.length;
        setForm(f => ({ ...f, body: f.body.slice(0, s) + `{{${ph}}}` + f.body.slice(e) }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    }
    if (!form.placeholders.includes(ph)) setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
  };

  const addCustomPh = () => {
    const ph = phInput.trim().replace(/\s+/g, '_');
    if (!ph || form.placeholders.includes(ph)) { setPhInput(''); return; }
    setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
    setPhInput('');
  };

  const removePh = (ph: string) => setForm(f => ({ ...f, placeholders: f.placeholders.filter(p => p !== ph) }));

  const handleSave = async () => {
    if (!form.event_type.trim()) { toast.error('نوع رویداد الزامی است'); return; }
    if (!form.title.trim()) { toast.error('عنوان اعلان الزامی است'); return; }
    if (!form.body.trim()) { toast.error('متن اعلان نمی‌تواند خالی باشد'); return; }
    const unknown = findUnknownPlaceholders(form.body);
    if (unknown.length > 0) {
      toast.error(`متغیر ناشناخته: ${unknown.join('، ')}`);
      return;
    }
    const eventDef = TEMPLATE_EVENTS.find(e => e.key === form.event_type && e.category === form.category);
    if (eventDef) {
      const validation = validateTemplateForEvent(form.body, eventDef, ALL_PLACEHOLDERS.map(p => p.key));
      if (validation.missingRequiredPlaceholders.length > 0) {
        const labels = validation.missingRequiredPlaceholders.map(k => ALL_PLACEHOLDERS.find(p => p.key === k)?.label || k);
        toast.error(`متغیرهای اجباری استفاده‌نشده: ${labels.join('، ')}`);
        return;
      }
    }
    const extracted = extractPlaceholders(form.body);
    setSaving(true);
    const { error } = await supabase.from('notification_templates').insert([{
      ...form,
      placeholders: extracted.length > 0 ? extracted : form.placeholders,
    }]);
    if (error) {
      if (error.code === '23505') toast.error('قالبی با این ترکیب از قبل وجود دارد');
      else toast.error('خطا در ذخیره قالب');
      setSaving(false);
      return;
    }
    toast.success('قالب اعلان جدید اضافه شد');
    invalidateTemplateCache();
    setSaving(false);
    onSave();
  };

  const selClass = 'appearance-none ' + inp + ' pl-8';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-300 dark:border-amber-600 p-6 space-y-5" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Plus className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">ایجاد قالب اعلان جدید</h4>
          <p className="text-xs text-gray-400">فیلدهای ستاره‌دار الزامی هستند</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">دسته *</label>
          <div className="relative">
            <select className={selClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {NOTIF_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نوع رویداد *</label>
          <div className="relative">
            <select className={selClass} value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
              <option value="">انتخاب کنید</option>
              {EVENT_TYPES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">مخاطب *</label>
          <div className="relative">
            <select className={selClass} value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}>
              {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          درج متغیر در <span className="text-amber-600 dark:text-amber-400 font-semibold">{activeField === 'title' ? 'عنوان' : 'متن'}</span> (کلیک کنید):
        </p>
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
          {ALL_PLACEHOLDERS.map(p => (
            <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)}
              title={p.label}
              className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:border-amber-300 transition-colors font-mono">
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">عنوان اعلان *</label>
        <input ref={titleRef} className={inp} value={form.title}
          onFocus={() => setActiveField('title')}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="مثال: دعوت به جلسه «{{meeting_subject}}»" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">متن اعلان *</label>
          <span className="text-xs text-gray-400">{form.body.length} کاراکتر</span>
        </div>
        <textarea ref={bodyRef} rows={3} className={inp + ' resize-none'}
          onFocus={() => setActiveField('body')}
          value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="متن کامل اعلان را بنویسید. برای درج متغیر روی دکمه‌های بالا کلیک کنید..." />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">رنگ اعلان:</p>
        <div className="flex gap-2.5">
          {COLORS.map(c => (
            <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, color: c.key }))}
              className={`w-7 h-7 rounded-full ${c.cls} transition-transform ${form.color === c.key ? 'scale-125 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-gray-400' : 'hover:scale-110'}`}
              title={c.label} />
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">افزودن متغیر سفارشی:</p>
        <div className="flex gap-2">
          <input className={inp + ' flex-1'} value={phInput} onChange={e => setPhInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomPh(); } }}
            placeholder="نام_متغیر" dir="ltr" />
          <button type="button" onClick={addCustomPh}
            className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition flex-shrink-0">
            افزودن
          </button>
        </div>
        {form.placeholders.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {form.placeholders.map(ph => (
              <span key={ph} className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg font-mono">
                {`{{${ph}}}`}
                <button onClick={() => removePh(ph)} className="text-amber-400 hover:text-red-500 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <span className="text-sm text-gray-600 dark:text-gray-300">قالب فعال باشد</span>
        <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره قالب'}
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          انصراف
        </button>
      </div>
    </div>
  );
}
