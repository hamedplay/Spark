import { useEffect, useState, useRef } from 'react';
import { Loader as Loader2, RefreshCw, Save, CreditCard as Edit2, Plus, Trash2, Eye, X, ChevronDown, Bell, Users } from 'lucide-react';
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

import { NotificationToggle as Toggle } from '../ConfigToggle';
import { TemplateGuide } from './TemplateGuide';
import type { NotificationTemplate } from './types';
import { COLORS, COLOR_BADGE, inp, audienceLabel, eventLabel, AUDIENCE_COLORS, NOTIF_SAMPLE_VALUES } from './constants';

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

export function NotifPreviewModal({ template, onClose }: { template: NotificationTemplate; onClose: () => void }) {
  const [customVars, setCustomVars] = useState<Record<string, string>>({});

  const allKeys = Array.from(new Set([
    ...(template.placeholders || []),
    ...Array.from((template.title + ' ' + template.body).matchAll(/\{\{(\w+)\}\}/g), m => m[1]),
  ]));

  const fillNotifPreview = (text: string, customVars: Record<string, string>): string => {
    const vars = { ...NOTIF_SAMPLE_VALUES, ...customVars };
    return text.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
  };

  const previewTitle = fillNotifPreview(template.title, customVars);
  const previewBody  = fillNotifPreview(template.body, customVars);
  const colorDot = COLORS.find(c => c.key === template.color);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-500" />پیش‌نمایش قالب اعلان
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${COLOR_BADGE[template.color] || COLOR_BADGE['gray']}`}>
              {NOTIF_CATEGORIES.find(c => c.key === template.category)?.label || template.category}
            </span>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
              {eventLabel[template.event_type] || template.event_type}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full ${AUDIENCE_COLORS[template.audience] || AUDIENCE_COLORS.all}`}>
              {audienceLabel[template.audience] || template.audience}
            </span>
          </div>

          {allKeys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">مقادیر نمونه (قابل تغییر):</p>
              <div className="grid grid-cols-1 gap-2 max-h-44 overflow-y-auto">
                {allKeys.map(key => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="text-xs text-amber-600 dark:text-amber-400 font-mono bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded w-36 shrink-0 truncate">{`{{${key}}}`}</code>
                    <input
                      type="text"
                      value={customVars[key] ?? (NOTIF_SAMPLE_VALUES[key] || '')}
                      onChange={e => setCustomVars(v => ({ ...v, [key]: e.target.value }))}
                      className="flex-1 text-xs px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder={`مقدار {{${key}}}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">خروجی اعلان:</p>
            <div className={`rounded-xl border p-4 space-y-1.5 ${COLOR_BADGE[template.color] || ''} bg-opacity-20`}>
              <div className="flex items-start gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${colorDot?.cls || 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white leading-snug">{previewTitle || '—'}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed whitespace-pre-wrap">{previewBody || '—'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [filterAudience, setFilterAudience] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState<NotificationTemplate | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('notification_templates').select('*').order('category').order('event_type').order('audience');
      setTemplates((data || []) as NotificationTemplate[]);
    } catch {
      toast.error('خطا در بارگذاری قالب‌های اعلان');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deleteTemplate = async (id: string) => {
    await supabase.from('notification_templates').delete().eq('id', id);
    setTemplates(ts => ts.filter(t => t.id !== id));
    invalidateTemplateCache();
    toast.success('قالب حذف شد');
  };

  const filtered = templates.filter(t => {
    if (filterCat !== 'all' && t.category !== filterCat) return false;
    if (filterAudience !== 'all' && t.audience !== filterAudience) return false;
    return true;
  });

  const grouped: Record<string, Record<string, NotificationTemplate[]>> = {};
  for (const t of filtered) {
    if (!grouped[t.category]) grouped[t.category] = {};
    if (!grouped[t.category][t.audience]) grouped[t.category][t.audience] = [];
    grouped[t.category][t.audience].push(t);
  }

  const audienceOrder = ['all', 'participants', 'observers', 'external'];

  if (editing) {
    return <TemplateEditor template={editing} onSave={t => { setTemplates(ts => ts.map(x => x.id === t.id ? t : x)); setEditing(null); }} onCancel={() => setEditing(null)} />;
  }
  if (creating) {
    return <NewTemplateForm onSave={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  }

  const selBase = 'appearance-none text-sm pr-3 pl-8 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className={selBase}>
              <option value="all">همه دسته‌ها</option>
              {NOTIF_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select value={filterAudience} onChange={e => setFilterAudience(e.target.value)} className={selBase}>
              <option value="all">همه دریافت‌کنندگان</option>
              {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />افزودن قالب جدید
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {AUDIENCES.map(a => (
          <button key={a.key} onClick={() => setFilterAudience(filterAudience === a.key ? 'all' : a.key)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${filterAudience === a.key || filterAudience === 'all' ? AUDIENCE_COLORS[a.key] + ' border-transparent' : 'border-gray-200 dark:border-gray-600 text-gray-400'}`}>
            <Users className="w-3 h-3" />{a.label}
          </button>
        ))}
      </div>

      <TemplateGuide />

      {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      {!loading && Object.keys(grouped).length === 0 && (
        <div className="py-14 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Bell className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-3">قالبی یافت نشد</p>
          <button onClick={() => setCreating(true)} className="text-sm text-amber-500 hover:text-amber-600 font-medium">افزودن قالب جدید</button>
        </div>
      )}

      <div className="space-y-5">
        {Object.entries(grouped).map(([cat, audienceMap]) => (
          <div key={cat} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${COLOR_BADGE[NOTIF_CATEGORIES.find(c=>c.key===cat)?.key || 'system'] || 'bg-gray-100 text-gray-500'}`}>
                {NOTIF_CATEGORIES.find(c => c.key === cat)?.label || cat}
              </span>
              <span className="text-xs text-gray-400">{Object.values(audienceMap).flat().length} قالب</span>
            </div>

            {audienceOrder.filter(aud => audienceMap[aud]?.length).map(aud => (
              <div key={aud}>
                <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b border-gray-50 dark:border-gray-700/50 ${AUDIENCE_COLORS[aud]}`}>
                  <Users className="w-3 h-3" />
                  {audienceLabel[aud]}
                  <span className="mr-auto text-xs opacity-70">{audienceMap[aud].length} قالب</span>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {audienceMap[aud].map(t => (
                    <div key={t.id} className="p-4 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${COLORS.find(c => c.key === t.color)?.cls || 'bg-gray-400'}`} />
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
                            {eventLabel[t.event_type] || t.event_type}
                          </span>
                          {!t.is_active && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-500 px-2.5 py-1 rounded-full">غیرفعال</span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => setPreviewTemplate(t)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl transition">
                            <Eye className="w-3 h-3" />پیش‌نمایش
                          </button>
                          <button onClick={() => setEditing(t)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-gray-600 hover:text-amber-600 dark:hover:text-amber-400 rounded-xl transition">
                            <Edit2 className="w-3 h-3" />ویرایش
                          </button>
                          <button onClick={() => deleteTemplate(t.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-500 rounded-xl transition">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-2">{t.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{t.body}</p>
                      {t.placeholders?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {t.placeholders.map(ph => (
                            <code key={ph} className="text-xs px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded font-mono">{`{{${ph}}}`}</code>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {previewTemplate && <NotifPreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />}
    </div>
  );
}
