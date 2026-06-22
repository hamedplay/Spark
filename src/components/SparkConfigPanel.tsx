import React, { useState, useEffect, useCallback } from 'react';
import {
  Bot, Save, Plus, X, Calendar, MessageSquare, ClipboardList,
  BookOpen, Users, BarChart2, User, Video, Mic, ChevronDown,
  ChevronUp, AlertCircle, Info, Trash2, Check, RefreshCw,
  Play, CheckCircle2, XCircle, Zap, Settings, Brain, Eye, EyeOff,
  Key,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SparkModuleConfig {
  id: string;
  module: string;
  enabled: boolean;
  trigger_keywords: string[];
  description: string;
  voice_response_template: string;
  updated_at: string;
}

interface FieldKeyword {
  id: string;
  module: string;
  field_key: string;
  field_label: string;
  extract_keywords: string[];
  example: string;
  sort_order: number;
}

interface SparkAiSettings {
  id: string;
  provider: string;
  api_key: string;
  model: string;
  enabled: boolean;
}

// ─── AI Settings Panel ────────────────────────────────────────────────────────
function AiSettingsPanel() {
  const [settings, setSettings] = useState<SparkAiSettings | null>(null);
  const [form, setForm] = useState({ provider: 'groq', api_key: '', model: 'llama-3.3-70b-versatile', enabled: false });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('spark_ai_settings').select('*').maybeSingle().then(({ data }) => {
      if (data) { setSettings(data as SparkAiSettings); setForm({ provider: data.provider, api_key: data.api_key, model: data.model, enabled: data.enabled }); }
      setLoading(false);
    });
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      if (settings?.id) {
        const { error } = await supabase.from('spark_ai_settings').update({ ...form, updated_at: new Date().toISOString() }).eq('id', settings.id);
        if (error) { toast.error('خطا: ' + error.message); return; }
      } else {
        const { error } = await supabase.from('spark_ai_settings').insert([form]);
        if (error) { toast.error('خطا: ' + error.message); return; }
      }
      toast.success('تنظیمات هوش مصنوعی ذخیره شد');
      const { data } = await supabase.from('spark_ai_settings').select('*').maybeSingle();
      if (data) setSettings(data as SparkAiSettings);
    } finally { setSaving(false); }
  };

  const testConnection = async () => {
    if (!form.api_key.trim()) { setTestResult('کلید API وارد نشده'); return; }
    setTesting(true); setTestResult(null);
    try {
      const apiUrl = form.provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${form.api_key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: form.model, messages: [{ role: 'user', content: 'Say "OK" in one word' }], max_tokens: 5 }),
      });
      if (res.ok) setTestResult('اتصال موفق! هوش مصنوعی آماده است.');
      else { const d = await res.json(); setTestResult('خطا: ' + (d.error?.message || res.status)); }
    } catch (e: any) { setTestResult('خطا در اتصال: ' + e.message); }
    finally { setTesting(false); }
  };

  const PROVIDERS = [
    { value: 'groq', label: 'Groq (رایگان و سریع)', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
    { value: 'openai', label: 'OpenAI (GPT)', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'] },
  ];
  const currentProvider = PROVIDERS.find(p => p.value === form.provider);

  const inp = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm';

  if (loading) return <div className="animate-pulse h-32 bg-gray-100 dark:bg-gray-800 rounded-2xl" />;

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-yellow-200 dark:border-yellow-700">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20">
        <div className="w-9 h-9 rounded-xl bg-yellow-100 dark:bg-yellow-900/40 flex items-center justify-center">
          <Brain className="w-5 h-5 text-yellow-600 dark:text-yellow-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-2">
            هوش مصنوعی (AI Mode)
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${form.enabled ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
              {form.enabled ? 'فعال' : 'غیرفعال'}
            </span>
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">پردازش هوشمند دستورات با مدل زبانی</p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
          <div className="relative">
            <input type="checkbox" className="sr-only peer" checked={form.enabled} onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))} />
            <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-emerald-500 rounded-full transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
          </div>
        </label>
      </div>

      <div className="p-4 bg-white dark:bg-gray-800 space-y-4">
        {/* Info */}
        <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Zap className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-yellow-500" />
          <div>
            <p className="font-semibold mb-0.5">چرا AI Mode؟</p>
            <p>با هوش مصنوعی، اسپارک هر جمله فارسی را می‌فهمد — بدون نیاز به کلیدواژه خاص. دستورات پیچیده و طبیعی را اجرا می‌کند و به مرور زمان یاد می‌گیرد.</p>
            <p className="mt-1 font-medium">Groq رایگان است — کلید API از <span className="underline">console.groq.com</span> بگیرید.</p>
          </div>
        </div>

        {/* Provider */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">سرویس‌دهنده</label>
          <select value={form.provider} onChange={e => { setForm(f => ({ ...f, provider: e.target.value, model: PROVIDERS.find(p => p.value === e.target.value)?.models[0] || '' })); setTestResult(null); }}
            className={inp}>
            {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">مدل</label>
          <select value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className={inp}>
            {(currentProvider?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* API Key */}
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5 flex items-center gap-1.5">
            <Key className="w-3 h-3" /> کلید API
          </label>
          <div className="relative">
            <input type={showKey ? 'text' : 'password'} value={form.api_key} onChange={e => { setForm(f => ({ ...f, api_key: e.target.value })); setTestResult(null); }}
              placeholder="کلید API را اینجا وارد کنید..." dir="ltr"
              className={inp + ' pr-10'} />
            <button type="button" onClick={() => setShowKey(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-2.5 rounded-xl text-xs ${testResult.includes('موفق') ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700'}`}>
            {testResult.includes('موفق') ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
            {testResult}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors flex-1 justify-center">
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} ذخیره
          </button>
          <button onClick={testConnection} disabled={testing || !form.api_key.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors flex-1 justify-center">
            {testing ? <Spinner className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} آزمایش اتصال
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Module metadata ──────────────────────────────────────────────────────────
const MODULE_META: Record<string, {
  label: string; icon: React.ElementType; color: string;
  desc: string; defaultPhrases: string[]; sampleCommand: string;
}> = {
  meetings: {
    label: 'درخواست جلسه', icon: Calendar, color: 'blue',
    desc: 'ثبت درخواست جلسه با موضوع، نماینده و شماره تماس',
    defaultPhrases: ['جلسه بزار', 'ثبت درخواست جلسه', 'درخواست جلسه', 'یک جلسه', 'میتینگ'],
    sampleCommand: 'یک جلسه بزار با موضوع بررسی قرارداد نماینده احمدی شماره 09121234567',
  },
  calendar: {
    label: 'تقویم', icon: Calendar, color: 'teal',
    desc: 'تغییر نمای تقویم (روزانه/هفتگی/لیستی) یا مشاهده جلسات امروز',
    defaultPhrases: ['تقویم', 'برو به تقویم', 'جلسات امروز', 'نمای تقویم'],
    sampleCommand: 'برو به تقویم روزانه',
  },
  chat: {
    label: 'پیام‌رسان', icon: MessageSquare, color: 'emerald',
    desc: 'ارسال پیام به کاربران سازمان با اولویت عادی، مهم یا اورژانسی',
    defaultPhrases: ['پیام بده', 'پیام بفرست', 'ارسال پیام', 'یک پیام', 'پیام بنویس'],
    sampleCommand: 'یک پیام بده به زهرا احمدی با موضوع پیگیری قرارداد با اهمیت مهم',
  },
  tasks: {
    label: 'وظایف', icon: ClipboardList, color: 'amber',
    desc: 'ایجاد وظیفه یا اقدام و انتساب آن به کاربر مشخص',
    defaultPhrases: ['اقدام ایجاد کن', 'وظیفه', 'تسک', 'یک اقدام', 'ایجاد اقدام'],
    sampleCommand: 'یک اقدام ایجاد کن با عنوان بررسی گزارش مالی برای علی رضایی',
  },
  notes: {
    label: 'یادداشت‌ها', icon: BookOpen, color: 'orange',
    desc: 'ثبت یادداشت با عنوان و محتوا',
    defaultPhrases: ['یادداشت ثبت کن', 'یادداشت بنویس', 'یادداشت جدید', 'یک یادداشت'],
    sampleCommand: 'یک یادداشت ثبت کن با عنوان بررسی پروژه با متن نکات مهم جلسه',
  },
  contacts: {
    label: 'مخاطبین', icon: Users, color: 'green',
    desc: 'افزودن مخاطب جدید با نام، شماره و شرکت',
    defaultPhrases: ['مخاطب جدید', 'ثبت مخاطب', 'شماره ذخیره کن', 'مخاطب اضافه کن'],
    sampleCommand: 'یک مخاطب جدید ثبت کن به نام حامد خالقی شماره 09123355033 شرکت رایان پارسی',
  },
  reports: {
    label: 'گزارشات', icon: BarChart2, color: 'red',
    desc: 'ناوبری به صفحه گزارشات',
    defaultPhrases: ['گزارش', 'برو به گزارش', 'نمایش گزارش'],
    sampleCommand: 'برو به صفحه گزارشات',
  },
  profile: {
    label: 'پروفایل', icon: User, color: 'gray',
    desc: 'ناوبری به صفحه پروفایل کاربر',
    defaultPhrases: ['پروفایل', 'برو به پروفایل'],
    sampleCommand: 'برو به پروفایل من',
  },
  'video-conference': {
    label: 'ویدیو کنفرانس', icon: Video, color: 'sky',
    desc: 'ناوبری به ویدیو کنفرانس یا برقراری تماس تصویری',
    defaultPhrases: ['ویدیو کنفرانس', 'تماس تصویری', 'ویدیوکال'],
    sampleCommand: 'تماس تصویری با زهرا احمدی',
  },
};

const colorMap: Record<string, {
  bg: string; text: string; border: string; light: string;
  badgeBg: string; btnActive: string;
}> = {
  blue:    { bg: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400',    border: 'border-blue-200 dark:border-blue-700',    light: 'bg-blue-50 dark:bg-blue-900/30',    badgeBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',    btnActive: 'bg-blue-600 hover:bg-blue-700' },
  teal:    { bg: 'bg-teal-500',    text: 'text-teal-600 dark:text-teal-400',    border: 'border-teal-200 dark:border-teal-700',    light: 'bg-teal-50 dark:bg-teal-900/30',    badgeBg: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',    btnActive: 'bg-teal-600 hover:bg-teal-700' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-700', light: 'bg-emerald-50 dark:bg-emerald-900/30', badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', btnActive: 'bg-emerald-600 hover:bg-emerald-700' },
  amber:   { bg: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',   border: 'border-amber-200 dark:border-amber-700',   light: 'bg-amber-50 dark:bg-amber-900/30',   badgeBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',   btnActive: 'bg-amber-600 hover:bg-amber-700' },
  orange:  { bg: 'bg-orange-500',  text: 'text-orange-600 dark:text-orange-400',  border: 'border-orange-200 dark:border-orange-700',  light: 'bg-orange-50 dark:bg-orange-900/30',  badgeBg: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',  btnActive: 'bg-orange-600 hover:bg-orange-700' },
  green:   { bg: 'bg-green-500',   text: 'text-green-600 dark:text-green-400',   border: 'border-green-200 dark:border-green-700',   light: 'bg-green-50 dark:bg-green-900/30',   badgeBg: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',   btnActive: 'bg-green-600 hover:bg-green-700' },
  red:     { bg: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',     border: 'border-red-200 dark:border-red-700',     light: 'bg-red-50 dark:bg-red-900/30',     badgeBg: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',     btnActive: 'bg-red-600 hover:bg-red-700' },
  gray:    { bg: 'bg-gray-500',    text: 'text-gray-600 dark:text-gray-300',    border: 'border-gray-200 dark:border-gray-600',    light: 'bg-gray-50 dark:bg-gray-700/50',    badgeBg: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',    btnActive: 'bg-gray-600 hover:bg-gray-700' },
  sky:     { bg: 'bg-sky-500',     text: 'text-sky-600 dark:text-sky-400',     border: 'border-sky-200 dark:border-sky-700',     light: 'bg-sky-50 dark:bg-sky-900/30',     badgeBg: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',     btnActive: 'bg-sky-600 hover:bg-sky-700' },
};

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

// ─── Live Test Feature ────────────────────────────────────────────────────────
function TestCommandPanel({
  config, meta,
}: { config: SparkModuleConfig; meta: typeof MODULE_META[string] }) {
  const [testText, setTestText] = useState(meta.sampleCommand);
  const [testResult, setTestResult] = useState<{ matched: boolean; score: number; reason: string } | null>(null);

  const runTest = useCallback(() => {
    if (!testText.trim()) return;
    const lo = testText.toLowerCase();
    let score = 0;
    const reasons: string[] = [];

    if (!config.enabled) {
      setTestResult({ matched: false, score: 0, reason: 'این ماژول غیرفعال است.' });
      return;
    }

    const dbKws = config.trigger_keywords || [];
    const hitDbKws: string[] = [];
    for (const kw of dbKws) {
      if (lo.includes(kw.toLowerCase())) { score += 2; hitDbKws.push(kw); }
    }
    const hitBuiltin: string[] = [];
    for (const phrase of meta.defaultPhrases) {
      if (lo.includes(phrase.toLowerCase())) { score += 1; hitBuiltin.push(phrase); }
    }

    if (hitDbKws.length > 0) reasons.push(`کلیدواژه‌های پیکربندی: «${hitDbKws.join('»، «')}»`);
    if (hitBuiltin.length > 0) reasons.push(`عبارات پیش‌فرض: «${hitBuiltin.join('»، «')}»`);

    const matched = score >= 1;
    const reason = reasons.length > 0 ? `تطابق: ${reasons.join(' | ')}` : 'هیچ کلیدواژه‌ای شناسایی نشد.';
    setTestResult({ matched, score, reason });
  }, [testText, config, meta]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
        <Zap className="w-3.5 h-3.5 text-yellow-500" />
        آزمایش کلیدواژه‌ها
      </div>
      <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600 space-y-2">
        <p className="text-[11px] text-gray-500 dark:text-gray-400">یک دستور نمونه وارد کنید تا ببینید آیا این ماژول فعال می‌شود:</p>
        <div className="flex gap-2">
          <input
            type="text"
            value={testText}
            onChange={e => { setTestText(e.target.value); setTestResult(null); }}
            placeholder="مثلاً: یک جلسه بزار با موضوع..."
            className="flex-1 px-3 py-2 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400"
          />
          <button
            onClick={runTest}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 dark:bg-gray-600 hover:bg-gray-700 dark:hover:bg-gray-500 text-white rounded-xl text-xs font-medium transition-colors flex-shrink-0"
          >
            <Play className="w-3 h-3" /> آزمایش
          </button>
        </div>
        {testResult && (
          <div className={`flex items-start gap-2 p-2.5 rounded-xl text-xs ${testResult.matched ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-700'}`}>
            {testResult.matched
              ? <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              : <XCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />}
            <div>
              <p className="font-semibold">{testResult.matched ? `فعال می‌شود (امتیاز: ${testResult.score})` : 'فعال نمی‌شود'}</p>
              <p className="mt-0.5 opacity-80">{testResult.reason}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Field Keywords Editor ────────────────────────────────────────────────────
function FieldKeywordsSection({
  module, fieldKeywords, onRefresh,
}: { module: string; fieldKeywords: FieldKeyword[]; onRefresh: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newKw, setNewKw] = useState('');
  const [editForm, setEditForm] = useState<Partial<FieldKeyword>>({});
  const [newForm, setNewForm] = useState<Partial<FieldKeyword>>({
    module, field_key: '', field_label: '', extract_keywords: [], example: '', sort_order: 0,
  });
  const [newFieldKw, setNewFieldKw] = useState('');

  const myFields = fieldKeywords.filter(f => f.module === module).sort((a, b) => a.sort_order - b.sort_order);

  const startEdit = (f: FieldKeyword) => {
    setEditingId(f.id); setEditForm({ ...f }); setNewKw('');
  };
  const cancelEdit = () => { setEditingId(null); setEditForm({}); setNewKw(''); };

  const saveField = async () => {
    if (!editForm.field_key || !editForm.field_label) { toast.error('کلید فیلد و برچسب الزامی است'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('spark_field_keywords').update({
        field_label: editForm.field_label,
        extract_keywords: editForm.extract_keywords,
        example: editForm.example,
        sort_order: editForm.sort_order,
      }).eq('id', editingId!);
      if (error) { toast.error('خطا: ' + error.message); return; }
      toast.success('ذخیره شد');
      cancelEdit(); onRefresh();
    } finally { setSaving(false); }
  };

  const addNewField = async () => {
    if (!newForm.field_key?.trim() || !newForm.field_label?.trim()) { toast.error('کلید و برچسب الزامی است'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('spark_field_keywords').insert([{
        ...newForm, module, sort_order: myFields.length + 1,
      }]);
      if (error) { toast.error('خطا: ' + error.message); return; }
      toast.success('فیلد افزوده شد');
      setAddingNew(false);
      setNewForm({ module, field_key: '', field_label: '', extract_keywords: [], example: '', sort_order: 0 });
      setNewFieldKw(''); onRefresh();
    } finally { setSaving(false); }
  };

  const deleteField = async (id: string) => {
    if (!confirm('حذف این فیلد؟')) return;
    await supabase.from('spark_field_keywords').delete().eq('id', id);
    toast.success('حذف شد'); onRefresh();
  };

  const addKwToEdit = () => {
    const kw = newKw.trim();
    if (!kw || editForm.extract_keywords?.includes(kw)) { setNewKw(''); return; }
    setEditForm(f => ({ ...f, extract_keywords: [...(f.extract_keywords || []), kw] }));
    setNewKw('');
  };

  const addKwToNew = () => {
    const kw = newFieldKw.trim();
    if (!kw || newForm.extract_keywords?.includes(kw)) { setNewFieldKw(''); return; }
    setNewForm(f => ({ ...f, extract_keywords: [...(f.extract_keywords || []), kw] }));
    setNewFieldKw('');
  };

  const inp = 'w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300">
          <Info className="w-3.5 h-3.5" />
          نگاشت کلیدواژه به فیلدها
        </div>
        <button onClick={() => { setAddingNew(true); setEditingId(null); }}
          className="flex items-center gap-1 px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-medium transition-colors">
          <Plus className="w-3 h-3" /> فیلد جدید
        </button>
      </div>

      <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
        وقتی اسپارک دستور شما را می‌شنود، کلیدواژه‌های فیلد را پیدا می‌کند و متن بعد از آن‌ها را در فرم قرار می‌دهد.
        <br />
        <strong>مثال:</strong> «موضوع» → هر چیزی بعد از کلمه «موضوع» در فیلد موضوع قرار می‌گیرد.
      </div>

      {addingNew && (
        <div className="p-4 rounded-2xl border-2 border-blue-200 dark:border-blue-700 bg-blue-50/50 dark:bg-blue-900/10 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">افزودن فیلد جدید</p>
            <button onClick={() => setAddingNew(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">کلید فیلد (انگلیسی)*</label>
              <input className={inp} placeholder="مثال: subject" dir="ltr"
                value={newForm.field_key || ''} onChange={e => setNewForm(f => ({ ...f, field_key: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">برچسب فارسی*</label>
              <input className={inp} placeholder="مثال: موضوع جلسه"
                value={newForm.field_label || ''} onChange={e => setNewForm(f => ({ ...f, field_label: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">کلیدواژه‌های تشخیص</label>
              <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                {(newForm.extract_keywords || []).map(kw => (
                  <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs border border-blue-200 dark:border-blue-700">
                    {kw}
                    <button onClick={() => setNewForm(f => ({ ...f, extract_keywords: (f.extract_keywords || []).filter(k => k !== kw) }))}><X className="w-3 h-3" /></button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input className={inp} placeholder="کلیدواژه جدید..." value={newFieldKw}
                  onChange={e => setNewFieldKw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKwToNew())} />
                <button onClick={addKwToNew} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm"><Plus className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-gray-500 mb-1">مثال دستور</label>
              <input className={inp} placeholder="مثال: موضوع: بررسی گزارش مالی"
                value={newForm.example || ''} onChange={e => setNewForm(f => ({ ...f, example: e.target.value }))} />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={addNewField} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} افزودن
            </button>
            <button onClick={() => setAddingNew(false)} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm">انصراف</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {myFields.map(f => (
          <div key={f.id} className="rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            {editingId === f.id ? (
              <div className="p-4 space-y-3 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">ویرایش: {f.field_label}</p>
                  <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">برچسب فارسی</label>
                  <input className={inp} value={editForm.field_label || ''} onChange={e => setEditForm(ef => ({ ...ef, field_label: e.target.value }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">کلیدواژه‌های تشخیص</label>
                  <div className="flex flex-wrap gap-1.5 mb-2 min-h-[28px]">
                    {(editForm.extract_keywords || []).map(kw => (
                      <span key={kw} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs border border-blue-200 dark:border-blue-700">
                        {kw}
                        <button onClick={() => setEditForm(ef => ({ ...ef, extract_keywords: (ef.extract_keywords || []).filter(k => k !== kw) }))}><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input className={inp} placeholder="کلیدواژه جدید..." value={newKw}
                      onChange={e => setNewKw(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKwToEdit())} />
                    <button onClick={addKwToEdit} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">مثال دستور</label>
                  <input className={inp} placeholder="مثال..." value={editForm.example || ''}
                    onChange={e => setEditForm(ef => ({ ...ef, example: e.target.value }))} />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveField} disabled={saving}
                    className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
                    {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} ذخیره
                  </button>
                  <button onClick={cancelEdit} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm">انصراف</button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 p-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="text-sm font-semibold text-gray-800 dark:text-white">{f.field_label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 font-mono">{f.field_key}</span>
                  </div>
                  {f.extract_keywords.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1.5">
                      {f.extract_keywords.map(kw => (
                        <span key={kw} className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[11px] border border-blue-100 dark:border-blue-800">
                          {kw}
                        </span>
                      ))}
                    </div>
                  )}
                  {f.example && (
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                      <Mic className="w-3 h-3 text-blue-400 flex-shrink-0" />
                      «{f.example}»
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => startEdit(f)}
                    className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30 rounded-lg transition-colors" title="ویرایش">
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => deleteField(f.id)}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors" title="حذف">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {myFields.length === 0 && !addingNew && (
          <div className="py-5 text-center text-gray-400 text-xs">
            هیچ فیلدی تعریف نشده. روی «فیلد جدید» کلیک کنید.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Module Card ──────────────────────────────────────────────────────────────
function ModuleCard({
  config, fieldKeywords, onSave, onRefreshFields,
}: { config: SparkModuleConfig; fieldKeywords: FieldKeyword[]; onSave: (u: SparkModuleConfig) => Promise<void>; onRefreshFields: () => void }) {
  const [form, setForm] = useState<SparkModuleConfig>({ ...config });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'trigger' | 'fields' | 'test'>('trigger');
  const [expanded, setExpanded] = useState(false);
  const [newKw, setNewKw] = useState('');

  const meta = MODULE_META[config.module] || { label: config.module, icon: Bot, color: 'gray', desc: '', defaultPhrases: [], sampleCommand: '' };
  const Icon = meta.icon;
  const c = colorMap[meta.color] || colorMap.gray;

  useEffect(() => {
    setDirty(JSON.stringify(form) !== JSON.stringify(config));
  }, [form, config]);

  useEffect(() => {
    // Sync form when config prop changes (after external save)
    setForm({ ...config });
  }, [config]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); setDirty(false); } finally { setSaving(false); }
  };

  const addKw = () => {
    const kw = newKw.trim();
    if (!kw || form.trigger_keywords.includes(kw)) { setNewKw(''); return; }
    setForm(f => ({ ...f, trigger_keywords: [...f.trigger_keywords, kw] }));
    setNewKw('');
  };

  const removeKw = (kw: string) => setForm(f => ({ ...f, trigger_keywords: f.trigger_keywords.filter(k => k !== kw) }));

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'trigger', label: 'کلیدواژه‌ها' },
    { key: 'test', label: 'آزمایش' },
    { key: 'fields', label: 'فیلدها' },
  ];

  return (
    <div className={`rounded-2xl border-2 transition-all overflow-hidden ${form.enabled ? c.border : 'border-gray-200 dark:border-gray-700 opacity-60'}`}>
      {/* Header */}
      <div className={`flex items-center gap-3 px-4 py-3 cursor-pointer ${form.enabled ? c.light : 'bg-gray-50 dark:bg-gray-800'}`}
        onClick={() => setExpanded(v => !v)}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${c.text} bg-white dark:bg-gray-800 shadow-sm`}>
          <Icon className="w-[18px] h-[18px]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-sm text-gray-800 dark:text-white">{meta.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-white/60 dark:bg-gray-700/60 rounded text-gray-500 font-mono">{config.module}</span>
            {form.trigger_keywords.length > 0 && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${c.badgeBg}`}>
                {form.trigger_keywords.length} کلیدواژه
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{meta.desc}</p>
        </div>
        {/* Enable toggle — stop propagation so click doesn't toggle expand */}
        <label className="flex items-center gap-2 cursor-pointer flex-shrink-0" onClick={e => e.stopPropagation()}>
          <span className={`text-xs font-medium ${form.enabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`}>
            {form.enabled ? 'فعال' : 'غیرفعال'}
          </span>
          <div className="relative">
            <input type="checkbox" className="sr-only peer" checked={form.enabled}
              onChange={e => {
                setForm(f => ({ ...f, enabled: e.target.checked }));
              }} />
            <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-emerald-500 rounded-full transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
          </div>
        </label>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
      </div>

      {/* Save bar for enable/disable change (outside expanded) */}
      {dirty && !expanded && (
        <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border-t border-amber-100 dark:border-amber-800 flex items-center justify-between">
          <span className="text-xs text-amber-700 dark:text-amber-300">تغییرات ذخیره نشده</span>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-medium transition-colors">
            {saving ? <Spinner className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} ذخیره
          </button>
        </div>
      )}

      {/* Expanded */}
      {expanded && (
        <div className="bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700">
          {/* Sub-tabs */}
          <div className="flex border-b border-gray-100 dark:border-gray-700">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${tab === t.key ? `${c.text} border-b-2 ${c.border}` : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-200'}`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="p-4 space-y-4">
            {tab === 'trigger' && (
              <>
                {/* Description */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">توضیح قابلیت</label>
                  <textarea rows={2}
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm resize-none"
                    value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                </div>

                {/* Trigger keywords */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                      کلیدواژه‌های فراخوان
                    </label>
                    {meta.defaultPhrases.length > 0 && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500">
                        پیش‌فرض: {meta.defaultPhrases.slice(0, 3).join(' | ')}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                    هنگامی که اسپارک این کلمات را در دستور ببیند، این ماژول فعال می‌شود.
                    کلیدواژه‌های شما اولویت بالاتری دارند (امتیاز ۲ در برابر ۱ برای پیش‌فرض‌ها).
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-2 min-h-[36px] p-2 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-100 dark:border-gray-600">
                    {form.trigger_keywords.length === 0 && (
                      <span className="text-xs text-gray-400">هنوز کلیدواژه‌ای افزوده نشده (از عبارات پیش‌فرض استفاده می‌شود)</span>
                    )}
                    {form.trigger_keywords.map(kw => (
                      <span key={kw} className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-xs border border-gray-200 dark:border-gray-600 shadow-sm">
                        {kw}
                        <button onClick={() => removeKw(kw)} className="text-gray-300 hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                      placeholder="کلیدواژه جدید را وارد کنید..."
                      value={newKw} onChange={e => setNewKw(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addKw())}
                    />
                    <button onClick={addKw} className="px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Voice template */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                    قالب پاسخ صوتی
                    <span className="text-gray-400 font-normal mr-1">({'{subject}'}, {'{date}'}, {'{target}'}, ...)</span>
                  </label>
                  <input
                    className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 text-sm"
                    value={form.voice_response_template} onChange={e => setForm(f => ({ ...f, voice_response_template: e.target.value }))}
                    placeholder="مثال: جلسه {subject} در تاریخ {date} ثبت شد." />
                </div>

                {dirty && (
                  <button onClick={handleSave} disabled={saving}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
                    {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    ذخیره تنظیمات
                  </button>
                )}
              </>
            )}

            {tab === 'test' && (
              <TestCommandPanel config={form} meta={meta} />
            )}

            {tab === 'fields' && (
              <FieldKeywordsSection module={config.module} fieldKeywords={fieldKeywords} onRefresh={onRefreshFields} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Spark Visibility Toggle ──────────────────────────────────────────────────
function SparkVisibilityToggle() {
  const [visible, setVisible] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('system_config')
      .select('value')
      .eq('section', 'spark')
      .eq('key', 'spark_visible')
      .maybeSingle()
      .then(({ data }) => {
        setVisible(data ? data.value !== 'false' : true);
      });
  }, []);

  const toggle = async () => {
    if (visible === null) return;
    const newVal = !visible;
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('system_config')
        .select('id')
        .eq('section', 'spark')
        .eq('key', 'spark_visible')
        .maybeSingle();

      if (existing?.id) {
        await supabase
          .from('system_config')
          .update({ value: newVal ? 'true' : 'false' })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('system_config')
          .insert([{ section: 'spark', key: 'spark_visible', value: newVal ? 'true' : 'false' }]);
      }
      setVisible(newVal);
      window.dispatchEvent(new CustomEvent('spark-visible-changed', { detail: { visible: newVal } }));
      toast.success(newVal ? 'دستیار اسپارک نمایش داده می‌شود' : 'دستیار اسپارک پنهان شد');
      logAudit({ module: 'spark', action: newVal ? 'spark_enabled' : 'spark_disabled', entity_name: 'spark_visible', details: `نمایش دستیار اسپارک ${newVal ? 'فعال' : 'غیرفعال'} شد`, severity: 'warning' });
    } catch {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl overflow-hidden border-2 border-blue-200 dark:border-blue-700">
      <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20">
        <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
          <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm text-gray-800 dark:text-white flex items-center gap-2">
            نمایش دستیار اسپارک
            {visible !== null && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${visible ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                {visible ? 'فعال' : 'غیرفعال'}
              </span>
            )}
          </p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
            {visible ? 'دکمه اسپارک روی تمام صفحات نمایش داده می‌شود' : 'دکمه اسپارک از تمام صفحات پنهان است'}
          </p>
        </div>
        <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
          <div className="relative">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={visible === true}
              onChange={toggle}
              disabled={saving || visible === null}
            />
            <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-emerald-500 rounded-full transition-colors" />
            <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
          </div>
        </label>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
export function SparkConfigPanel() {
  const [configs, setConfigs] = useState<SparkModuleConfig[]>([]);
  const [fieldKeywords, setFieldKeywords] = useState<FieldKeyword[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: cfg }, { data: fk }] = await Promise.all([
        supabase.from('spark_config').select('*').order('module'),
        supabase.from('spark_field_keywords').select('*').order('module').order('sort_order'),
      ]);
      setConfigs((cfg || []) as SparkModuleConfig[]);
      setFieldKeywords((fk || []) as FieldKeyword[]);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const saveModule = async (updated: SparkModuleConfig) => {
    const { error } = await supabase.from('spark_config').update({
      enabled: updated.enabled,
      trigger_keywords: updated.trigger_keywords,
      description: updated.description,
      voice_response_template: updated.voice_response_template,
      updated_at: new Date().toISOString(),
    }).eq('id', updated.id);
    if (error) { toast.error('خطا: ' + error.message); return; }
    toast.success('تنظیمات ذخیره شد — اسپارک از دستور بعدی از تنظیمات جدید استفاده می‌کند');
    fetchAll();
  };

  const refreshFields = useCallback(() => {
    supabase.from('spark_field_keywords').select('*').order('module').order('sort_order').then(({ data }) => {
      setFieldKeywords((data || []) as FieldKeyword[]);
    });
  }, []);

  const enabledCount = configs.filter(c => c.enabled).length;
  const totalKws = configs.reduce((s, c) => s + c.trigger_keywords.length, 0);
  const totalFields = fieldKeywords.length;

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Spinner className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(135deg, #0ea5e9, #2563eb)' }}>
        <div className="px-5 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center">
              <Bot className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-white text-lg">پیکربندی دستیار اسپارک</h3>
              <p className="text-blue-100 text-xs">مدیریت ماژول‌ها، کلیدواژه‌ها و نگاشت فیلدها</p>
            </div>
            <button onClick={fetchAll} className="mr-auto w-8 h-8 rounded-xl bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors" title="بارگذاری مجدد">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'ماژول فعال', value: `${enabledCount}/${configs.length}` },
              { label: 'کلیدواژه شما', value: totalKws },
              { label: 'نگاشت فیلد', value: totalFields },
            ].map(s => (
              <div key={s.label} className="bg-white/15 backdrop-blur-sm rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-blue-100 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Spark visibility toggle */}
      <SparkVisibilityToggle />

      {/* AI Settings */}
      <AiSettingsPanel />

      {/* How it works */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
        <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed space-y-1">
          <p className="font-semibold">نحوه تاثیر تنظیمات بر رفتار اسپارک</p>
          <p><strong>غیرفعال کردن ماژول:</strong> اسپارک به هیچ دستوری در آن ماژول پاسخ نمی‌دهد، حتی اگر کلیدواژه مطابقت داشته باشد.</p>
          <p><strong>کلیدواژه فراخوان:</strong> کلیدواژه‌های شما امتیاز ۲ دارند در برابر امتیاز ۱ عبارات پیش‌فرض — دستوراتی که با کلیدواژه‌های شما مطابقت دارند قوی‌تر تشخیص داده می‌شوند.</p>
          <p><strong>نگاشت فیلد:</strong> اسپارک برای استخراج اطلاعات از دستور از این نگاشت‌ها استفاده می‌کند و فرم را پر می‌کند.</p>
          <p><strong>تغییرات فوری:</strong> بعد از ذخیره، دستور بعدی که به اسپارک می‌دهید از تنظیمات جدید استفاده می‌کند.</p>
        </div>
      </div>

      {/* Module cards */}
      <div className="space-y-3">
        {configs.map(c => (
          <ModuleCard
            key={c.id}
            config={c}
            fieldKeywords={fieldKeywords}
            onSave={saveModule}
            onRefreshFields={refreshFields}
          />
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <span>{totalFields} نگاشت فیلد | {totalKws} کلیدواژه سفارشی</span>
        <button onClick={fetchAll} className="flex items-center gap-1 hover:text-blue-500 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> بارگذاری مجدد
        </button>
      </div>
    </div>
  );
}
