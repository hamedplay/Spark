import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Trash2, Save, Loader as Loader2, X, Eye, ChevronDown, RefreshCw, FileText, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import {
  TEMPLATE_CATEGORIES as SMS_CATEGORIES,
  TEMPLATE_EVENT_TYPES as EVENT_TYPES,
  TEMPLATE_AUDIENCES as AUDIENCES,
  TEMPLATE_PLACEHOLDERS as ALL_PLACEHOLDERS,
  extractPlaceholders,
  findUnknownPlaceholders,
  TEMPLATE_EVENTS,
  validateTemplateForEvent,
} from '../../config/templateCatalog';
import type { SmsTemplate } from './types';
import { CATEGORY_COLORS, inp, SAMPLE_VALUES } from './types';
import { SmsToggle as Toggle } from '../ConfigToggle';

function fillPreview(body: string, customVars: Record<string, string>): string {
  const vars = { ...SAMPLE_VALUES, ...customVars };
  return body.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = vars[key];
    return val !== undefined ? val : `{{${key}}}`;
  });
}

function TemplateGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-blue-100/50 dark:hover:bg-blue-900/30 transition-colors">
        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
          <Info className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">راهنمای استفاده از قالب‌های پیامک</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-blue-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-blue-200 dark:border-blue-700 pt-4">
          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
            در متن پیامک می‌توانید از متغیرهای زیر استفاده کنید. هنگام ارسال، سیستم این متغیرها را با مقدار واقعی جایگزین می‌کند.
            برای درج متغیر، نام آن را داخل دو آکولاد بنویسید: <code className="font-mono bg-blue-100 dark:bg-blue-900/50 px-1 py-0.5 rounded text-blue-800 dark:text-blue-200">{'{{نام_متغیر}}'}</code>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ALL_PLACEHOLDERS.map(p => (
              <div key={p.key} className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl px-3 py-2">
                <code className="text-xs font-mono text-green-600 dark:text-green-400 flex-shrink-0">{`{{${p.key}}}`}</code>
                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">←</span>
                <span className="text-xs text-gray-700 dark:text-gray-300">{p.label}</span>
                <span className="text-xs text-gray-400 mr-auto truncate hidden sm:block">مثال: {p.example}</span>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-blue-100 dark:border-blue-800">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">نمونه متن پیام:</p>
            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 leading-relaxed dir-ltr text-right">
              {'کاربر گرامی {{full_name}}، جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} در {{location}} برگزار می‌شود.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function NewTemplateForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    category: 'meeting',
    event_type: '',
    audience: 'all',
    subject: '',
    body: '',
    placeholders: [] as string[],
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [phInput, setPhInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertPlaceholder = (ph: string) => {
    const token = `{{${ph}}}`;
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? form.body.length;
    const end = ta?.selectionEnd ?? form.body.length;
    const newBody = form.body.slice(0, start) + token + form.body.slice(end);
    setForm(f => ({ ...f, body: newBody, placeholders: extractPlaceholders(newBody) }));
    requestAnimationFrame(() => {
      if (!ta) return;
      const cursor = start + token.length;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const body = e.target.value;
    setForm(f => ({ ...f, body, placeholders: extractPlaceholders(body) }));
  };

  const addCustomPh = () => {
    const ph = phInput.trim().replace(/\s+/g, '_');
    if (!ph) return;
    if (!form.placeholders.includes(ph)) setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
    setPhInput('');
  };

  const removePh = (ph: string) => setForm(f => ({ ...f, placeholders: f.placeholders.filter(p => p !== ph) }));

  const handleSave = async () => {
    if (!form.event_type.trim()) { toast.error('نوع رویداد الزامی است'); return; }
    if (!form.body.trim()) { toast.error('متن پیام نمی‌تواند خالی باشد'); return; }
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
    const { error } = await supabase.from('sms_templates').insert([{
      category: form.category,
      event_type: form.event_type,
      audience: form.audience,
      subject: form.subject,
      body: form.body,
      placeholders: extracted.length > 0 ? extracted : form.placeholders,
      is_active: form.is_active,
    }]);
    if (error) {
      if (error.code === '23505') toast.error('قالبی با این ترکیب دسته / رویداد / مخاطب از قبل وجود دارد');
      else toast.error('خطا در ذخیره قالب');
      setSaving(false);
      return;
    }
    toast.success('قالب پیام جدید اضافه شد');
    setSaving(false);
    onSave();
  };

  const selClass = 'appearance-none ' + inp + ' pl-8';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-green-300 dark:border-green-600 p-6 space-y-5" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Plus className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">ایجاد قالب پیام جدید</h4>
          <p className="text-xs text-gray-400">فیلدهای ستاره‌دار الزامی هستند</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">دسته *</label>
          <div className="relative">
            <select className={selClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {SMS_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
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
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">موضوع / عنوان</label>
        <input className={inp} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="عنوان پیام (اختیاری)" />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">درج متغیر در متن (کلیک کنید):</p>
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
          {ALL_PLACEHOLDERS.map(p => (
            <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)}
              title={`${p.label} — مثال: ${p.example}`}
              className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/30 hover:border-green-300 transition-colors font-mono">
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">متن پیام *</label>
          <span className={`text-xs ${form.body.length > 160 ? 'text-amber-500' : 'text-gray-400'}`}>{form.body.length} کاراکتر{form.body.length > 160 ? ' (بیش از ۱ SMS)' : ''}</span>
        </div>
        <textarea
          ref={textareaRef}
          rows={5}
          className={inp + ' resize-none'}
          value={form.body}
          onChange={handleBodyChange}
          placeholder="متن پیامک را اینجا بنویسید. برای درج متغیر روی دکمه‌های بالا کلیک کنید..."
        />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">افزودن متغیر سفارشی:</p>
        <div className="flex gap-2">
          <input className={inp + ' flex-1'} value={phInput} onChange={e => setPhInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomPh(); } }}
            placeholder="نام_متغیر (بدون فاصله)" dir="ltr" />
          <button type="button" onClick={addCustomPh}
            className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition flex-shrink-0">
            افزودن
          </button>
        </div>
        {form.placeholders.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {form.placeholders.map(ph => (
              <span key={ph} className="flex items-center gap-1 text-xs px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-lg font-mono">
                {`{{${ph}}}`}
                <button onClick={() => removePh(ph)} className="text-green-500 hover:text-red-500 transition-colors">
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
          className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm">
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

function TemplateEditor({ template, onSave, onCancel }: {
  template: SmsTemplate; onSave: (t: SmsTemplate) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...template });
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = async () => {
    if (!form.body.trim()) { toast.error('متن پیام نمی‌تواند خالی باشد'); return; }
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
    const { error } = await supabase.from('sms_templates')
      .update({
        subject: form.subject,
        body: form.body,
        placeholders: extracted.length > 0 ? extracted : form.placeholders,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', form.id);
    if (error) { toast.error('خطا در ذخیره قالب'); setSaving(false); return; }
    toast.success('قالب پیام ذخیره شد');
    setSaving(false);
    onSave({ ...form });
  };

  const insertPlaceholder = (ph: string) => {
    const token = `{{${ph}}}`;
    const ta = textareaRef.current;
    const start = ta?.selectionStart ?? form.body.length;
    const end = ta?.selectionEnd ?? form.body.length;
    const newBody = form.body.slice(0, start) + token + form.body.slice(end);
    setForm(f => ({ ...f, body: newBody, placeholders: extractPlaceholders(newBody) }));
    requestAnimationFrame(() => {
      if (!ta) return;
      const cursor = start + token.length;
      ta.focus();
      ta.setSelectionRange(cursor, cursor);
    });
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const body = e.target.value;
    setForm(f => ({ ...f, body, placeholders: extractPlaceholders(body) }));
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-green-200 dark:border-green-700 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <FileText className="w-5 h-5 text-green-500" />
        <h4 className="font-semibold text-gray-800 dark:text-white text-sm">ویرایش قالب پیام</h4>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">موضوع / عنوان</label>
        <input className={inp} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="عنوان پیام" />
      </div>

      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">درج متغیر در متن:</p>
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
          {ALL_PLACEHOLDERS.map(p => (
            <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)}
              title={`${p.label} — مثال: ${p.example}`}
              className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-green-700 dark:text-green-400 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/30 hover:border-green-300 transition-colors font-mono">
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">متن پیام</label>
          <span className={`text-xs ${form.body.length > 160 ? 'text-amber-500' : 'text-gray-400'}`}>{form.body.length} کاراکتر{form.body.length > 160 ? ' (بیش از ۱ SMS)' : ''}</span>
        </div>
        <textarea ref={textareaRef} rows={4} className={inp + ' resize-none'} value={form.body} onChange={handleBodyChange} placeholder="متن پیام را وارد کنید..." />
      </div>

      <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-2.5">
        <span className="text-sm text-gray-600 dark:text-gray-300">قالب فعال باشد</span>
        <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
      </div>

      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'ذخیره...' : 'ذخیره قالب'}
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
      </div>
    </div>
  );
}

function TemplatePreviewModal({ template, onClose }: { template: SmsTemplate; onClose: () => void }) {
  const [customVars, setCustomVars] = useState<Record<string, string>>({});
  const usedKeys = Array.from(new Set([...(template.placeholders || []), ...Array.from(template.body.matchAll(/\{\{(\w+)\}\}/g), m => m[1])]));
  const preview = fillPreview(template.body, customVars);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-green-500" />
            پیش‌نمایش قالب پیامک
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${CATEGORY_COLORS[template.category] || 'bg-gray-100 text-gray-500'}`}>
              {SMS_CATEGORIES.find(c => c.key === template.category)?.label || template.category}
            </span>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
              {template.event_type}
            </span>
            <span className="text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 px-2.5 py-1 rounded-full">
              {template.audience}
            </span>
          </div>

          {usedKeys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">مقادیر نمونه (قابل تغییر):</p>
              <div className="grid grid-cols-1 gap-2 max-h-44 overflow-y-auto">
                {usedKeys.map(key => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="text-xs text-green-600 dark:text-green-400 font-mono bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded w-36 shrink-0 truncate">{`{{${key}}}`}</code>
                    <input
                      type="text"
                      value={customVars[key] ?? (SAMPLE_VALUES[key] || '')}
                      onChange={e => setCustomVars(v => ({ ...v, [key]: e.target.value }))}
                      className="flex-1 text-xs px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
                      placeholder={`مقدار {{${key}}}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">خروجی پیامک:</p>
            <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-4 text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap min-h-[80px]">
              {preview}
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{preview.length} کاراکتر</span>
            <span>{Math.ceil(preview.length / 70)} پیامک (۷۰ کاراکتر فارسی)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function TemplatesTab() {
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<SmsTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState<SmsTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('sms_templates').select('*').order('category').order('event_type');
    setTemplates((data || []) as SmsTemplate[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteTemplate = async (id: string) => {
    await supabase.from('sms_templates').delete().eq('id', id);
    setTemplates(ts => ts.filter(t => t.id !== id));
    toast.success('قالب حذف شد');
  };

  const filtered = filterCat === 'all' ? templates : templates.filter(t => t.category === filterCat);

  const audienceLabel: Record<string, string> = {
    participants: 'شرکت‌کنندگان', observers: 'مطلعین', external: 'خارج سازمان', all: 'همه',
  };

  const eventLabel: Record<string, string> = {
    invite: 'دعوت', change: 'تغییر', cancel: 'لغو', reminder: 'یادآور',
    assign: 'تخصیص', complete: 'تکمیل', event_invite: 'دعوت رویداد', mention: 'منشن', custom: 'سفارشی',
  };

  if (editing) {
    return <TemplateEditor template={editing} onSave={t => { setTemplates(ts => ts.map(x => x.id === t.id ? t : x)); setEditing(null); }} onCancel={() => setEditing(null)} />;
  }

  if (creating) {
    return <NewTemplateForm onSave={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  }

  return (
    <div className="space-y-4">
      {previewTemplate && <TemplatePreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="relative">
          <select value={filterCat} onChange={e => setFilterCat(e.target.value)}
            className="appearance-none text-sm pr-3 pl-8 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500">
            <option value="all">همه دسته‌ها</option>
            {SMS_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />افزودن قالب جدید
          </button>
        </div>
      </div>

      <TemplateGuide />

      {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      <div className="space-y-2">
        {filtered.map(t => (
          <div key={t.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:border-gray-200 dark:hover:border-gray-600 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${CATEGORY_COLORS[t.category] || 'bg-gray-100 text-gray-500'}`}>
                  {SMS_CATEGORIES.find(c => c.key === t.category)?.label || t.category}
                </span>
                <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
                  {eventLabel[t.event_type] || t.event_type}
                </span>
                <span className="text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 px-2.5 py-1 rounded-full">
                  {audienceLabel[t.audience] || t.audience}
                </span>
                {!t.is_active && (
                  <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-500 px-2.5 py-1 rounded-full">غیرفعال</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => setPreviewTemplate(t)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-green-50 dark:hover:bg-green-900/20 text-gray-600 dark:text-gray-300 hover:text-green-600 dark:hover:text-green-400 rounded-xl transition">
                  <Eye className="w-3 h-3" />پیش‌نمایش
                </button>
                <button onClick={() => setEditing(t)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-600 dark:text-gray-300 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl transition">
                  <FileText className="w-3 h-3" />ویرایش
                </button>
                <button onClick={() => deleteTemplate(t.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-600 dark:text-gray-300 hover:text-red-500 rounded-xl transition">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            {t.subject && <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-2">{t.subject}</p>}
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2 leading-relaxed">{t.body}</p>
            {t.placeholders?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {t.placeholders.map(ph => (
                  <code key={ph} className="text-xs px-1.5 py-0.5 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded font-mono">{`{{${ph}}}`}</code>
                ))}
              </div>
            )}
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="py-14 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
            <FileText className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm mb-3">قالبی در این دسته یافت نشد</p>
            <button onClick={() => setCreating(true)} className="text-sm text-green-500 hover:text-green-600 font-medium">افزودن قالب جدید</button>
          </div>
        )}
      </div>
    </div>
  );
}
