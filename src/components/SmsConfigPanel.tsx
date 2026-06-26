import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Plus, Trash2, Save, Loader2, X, Check, RefreshCw, Eye, EyeOff, Globe, Phone, User, Lock, Tag, ChevronDown, Info, CreditCard as Edit2, MoreVertical, Zap, Group as GroupIcon, Shield, ToggleLeft, FileText, AlertCircle, Wifi, WifiOff, Send, FlaskConical, BarChart2, CheckCircle, XCircle, MinusCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface SmsProvider {
  id: string;
  title: string;
  provider_name: string;
  provider_type: string; // 'rest' | 'rahyab'
  is_public_gateway: boolean;
  api_url: string;
  api_key: string;
  line_number: string;
  sender_number: string;
  is_active: boolean;
  username: string;
  password: string;
  token: string;
  is_default: boolean;
  created_at: string;
}

interface UserGroup { id: string; name: string; display_name: string | null; }

interface SmsGroupRule {
  id?: string;
  group_id: string;
  sms_category: string;
  enabled: boolean;
  provider_id: string | null;
}

interface SmsTemplate {
  id: string;
  category: string;
  event_type: string;
  audience: string;
  subject: string;
  body: string;
  placeholders: string[];
  is_active: boolean;
}

// ─── Catalogs ─────────────────────────────────────────────────────────────────
const SMS_CATEGORIES = [
  { key: 'meeting',  label: 'جلسات' },
  { key: 'task',     label: 'اقدامات' },
  { key: 'calendar', label: 'تقویم' },
  { key: 'chat',     label: 'چت سازمانی' },
  { key: 'channel',  label: 'کانال‌ها' },
  { key: 'system',   label: 'سیستم' },
];

const TEMPLATE_CATALOG: { category: string; event_type: string; event_label: string; audience: string; audience_label: string }[] = [
  { category: 'meeting', event_type: 'invite',       event_label: 'دعوت',           audience: 'participants', audience_label: 'شرکت‌کنندگان' },
  { category: 'meeting', event_type: 'invite',       event_label: 'دعوت',           audience: 'observers',    audience_label: 'مطلعین' },
  { category: 'meeting', event_type: 'invite',       event_label: 'دعوت',           audience: 'external',     audience_label: 'افراد خارج سازمان' },
  { category: 'meeting', event_type: 'change',       event_label: 'تغییر',          audience: 'participants', audience_label: 'شرکت‌کنندگان' },
  { category: 'meeting', event_type: 'change',       event_label: 'تغییر',          audience: 'observers',    audience_label: 'مطلعین' },
  { category: 'meeting', event_type: 'cancel',       event_label: 'لغو',            audience: 'participants', audience_label: 'شرکت‌کنندگان' },
  { category: 'meeting', event_type: 'cancel',       event_label: 'لغو',            audience: 'observers',    audience_label: 'مطلعین' },
  { category: 'meeting', event_type: 'reminder',     event_label: 'یادآور',         audience: 'participants', audience_label: 'شرکت‌کنندگان' },
  { category: 'task',    event_type: 'assign',       event_label: 'تخصیص',          audience: 'all',          audience_label: 'همه' },
  { category: 'task',    event_type: 'reminder',     event_label: 'یادآور',         audience: 'all',          audience_label: 'همه' },
  { category: 'calendar',event_type: 'event_invite', event_label: 'دعوت رویداد',    audience: 'all',          audience_label: 'همه' },
  { category: 'chat',    event_type: 'mention',      event_label: 'منشن',           audience: 'all',          audience_label: 'همه' },
];

const CATEGORY_COLORS: Record<string, string> = {
  meeting: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  task:    'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  calendar:'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  chat:    'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
  channel: 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
  system:  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition text-sm [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-700 dark:[&>option]:text-white';

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ value, onChange, color = 'bg-green-500' }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${value ? color : 'bg-gray-200 dark:bg-gray-600'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ─── TAB BAR ──────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'providers',  label: 'سرویس‌دهندگان',    icon: Globe },
  { key: 'groups',     label: 'گروه‌بندی پیامک',  icon: GroupIcon },
  { key: 'templates',  label: 'قالب پیام‌ها',     icon: FileText },
  { key: 'test',       label: 'تست سامانه',        icon: FlaskConical },
  { key: 'reports',    label: 'گزارش ارسال',       icon: BarChart2 },
];

// ─── Provider type catalog ────────────────────────────────────────────────────
const PROVIDER_TYPES = [
  { key: 'rest',   label: 'sms.ir / REST API',           desc: 'سرویس‌دهندگان استاندارد مانند sms.ir' },
  { key: 'rahyab', label: 'وب‌سرویس رهیاب رایان (SOAP)', desc: 'ارتباط از طریق پروتکل SOAP' },
];

// ════════════════════════════════════════════════════════════════════
//  TAB 1 — Providers
// ════════════════════════════════════════════════════════════════════
function ProviderForm({ provider, onSave, onCancel }: {
  provider: Partial<SmsProvider> | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const blankRest: Partial<SmsProvider> = {
    title: '', provider_name: 'sms.ir', provider_type: 'rest', is_public_gateway: false,
    api_url: 'https://api.sms.ir', api_key: '', line_number: '',
    sender_number: '', is_active: false, username: '', password: '', token: '', is_default: false,
  };
  const blankRahyab: Partial<SmsProvider> = {
    title: '', provider_name: 'rahyab', provider_type: 'rahyab', is_public_gateway: false,
    api_url: 'http://RahyabBulk.ir/WebService/sms.asmx', api_key: '', line_number: '',
    sender_number: '', is_active: false, username: '', password: '', token: '', is_default: false,
  };

  const [form, setForm] = useState<Partial<SmsProvider>>(provider ? { ...provider } : blankRest);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const set = (k: keyof SmsProvider, v: any) => setForm(f => ({ ...f, [k]: v }));
  const isRahyab = form.provider_type === 'rahyab';

  const switchType = (type: string) => {
    if (type === 'rahyab') setForm(f => ({ ...blankRahyab, title: f.title || '' }));
    else setForm(f => ({ ...blankRest, title: f.title || '' }));
  };

  const handleSave = async () => {
    if (!form.title?.trim()) { toast.error('عنوان الزامی است'); return; }
    if (isRahyab && !form.username?.trim() && !form.token?.trim()) {
      toast.error('نام کاربری یا توکن الزامی است'); return;
    }
    if (isRahyab && !form.line_number?.trim()) {
      toast.error('شماره اختصاصی الزامی است'); return;
    }
    setSaving(true);

    const payload = {
      title: form.title,
      provider_name: form.provider_name || '',
      provider_type: form.provider_type || 'rest',
      api_url: form.api_url || '',
      api_key: form.api_key || '',
      line_number: form.line_number || '',
      sender_number: form.sender_number || '',
      is_active: form.is_active ?? false,
      username: form.username || '',
      password: form.password || '',
      token: form.token || '',
      is_public_gateway: form.is_public_gateway ?? false,
      is_default: form.is_default ?? false,
    };

    if (form.id) {
      const { error } = await supabase.from('sms_providers').update({
        ...payload, updated_at: new Date().toISOString(),
      }).eq('id', form.id);
      if (error) { toast.error('خطا در ذخیره'); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('sms_providers').insert([payload]);
      if (error) { toast.error('خطا در ایجاد: ' + error.message); setSaving(false); return; }
    }
    toast.success(form.id ? 'سرویس‌دهنده ویرایش شد' : 'سرویس‌دهنده اضافه شد');
    setSaving(false);
    onSave();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 space-y-5">
      <div className="flex items-center gap-3">
        <Globe className="w-5 h-5 text-green-500" />
        <h4 className="font-semibold text-gray-800 dark:text-white">{form.id ? 'ویرایش سرویس‌دهنده' : 'افزودن سرویس‌دهنده جدید'}</h4>
      </div>

      {/* Type selector */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">نوع سرویس‌دهنده *</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PROVIDER_TYPES.map(pt => (
            <button key={pt.key} type="button"
              onClick={() => !form.id && switchType(pt.key)}
              disabled={!!form.id}
              className={`p-3.5 rounded-xl border-2 text-right transition-all ${form.provider_type === pt.key ? 'border-green-400 bg-green-50 dark:bg-green-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'} ${form.id ? 'cursor-default' : 'cursor-pointer'}`}
            >
              <p className={`text-sm font-semibold ${form.provider_type === pt.key ? 'text-green-700 dark:text-green-300' : 'text-gray-600 dark:text-gray-300'}`}>{pt.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{pt.desc}</p>
              {form.provider_type === pt.key && <span className="inline-block mt-1.5 text-xs text-green-600 dark:text-green-400 font-medium">● انتخاب شده</span>}
            </button>
          ))}
        </div>
        {form.id && <p className="text-xs text-gray-400 mt-1.5">نوع سرویس‌دهنده پس از ایجاد قابل تغییر نیست.</p>}
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">عنوان *</label>
        <input className={inp} value={form.title || ''} onChange={e => set('title', e.target.value)}
          placeholder={isRahyab ? 'مثال: رهیاب رایان اصلی' : 'مثال: sms.ir اصلی'} />
      </div>

      {/* REST fields */}
      {!isRahyab && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">کلید API (X-API-KEY) *</label>
            <input className={inp} value={form.api_key || ''} onChange={e => set('api_key', e.target.value)}
              placeholder="کلید API از پنل برنامه‌نویسان sms.ir" dir="ltr" />
            <p className="text-xs text-gray-400 mt-1">از پنل sms.ir ← برنامه‌نویسان ← لیست کلیدهای API دریافت کنید</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره خط *</label>
            <input className={inp} value={form.line_number || ''} onChange={e => set('line_number', e.target.value)}
              placeholder="مثال: 30004505000017" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس پایه API</label>
            <input className={inp} value={form.api_url || ''} onChange={e => set('api_url', e.target.value)}
              placeholder="https://api.sms.ir" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نام کاربری (اختیاری)</label>
            <input className={inp} value={form.username || ''} onChange={e => set('username', e.target.value)} dir="ltr" />
          </div>
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">کلمه عبور (اختیاری)</label>
            <input className={inp + ' pl-10'} type={showPass ? 'text' : 'password'}
              value={form.password || ''} onChange={e => set('password', e.target.value)} dir="ltr" />
            <button type="button" onClick={() => setShowPass(v => !v)} className="absolute left-3 top-8 text-gray-400 hover:text-gray-600 transition-colors">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Rahyab fields */}
      {isRahyab && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-2xl">
            <Info className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed">
              برای امنیت بیشتر از <strong>توکن</strong> به جای نام کاربری استفاده کنید. در صورت وجود توکن، نام کاربری نادیده گرفته می‌شود.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">توکن (اولویت اول)</label>
              <input className={inp} value={form.token || ''} onChange={e => set('token', e.target.value)}
                placeholder="توکن احراز هویت" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نام کاربری</label>
              <input className={inp} value={form.username || ''} onChange={e => set('username', e.target.value)}
                placeholder="نام کاربری پنل رهیاب رایان" dir="ltr" />
            </div>
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">کلمه عبور</label>
              <input className={inp + ' pl-10'} type={showPass ? 'text' : 'password'}
                value={form.password || ''} onChange={e => set('password', e.target.value)} dir="ltr" />
              <button type="button" onClick={() => setShowPass(v => !v)} className="absolute left-3 top-8 text-gray-400 hover:text-gray-600 transition-colors">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره اختصاصی *</label>
              <input className={inp} value={form.line_number || ''} onChange={e => set('line_number', e.target.value)}
                placeholder="مثال: 5000123" dir="ltr" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس وب‌سرویس SOAP</label>
              <input className={inp} value={form.api_url || ''} onChange={e => set('api_url', e.target.value)} dir="ltr" />
              <p className="text-xs text-gray-400 mt-1 font-mono">پیش‌فرض: http://RahyabBulk.ir/WebService/sms.asmx</p>
            </div>
          </div>
        </div>
      )}

      {/* Status + toggles (common) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">وضعیت</label>
          <div className="relative">
            <select className={inp + ' appearance-none pl-8'} value={form.is_active ? 'active' : 'inactive'}
              onChange={e => set('is_active', e.target.value === 'active')}>
              <option value="active">فعال</option>
              <option value="inactive">غیرفعال</option>
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-2.5">
          <span className="text-sm text-gray-600 dark:text-gray-300">درگاه عمومی</span>
          <Toggle value={!!form.is_public_gateway} onChange={v => set('is_public_gateway', v)} color="bg-blue-500" />
        </div>
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-2.5">
          <span className="text-sm text-gray-600 dark:text-gray-300">سرویس‌دهنده پیش‌فرض</span>
          <Toggle value={!!form.is_default} onChange={v => set('is_default', v)} color="bg-amber-500" />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره'}
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          انصراف
        </button>
      </div>
    </div>
  );
}

function ProvidersTab() {
  const [providers, setProviders] = useState<SmsProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SmsProvider> | null | 'new'>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('sms_providers').select('*').order('created_at');
    setProviders((data || []) as SmsProvider[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteProvider = async (id: string) => {
    await supabase.from('sms_providers').delete().eq('id', id);
    toast.success('سرویس‌دهنده حذف شد');
    load();
  };

  if (editing !== null) {
    return <ProviderForm
      provider={editing === 'new' ? null : editing}
      onSave={() => { setEditing(null); load(); }}
      onCancel={() => setEditing(null)}
    />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 dark:text-gray-400">{providers.length} سرویس‌دهنده</span>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />افزودن سرویس‌دهنده
          </button>
        </div>
      </div>

      {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}
      {!loading && providers.length === 0 && (
        <div className="py-14 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Globe className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">هیچ سرویس‌دهنده‌ای تعریف نشده</p>
          <button onClick={() => setEditing('new')} className="mt-3 text-sm text-green-500 hover:text-green-600 font-medium">افزودن اولین سرویس‌دهنده</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {providers.map(p => (
          <div key={p.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${p.is_active ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                  <MessageSquare className={`w-5 h-5 ${p.is_active ? 'text-green-500' : 'text-gray-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-white truncate">{p.title}</p>
                  <p className="text-xs text-gray-400 font-mono">{p.provider_type === 'rahyab' ? 'رهیاب رایان — SOAP' : (p.provider_name || 'REST API')}</p>
                </div>
              </div>
              <div className="relative flex-shrink-0" ref={menuOpen === p.id ? menuRef : undefined}>
                <button onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === p.id ? null : p.id); }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen === p.id && (
                  <div className="absolute left-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
                    <button onClick={() => { setEditing(p); setMenuOpen(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right text-sm text-gray-700 dark:text-gray-200 transition-colors">
                      <Edit2 className="w-3.5 h-3.5 text-blue-500" />ویرایش
                    </button>
                    <button onClick={() => { deleteProvider(p.id); setMenuOpen(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right text-sm text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />حذف
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
              {p.line_number && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 flex-shrink-0" /><span className="font-mono">خط: {p.line_number}</span></div>}
              {p.api_url && <div className="flex items-center gap-2 truncate"><Globe className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate font-mono">{p.api_url}</span></div>}
              {p.api_key && <div className="flex items-center gap-2"><Lock className="w-3.5 h-3.5 flex-shrink-0" /><span className="font-mono">{'*'.repeat(12)}{p.api_key.slice(-4)}</span></div>}
              {p.username && <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 flex-shrink-0" />{p.username}</div>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.provider_type === 'rahyab' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                {p.provider_type === 'rahyab' ? 'رهیاب رایان' : 'REST API'}
              </span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                {p.is_active ? 'فعال' : 'غیرفعال'}
              </span>
              {p.is_public_gateway && <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">درگاه عمومی</span>}
              {p.is_default && <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">پیش‌فرض</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 2 — Group SMS Rules
// ════════════════════════════════════════════════════════════════════
function GroupSelector({ groups, selected, onSelect }: { groups: UserGroup[]; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = groups.find(g => g.id === selected);
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-700 dark:text-gray-200 hover:border-green-400 transition-colors min-w-52">
        <GroupIcon className="w-4 h-4 text-green-500 flex-shrink-0" />
        <span className="flex-1 text-right truncate">{current ? (current.display_name || current.name) : 'انتخاب گروه کاربری'}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
          {groups.map(g => (
            <button key={g.id} onClick={() => { onSelect(g.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right transition-colors ${selected === g.id ? 'bg-green-50 dark:bg-green-900/20' : ''}`}>
              <GroupIcon className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-200">{g.display_name || g.name}</span>
              {selected === g.id && <Check className="w-3.5 h-3.5 text-green-500 mr-auto flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GroupsTab() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [providers, setProviders] = useState<SmsProvider[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [rules, setRules] = useState<Record<string, { enabled: boolean; provider_id: string | null }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('user_groups').select('id, name, display_name').order('name').then(({ data }) => {
      const g = (data || []) as UserGroup[];
      setGroups(g);
      if (g.length > 0) setSelectedGroup(g[0].id);
    });
    supabase.from('sms_providers').select('id, title, is_active, provider_type').eq('is_active', true).then(({ data }) => {
      setProviders((data || []) as SmsProvider[]);
    });
  }, []);

  const loadRules = useCallback(async (groupId: string) => {
    setLoading(true);
    const { data } = await supabase.from('sms_group_rules').select('*').eq('group_id', groupId);
    const map: Record<string, { enabled: boolean; provider_id: string | null }> = {};
    for (const r of (data || [])) map[r.sms_category] = { enabled: r.enabled, provider_id: r.provider_id };
    setRules(map);
    setLoading(false);
  }, []);

  useEffect(() => { if (selectedGroup) loadRules(selectedGroup); }, [selectedGroup, loadRules]);

  const save = async () => {
    if (!selectedGroup) return;
    setSaving(true);
    for (const [cat, val] of Object.entries(rules)) {
      await supabase.from('sms_group_rules').upsert(
        { group_id: selectedGroup, sms_category: cat, enabled: val.enabled, provider_id: val.provider_id || null },
        { onConflict: 'group_id,sms_category' }
      );
    }
    toast.success('تنظیمات پیامک ذخیره شد');
    setSaving(false);
  };

  const getRuleFor = (cat: string) => rules[cat] ?? { enabled: false, provider_id: null };
  const setRule = (cat: string, k: 'enabled' | 'provider_id', v: any) =>
    setRules(r => ({ ...r, [cat]: { ...getRuleFor(cat), [k]: v } }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">برای هر گروه کاربری مشخص کنید چه دسته پیامک‌هایی ارسال شود</p>
        <GroupSelector groups={groups} selected={selectedGroup} onSelect={setSelectedGroup} />
      </div>

      {!selectedGroup && <div className="py-16 text-center text-gray-400">ابتدا یک گروه کاربری انتخاب کنید</div>}
      {selectedGroup && loading && <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      {selectedGroup && !loading && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="grid grid-cols-3 px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400">
              <span>دسته پیامک</span>
              <span className="text-center">فعال</span>
              <span className="text-center">سرویس‌دهنده</span>
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {SMS_CATEGORIES.map(cat => {
                const rule = getRuleFor(cat.key);
                return (
                  <div key={cat.key} className="grid grid-cols-3 items-center px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors gap-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[cat.key] || ''}`}>{cat.label}</span>
                    </div>
                    <div className="flex justify-center">
                      <Toggle value={rule.enabled} onChange={v => setRule(cat.key, 'enabled', v)} />
                    </div>
                    <div className="flex justify-center">
                      {rule.enabled ? (
                        <div className="relative">
                          <select
                            value={rule.provider_id || ''}
                            onChange={e => setRule(cat.key, 'provider_id', e.target.value || null)}
                            className="appearance-none text-xs pr-2 pl-6 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-green-500 max-w-36 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-700 dark:[&>option]:text-white"
                          >
                            <option value="">پیش‌فرض (سرویس‌دهنده اصلی)</option>
                            {providers.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.title}{p.provider_type === 'rahyab' ? ' (SOAP)' : ''}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" />
                        </div>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-start">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 3 — SMS Templates
// ════════════════════════════════════════════════════════════════════

// All known placeholders by category for the guide + new form
const ALL_PLACEHOLDERS: { key: string; label: string; example: string }[] = [
  { key: 'full_name',        label: 'نام کامل',              example: 'علی احمدی' },
  { key: 'meeting_subject',  label: 'موضوع جلسه',            example: 'جلسه هیئت مدیره' },
  { key: 'meeting_date',     label: 'تاریخ جلسه',            example: '۱۴۰۳/۰۳/۱۵' },
  { key: 'meeting_time',     label: 'ساعت جلسه',             example: '۱۴:۳۰' },
  { key: 'location',         label: 'مکان',                  example: 'سالن اجتماعات' },
  { key: 'join_link',        label: 'لینک ورود',             example: 'https://...' },
  { key: 'minutes',          label: 'دقایق مانده',           example: '۳۰' },
  { key: 'task_title',       label: 'عنوان اقدام',           example: 'بررسی گزارش مالی' },
  { key: 'priority',         label: 'اولویت',                example: 'بالا' },
  { key: 'due_date',         label: 'مهلت',                  example: '۱۴۰۳/۰۴/۰۱' },
  { key: 'event_title',      label: 'عنوان رویداد',          example: 'جشن سالگرد' },
  { key: 'event_date',       label: 'تاریخ رویداد',          example: '۱۴۰۳/۰۵/۱۰' },
  { key: 'sender_name',      label: 'نام فرستنده',           example: 'سارا رضایی' },
  { key: 'org_name',         label: 'نام سازمان',            example: 'شرکت نمونه' },
];

// Help guide shown collapsibly at top of templates tab
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

// New template creation form
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

  const EVENT_TYPES = [
    { key: 'invite', label: 'دعوت' }, { key: 'change', label: 'تغییر' },
    { key: 'cancel', label: 'لغو' }, { key: 'reminder', label: 'یادآور' },
    { key: 'assign', label: 'تخصیص' }, { key: 'complete', label: 'تکمیل' },
    { key: 'event_invite', label: 'دعوت رویداد' }, { key: 'mention', label: 'منشن' },
    { key: 'custom', label: 'سفارشی' },
  ];

  const AUDIENCES = [
    { key: 'all', label: 'همه' }, { key: 'participants', label: 'شرکت‌کنندگان' },
    { key: 'observers', label: 'مطلعین' }, { key: 'external', label: 'خارج سازمان' },
  ];

  const insertPlaceholder = (ph: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? form.body.length;
      const end = ta.selectionEnd ?? form.body.length;
      const newBody = form.body.slice(0, start) + `{{${ph}}}` + form.body.slice(end);
      setForm(f => ({ ...f, body: newBody }));
      setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + ph.length + 4; }, 0);
    } else {
      setForm(f => ({ ...f, body: f.body + `{{${ph}}}` }));
    }
    if (!form.placeholders.includes(ph)) setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
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
    setSaving(true);
    const { error } = await supabase.from('sms_templates').insert([{
      category: form.category,
      event_type: form.event_type,
      audience: form.audience,
      subject: form.subject,
      body: form.body,
      placeholders: form.placeholders,
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <Plus className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">ایجاد قالب پیام جدید</h4>
          <p className="text-xs text-gray-400">فیلدهای ستاره‌دار الزامی هستند</p>
        </div>
      </div>

      {/* Row 1: category + event + audience */}
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

      {/* Subject */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">موضوع / عنوان</label>
        <input className={inp} value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))} placeholder="عنوان پیام (اختیاری)" />
      </div>

      {/* Placeholders — quick insert */}
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

      {/* Body */}
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
          onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="متن پیامک را اینجا بنویسید. برای درج متغیر روی دکمه‌های بالا کلیک کنید..."
        />
      </div>

      {/* Custom placeholder */}
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

      {/* Active toggle */}
      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <span className="text-sm text-gray-600 dark:text-gray-300">قالب فعال باشد</span>
        <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
      </div>

      {/* Actions */}
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
    setSaving(true);
    const { error } = await supabase.from('sms_templates')
      .update({ subject: form.subject, body: form.body, is_active: form.is_active, updated_at: new Date().toISOString() })
      .eq('id', form.id);
    if (error) { toast.error('خطا در ذخیره قالب'); setSaving(false); return; }
    toast.success('قالب پیام ذخیره شد');
    setSaving(false);
    onSave({ ...form });
  };

  const insertPlaceholder = (ph: string) => {
    const ta = textareaRef.current;
    if (ta) {
      const start = ta.selectionStart ?? form.body.length;
      const end = ta.selectionEnd ?? form.body.length;
      const newBody = form.body.slice(0, start) + `{{${ph}}}` + form.body.slice(end);
      setForm(f => ({ ...f, body: newBody }));
      setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = start + ph.length + 4; }, 0);
    } else {
      setForm(f => ({ ...f, body: f.body + `{{${ph}}}` }));
    }
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

      {/* Placeholder quick insert */}
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
        <textarea ref={textareaRef} rows={4} className={inp + ' resize-none'} value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="متن پیام را وارد کنید..." />
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

// ════════════════════════════════════════════════════════════════════
//  Template Preview Modal
// ════════════════════════════════════════════════════════════════════

// Default sample values for each placeholder
const SAMPLE_VALUES: Record<string, string> = {
  meeting_subject: 'جلسه هماهنگی پروژه',
  meeting_date: '۱۵/۳/۱۴۰۵',
  meeting_time: '۰۹:۰۰-۱۰:۰۰',
  location: 'اتاق کنفرانس A',
  location_part: ' | اتاق کنفرانس A',
  join_link: 'https://example.com?conference=ABC-DEF-GHI',
  sender_name: 'علی محمدی',
  representative: 'رضا کریمی',
  full_name: 'سارا احمدی',
  task_title: 'بررسی گزارش هفتگی',
  task_assignee: 'محمد رضایی',
  task_due: '۲۰/۳/۱۴۰۵',
  event_title: 'جشن سالگرد تأسیس',
  event_date: '۲۵/۳/۱۴۰۵',
  channel_name: 'کانال اطلاع‌رسانی',
  message_preview: 'سلام، آیا گزارش آماده شده؟',
  note_title: 'یادداشت جلسه هیئت مدیره',
  username: 'ali.mohammadi',
};

function fillPreview(body: string, customVars: Record<string, string>): string {
  const vars = { ...SAMPLE_VALUES, ...customVars };
  return body.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = vars[key];
    return val !== undefined ? val : `{{${key}}}`;
  });
}

interface TemplatePreviewModalProps {
  template: SmsTemplate;
  onClose: () => void;
}

function TemplatePreviewModal({ template, onClose }: TemplatePreviewModalProps) {
  const [customVars, setCustomVars] = useState<Record<string, string>>({});

  // Extract all placeholder keys used in the body
  const usedKeys = Array.from(new Set([...(template.placeholders || []), ...Array.from(template.body.matchAll(/\{\{(\w+)\}\}/g), m => m[1])]));

  const preview = fillPreview(template.body, customVars);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        {/* Header */}
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
          {/* Template meta */}
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

          {/* Customizable placeholder values */}
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

          {/* Rendered preview */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">خروجی پیامک:</p>
            <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-4 text-sm text-gray-800 dark:text-gray-200 leading-relaxed whitespace-pre-wrap min-h-[80px]">
              {preview}
            </div>
          </div>

          {/* Character count */}
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>{preview.length} کاراکتر</span>
            <span>{Math.ceil(preview.length / 70)} پیامک (۷۰ کاراکتر فارسی)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplatesTab() {
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

      {/* Toolbar */}
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

      {/* Help guide */}
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
                  <Edit2 className="w-3 h-3" />ویرایش
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

// ════════════════════════════════════════════════════════════════════
//  TAB 4 — SMS Test Panel
// ════════════════════════════════════════════════════════════════════

type TestStatus = 'idle' | 'loading' | 'ok' | 'error';

interface RahyabTestCard {
  id: string;
  title: string;
  desc: string;
  action: string;
  needsPhone?: boolean;
  needsMessage?: boolean;
  needsReturnId?: boolean;
}

const RAHYAB_TESTS: RahyabTestCard[] = [
  { id: 'hello_world',     title: '۱. HelloWorld',             desc: 'تست اتصال به وب‌سرویس — پاسخ «Hello World» را بررسی می‌کند.',           action: 'hello_world' },
  { id: 'get_info',        title: '۲. doGetInfo',              desc: 'تست احراز هویت و اعتبار — نام کاربری، رمز، اعتبار و تاریخ انقضا.',       action: 'get_info' },
  { id: 'send',            title: '۳. doSendSMS',              desc: 'ارسال پیامک آزمایشی — نیاز به شماره موبایل و متن پیام دارد.',              action: 'send', needsPhone: true, needsMessage: true },
  { id: 'get_delivery',    title: '۴. doGetDelivery',          desc: 'وضعیت تحویل — شناسه بازگشتی مرحله ۳ را وارد کنید.',                       action: 'get_delivery', needsReturnId: true },
  { id: 'receive_by_flag', title: '۵. doReceiveSMSByFlag',    desc: 'دریافت پیامک‌های ورودی با پرچم — پیام‌های جدید از خط اختصاصی را می‌خواند.',  action: 'receive_by_flag' },
  { id: 'get_info_xml',    title: '۶. getInfoXML',             desc: 'اطلاعات کامل XML — اعتبار، قیمت‌ها و شماره‌های اختصاصی را برمی‌گرداند.',  action: 'get_info_xml' },
];

const DELIVERY_STATUS: Record<number, { label: string; color: string }> = {
  0: { label: 'نامشخص',        color: 'text-gray-500' },
  2: { label: 'تحویل داده شد', color: 'text-green-600' },
  5: { label: 'تحویل نشد',     color: 'text-red-600' },
  9: { label: 'بلاک شده',      color: 'text-orange-500' },
};

function TestTab() {
  const [providers, setProviders] = useState<SmsProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('این یک پیامک آزمایشی از سامانه است.');
  const [returnIdInput, setReturnIdInput] = useState('');

  // REST provider state
  const [connStatus, setConnStatus] = useState<TestStatus>('idle');
  const [connResult, setConnResult] = useState<any>(null);
  const [sendStatus, setSendStatus] = useState<TestStatus>('idle');
  const [sendResult, setSendResult] = useState<any>(null);

  // Rahyab per-card state
  const [rahyabStatus, setRahyabStatus] = useState<Record<string, TestStatus>>({});
  const [rahyabResult, setRahyabResult] = useState<Record<string, any>>({});
  const [runningAll, setRunningAll] = useState(false);

  const selectedProviderObj = providers.find(p => p.id === selectedProvider);
  const isRahyabProvider = selectedProviderObj?.provider_type === 'rahyab';

  useEffect(() => {
    supabase.from('sms_providers').select('*').eq('is_active', true).order('created_at')
      .then(({ data }) => {
        const list = (data || []) as SmsProvider[];
        setProviders(list);
        const def = list.find(p => p.is_default) || list[0];
        if (def) setSelectedProvider(def.id);
      });
  }, []);

  const resetAll = () => {
    setConnResult(null); setSendResult(null);
    setConnStatus('idle'); setSendStatus('idle');
    setRahyabStatus({}); setRahyabResult({});
  };

  const callEdge = async (body: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || anonKey}`,
        'Apikey': anonKey,
      },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  // ── REST tests ─────────────────────────────────────────────────────
  const testConnection = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    setConnStatus('loading'); setConnResult(null);
    try {
      const result = await callEdge({ mode: 'test_connection', providerId: selectedProvider });
      setConnResult(result);
      setConnStatus(result.ok ? 'ok' : 'error');
      if (result.ok) toast.success('اتصال به سرویس پیامک برقرار است');
      else toast.error('خطا در اتصال: ' + (result.error || ''));
    } catch (e: any) {
      setConnResult({ error: e.message }); setConnStatus('error');
    }
  };

  const sendTest = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    if (!testPhone.trim()) { toast.error('شماره موبایل الزامی است'); return; }
    if (!testMessage.trim()) { toast.error('متن پیام الزامی است'); return; }
    setSendStatus('loading'); setSendResult(null);
    try {
      const result = await callEdge({ mode: 'send', providerId: selectedProvider, mobiles: [testPhone.trim()], message: testMessage.trim() });
      setSendResult(result);
      setSendStatus(result.ok ? 'ok' : 'error');
      if (result.ok) toast.success(`پیامک تست ارسال شد — شناسه بسته: ${result.packId || '—'}`);
      else toast.error('خطا در ارسال: ' + (result.error || ''));
    } catch (e: any) {
      setSendResult({ error: e.message }); setSendStatus('error');
    }
  };

  // ── Rahyab single test ─────────────────────────────────────────────
  const runRahyabTest = async (card: RahyabTestCard) => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    if (card.needsPhone && !testPhone.trim()) { toast.error('شماره موبایل الزامی است'); return; }
    if (card.needsMessage && !testMessage.trim()) { toast.error('متن پیام الزامی است'); return; }

    setRahyabStatus(s => ({ ...s, [card.id]: 'loading' }));
    setRahyabResult(r => ({ ...r, [card.id]: null }));

    try {
      let payload: Record<string, unknown>;
      if (card.action === 'send') {
        payload = { action: 'send', mobiles: [testPhone.trim()], message: testMessage.trim(), isFarsi: true };
      } else if (card.action === 'get_delivery') {
        const ids = returnIdInput.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        if (!ids.length) { toast.error('شناسه بازگشتی الزامی است'); setRahyabStatus(s => ({ ...s, [card.id]: 'idle' })); return; }
        payload = { action: 'get_delivery', returnIds: ids };
      } else {
        payload = { action: card.action };
      }

      const result = await callEdge({ mode: 'rahyab_test', providerId: selectedProvider, rahyabPayload: payload });
      setRahyabResult(r => ({ ...r, [card.id]: result }));
      setRahyabStatus(s => ({ ...s, [card.id]: result.ok ? 'ok' : 'error' }));

      // auto-populate returnId from send result
      if (card.action === 'send' && result.ok && result.returnIds?.length) {
        setReturnIdInput(result.returnIds.join(', '));
      }
    } catch (e: any) {
      setRahyabResult(r => ({ ...r, [card.id]: { error: e.message } }));
      setRahyabStatus(s => ({ ...s, [card.id]: 'error' }));
    }
  };

  const runAllRahyabTests = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    setRunningAll(true);
    for (const card of RAHYAB_TESTS) {
      if (card.needsPhone && !testPhone.trim()) continue;
      if (card.needsMessage && !testMessage.trim()) continue;
      await runRahyabTest(card);
      await new Promise(r => setTimeout(r, 400));
    }
    setRunningAll(false);
    toast.success('همه تست‌های رهیاب رایان اجرا شدند');
  };

  // ── Shared UI components ───────────────────────────────────────────
  const StatusBadge = ({ status }: { status: TestStatus }) => {
    if (status === 'idle') return null;
    if (status === 'loading') return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    if (status === 'ok') return <Check className="w-4 h-4 text-green-500" />;
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  };

  const RahyabResultBox = ({ cardId }: { cardId: string }) => {
    const status = rahyabStatus[cardId];
    const result = rahyabResult[cardId];
    if (!result || status === 'idle' || status === 'loading') return null;
    const isOk = status === 'ok';
    return (
      <div className={`mt-3 rounded-xl border p-3 text-xs font-mono leading-relaxed space-y-1 ${isOk ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
        <p className={`font-bold mb-1 ${isOk ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{isOk ? 'موفق' : 'خطا'}</p>
        {result.error && <p className="text-red-600 dark:text-red-400 break-all"><span className="font-semibold">خطا: </span>{result.error}</p>}
        {result.result && <p className="text-gray-700 dark:text-gray-300 break-all"><span className="font-semibold">نتیجه: </span>{result.result}</p>}
        {result.credit !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">اعتبار: </span>{result.credit}</p>}
        {result.expireDate !== undefined && result.expireDate !== '' && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">انقضا: </span>{result.expireDate}</p>}
        {result.sent !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">ارسال شد: </span>{result.sent} شماره</p>}
        {result.returnIds?.length > 0 && <p className="text-gray-600 dark:text-gray-300 break-all"><span className="font-semibold">ReturnIDs: </span>{result.returnIds.join(', ')}</p>}
        {result.count !== undefined && <p className="text-gray-700 dark:text-gray-300"><span className="font-semibold">تعداد پیام: </span>{result.count}</p>}
        {result.delivery && (
          <div className="mt-1 space-y-0.5">
            <p className="font-semibold text-gray-700 dark:text-gray-300">وضعیت تحویل:</p>
            {Object.entries(result.delivery as Record<string, number>).map(([id, code]) => {
              const ds = DELIVERY_STATUS[code] || { label: `کد ${code}`, color: 'text-gray-500' };
              return <p key={id} className={ds.color}><span className="text-gray-500 dark:text-gray-400">{id}: </span>{ds.label}</p>;
            })}
          </div>
        )}
        {(result.rawXml || result.messages) && (
          <details className="mt-1">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">پاسخ کامل (کلیک)</summary>
            <pre className="mt-2 overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-all max-h-48">
              {result.rawXml || JSON.stringify(result.messages, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  };

  const RestResultBox = ({ result, status }: { result: any; status: TestStatus }) => {
    if (!result || status === 'idle' || status === 'loading') return null;
    const isOk = status === 'ok';
    return (
      <div className={`mt-3 rounded-xl border p-4 text-xs font-mono leading-relaxed space-y-1 ${isOk ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
        <p className={`font-bold mb-2 text-sm ${isOk ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{isOk ? 'موفق' : 'خطا'}</p>
        {result.error && <p className="text-red-600 dark:text-red-400 break-all"><span className="font-semibold">پیام خطا: </span>{result.error}</p>}
        {result.credit !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">اعتبار حساب: </span>{result.credit}</p>}
        {result.sent !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">ارسال شده به: </span>{result.sent} شماره</p>}
        {result.packId && <p className="text-gray-600 dark:text-gray-300 break-all"><span className="font-semibold">Pack ID: </span>{result.packId}</p>}
        {result.cost !== undefined && <p className="text-gray-600 dark:text-gray-300"><span className="font-semibold">هزینه: </span>{result.cost}</p>}
        {result.response && (
          <details className="mt-2">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">پاسخ کامل سرور (کلیک برای نمایش)</summary>
            <pre className="mt-2 overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-all">
              {JSON.stringify(result.response, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Provider selector */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="w-4 h-4 text-green-500" />
          <h4 className="font-semibold text-gray-800 dark:text-white text-sm">انتخاب سرویس‌دهنده</h4>
        </div>
        {providers.length === 0 ? (
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            هیچ سرویس‌دهنده فعالی یافت نشد. ابتدا در تب «سرویس‌دهندگان» یک سرویس‌دهنده فعال تعریف کنید.
          </div>
        ) : (
          <div className="relative">
            <select
              dir="rtl"
              className={inp + ' appearance-none pl-8'}
              value={selectedProvider}
              onChange={e => { setSelectedProvider(e.target.value); resetAll(); }}
            >
              {!selectedProvider && (
                <option value="" disabled>انتخاب سرویس‌دهنده...</option>
              )}
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}{p.is_default ? ' (پیش‌فرض)' : ''}{p.provider_type === 'rahyab' ? ' — SOAP' : p.line_number ? ` — ${p.line_number}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {/* ── Rahyab 6-card test panel ──────────────────────────────────── */}
      {isRahyabProvider && (
        <>
          {/* Shared inputs for tests that need phone/message */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-teal-500" />
              <h4 className="font-semibold text-gray-800 dark:text-white text-sm">اطلاعات مورد نیاز تست‌ها</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل (برای تست ۳)</label>
                <input className={inp} value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="09121234567" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شناسه بازگشتی (برای تست ۴)</label>
                <input className={inp} value={returnIdInput} onChange={e => setReturnIdInput(e.target.value)} placeholder="خودکار از تست ۳ پر می‌شود" dir="ltr" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">متن پیامک (برای تست ۳)</label>
                <input className={inp} value={testMessage} onChange={e => setTestMessage(e.target.value)} />
              </div>
            </div>
            <button
              onClick={runAllRahyabTests}
              disabled={runningAll || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
            >
              {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {runningAll ? 'در حال اجرا...' : 'اجرای همه تست‌ها'}
            </button>
          </div>

          {/* 6 test cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {RAHYAB_TESTS.map(card => {
              const st = rahyabStatus[card.id] || 'idle';
              const borderCls = st === 'ok' ? 'border-green-200 dark:border-green-800' : st === 'error' ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-gray-700';
              return (
                <div key={card.id} className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 space-y-2 ${borderCls}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">{card.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{card.desc}</p>
                    </div>
                    <StatusBadge status={st} />
                  </div>
                  <button
                    onClick={() => runRahyabTest(card)}
                    disabled={st === 'loading' || runningAll}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition"
                  >
                    {st === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                    {st === 'loading' ? 'در حال اجرا...' : 'اجرای تست'}
                  </button>
                  <RahyabResultBox cardId={card.id} />
                </div>
              );
            })}
          </div>

          {/* Rahyab troubleshooting */}
          <div className="bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-teal-700 dark:text-teal-300">راهنمای رفع مشکل رهیاب رایان</p>
            </div>
            <ul className="text-xs text-teal-700 dark:text-teal-400 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>خطای احراز هویت: نام کاربری یا توکن را بررسی کنید — توکن مقدم‌تر است</li>
              <li>وضعیت تحویل <strong>0</strong>: نامشخص | <strong>2</strong>: تحویل داده شد | <strong>5</strong>: تحویل نشد | <strong>9</strong>: بلاک شده</li>
              <li>timeout در اتصال: آدرس SOAP URL را بررسی کنید (پیش‌فرض: RahyabBulk.ir)</li>
              <li>پیامک ارسال شده اما ReturnID منفی: شماره اختصاصی صحیح نیست</li>
              <li>doReceiveSMSByFlag: پیام‌های خوانده‌شده را پرچم‌گذاری می‌کند — هر پیام فقط یکبار برمی‌گردد</li>
            </ul>
          </div>
        </>
      )}

      {/* ── REST 2-step test panel ────────────────────────────────────── */}
      {!isRahyabProvider && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {connStatus === 'ok' ? <Wifi className="w-4 h-4 text-green-500" /> : connStatus === 'error' ? <WifiOff className="w-4 h-4 text-red-500" /> : <Wifi className="w-4 h-4 text-gray-400" />}
                <h4 className="font-semibold text-gray-800 dark:text-white text-sm">مرحله ۱ — تست اتصال و اعتبار</h4>
              </div>
              <StatusBadge status={connStatus} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">بررسی می‌کند که کلید API معتبر است و مقدار اعتبار حساب را نمایش می‌دهد.</p>
            <button onClick={testConnection} disabled={connStatus === 'loading' || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition">
              {connStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {connStatus === 'loading' ? 'در حال بررسی...' : 'بررسی اتصال'}
            </button>
            <RestResultBox result={connResult} status={connStatus} />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-green-500" />
                <h4 className="font-semibold text-gray-800 dark:text-white text-sm">مرحله ۲ — ارسال پیامک آزمایشی</h4>
              </div>
              <StatusBadge status={sendStatus} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">یک پیامک واقعی به شماره زیر ارسال می‌کند. از اعتبار حساب کسر می‌شود.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل هدف *</label>
                <input className={inp} value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="09121234567" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">متن پیامک *</label>
                <textarea className={inp + ' resize-none'} rows={3} value={testMessage} onChange={e => setTestMessage(e.target.value)} />
                <p className={`text-xs mt-1 ${testMessage.length > 160 ? 'text-amber-500' : 'text-gray-400'}`}>
                  {testMessage.length} کاراکتر {testMessage.length > 160 ? '— بیش از ۱ پیامک' : ''}
                </p>
              </div>
            </div>
            <button onClick={sendTest} disabled={sendStatus === 'loading' || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition">
              {sendStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sendStatus === 'loading' ? 'در حال ارسال...' : 'ارسال پیامک تست'}
            </button>
            <RestResultBox result={sendResult} status={sendStatus} />
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">راهنمای رفع مشکل</p>
            </div>
            <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>کد وضعیت <strong>10</strong>: کلید API نامعتبر است — از پنل sms.ir کلید جدید دریافت کنید</li>
              <li>کد وضعیت <strong>11</strong>: کلید API غیرفعال است — از پنل آن را فعال کنید</li>
              <li>کد وضعیت <strong>101</strong>: شماره خط نامعتبر است — شماره خط را از پنل sms.ir بررسی کنید</li>
              <li>کد وضعیت <strong>102</strong>: اعتبار کافی نیست — حساب را شارژ کنید</li>
              <li>کد وضعیت <strong>104</strong>: فرمت شماره موبایل اشتباه است (باید با ۰۹ یا ۹۸ شروع شود)</li>
              <li>کد وضعیت <strong>123</strong>: خط ارسال نیاز به فعال‌سازی دارد — با پشتیبانی sms.ir تماس بگیرید</li>
              <li>خطای اتصال: Edge Function نمی‌تواند به api.sms.ir متصل شود — سرویس Supabase را بررسی کنید</li>
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 5 — SMS Dispatch Reports
// ════════════════════════════════════════════════════════════════════

interface DispatchLog {
  id: string;
  created_at: string;
  target_user_id: string | null;
  triggered_by_user_id: string | null;
  target_phone: string | null;
  category: string;
  event_type: string;
  audience: string;
  message: string | null;
  provider_id: string | null;
  provider_name: string | null;
  status: string;
  error_text: string | null;
  pack_id: string | null;
  cost: number | null;
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; cls: string }> = {
  sent:    { label: 'ارسال شد',    icon: <CheckCircle  className="w-4 h-4" />, cls: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/30' },
  failed:  { label: 'خطا',         icon: <XCircle      className="w-4 h-4" />, cls: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/30' },
  skipped: { label: 'رد شد',       icon: <MinusCircle  className="w-4 h-4" />, cls: 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30' },
  pending: { label: 'در انتظار',   icon: <Clock        className="w-4 h-4" />, cls: 'text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/30' },
};

const CATEGORY_LABEL: Record<string, string> = {
  meeting: 'جلسه', task: 'اقدام', calendar: 'تقویم', chat: 'چت', system: 'سیستم',
};

const EVENT_LABEL: Record<string, string> = {
  invite: 'دعوت', change: 'تغییر', cancel: 'لغو', reminder: 'یادآور',
  assign: 'تخصیص', complete: 'تکمیل', event_invite: 'دعوت رویداد', mention: 'منشن',
};

function ReportsTab() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 25;

  const [stats, setStats] = useState({ sent: 0, failed: 0, skipped: 0, total: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('sms_dispatch_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    if (filterCategory !== 'all') q = q.eq('category', filterCategory);

    const { data } = await q;
    setLogs((data || []) as DispatchLog[]);
    setLoading(false);
  }, [filterStatus, filterCategory, page]);

  const loadStats = useCallback(async () => {
    const { data } = await supabase
      .from('sms_dispatch_logs')
      .select('status');
    if (!data) return;
    const s = { sent: 0, failed: 0, skipped: 0, total: data.length };
    for (const r of data) {
      if (r.status === 'sent') s.sent++;
      else if (r.status === 'failed') s.failed++;
      else if (r.status === 'skipped') s.skipped++;
    }
    setStats(s);
  }, []);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }) +
      '  ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'کل درخواست‌ها',  value: stats.total,   cls: 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200', icon: <BarChart2 className="w-5 h-5 text-gray-400" /> },
          { label: 'ارسال شده',       value: stats.sent,    cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300', icon: <CheckCircle className="w-5 h-5 text-green-500" /> },
          { label: 'خطا',             value: stats.failed,  cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300', icon: <XCircle className="w-5 h-5 text-red-500" /> },
          { label: 'رد شده',          value: stats.skipped, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300', icon: <MinusCircle className="w-5 h-5 text-amber-500" /> },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 flex items-center gap-3 ${s.cls}`}>
            {s.icon}
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs opacity-70">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          {/* Status filter */}
          <div className="relative">
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
              className="appearance-none text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="all">همه وضعیت‌ها</option>
              <option value="sent">ارسال شده</option>
              <option value="failed">خطا</option>
              <option value="skipped">رد شده</option>
              <option value="pending">در انتظار</option>
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          {/* Category filter */}
          <div className="relative">
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(0); }}
              className="appearance-none text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="all">همه دسته‌ها</option>
              {SMS_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <button onClick={() => { load(); loadStats(); }}
          className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Table */}
      {loading ? (
        <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <BarChart2 className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">هیچ رکوردی یافت نشد</p>
          <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">پس از ارسال اعلان، گزارش‌ها اینجا نمایش داده می‌شوند</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          {/* Header */}
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>جزئیات</span>
            <span className="text-center">دسته</span>
            <span className="text-center">شماره</span>
            <span className="text-center">وضعیت</span>
            <span className="text-center">تاریخ</span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {logs.map(log => {
              const st = STATUS_CONFIG[log.status] ?? STATUS_CONFIG['pending'];
              const isOpen = expanded === log.id;
              return (
                <div key={log.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : log.id)}
                    className="w-full text-right hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 sm:gap-3 px-4 py-3 items-center">
                      {/* Details */}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {log.message ? log.message.slice(0, 80) + (log.message.length > 80 ? '...' : '') : '—'}
                        </p>
                        {log.error_text && (
                          <p className="text-xs text-red-500 truncate">{log.error_text}</p>
                        )}
                        {log.provider_name && (
                          <p className="text-xs text-gray-400">سرویس‌دهنده: {log.provider_name}</p>
                        )}
                      </div>
                      {/* Category */}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium self-center ${CATEGORY_COLORS[log.category] || 'bg-gray-100 text-gray-500'}`}>
                        {CATEGORY_LABEL[log.category] || log.category} / {EVENT_LABEL[log.event_type] || log.event_type}
                      </span>
                      {/* Phone */}
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-300 self-center text-center" dir="ltr">
                        {log.target_phone || '—'}
                      </span>
                      {/* Status */}
                      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium self-center ${st.cls}`}>
                        {st.icon}{st.label}
                      </span>
                      {/* Date */}
                      <span className="text-xs text-gray-400 self-center text-center whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 bg-gray-50 dark:bg-gray-700/20 border-t border-gray-100 dark:border-gray-700 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        {[
                          { label: 'وضعیت', value: st.label },
                          { label: 'دسته', value: `${CATEGORY_LABEL[log.category] || log.category} / ${EVENT_LABEL[log.event_type] || log.event_type}` },
                          { label: 'مخاطب', value: log.audience },
                          { label: 'شماره', value: log.target_phone || '—', mono: true },
                          { label: 'سرویس‌دهنده', value: log.provider_name || 'پیش‌فرض' },
                          { label: 'Pack ID', value: log.pack_id || '—', mono: true },
                          { label: 'هزینه', value: log.cost != null ? String(log.cost) : '—' },
                          { label: 'تاریخ', value: formatDate(log.created_at) },
                        ].map(item => (
                          <div key={item.label} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                            <p className="text-gray-400 mb-0.5">{item.label}</p>
                            <p className={`font-medium text-gray-700 dark:text-gray-200 break-all ${item.mono ? 'font-mono' : ''}`}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                      {log.message && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                          <p className="text-xs text-gray-400 mb-1">متن پیامک</p>
                          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{log.message}</p>
                        </div>
                      )}
                      {log.error_text && (
                        <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-3 border border-red-100 dark:border-red-800">
                          <p className="text-xs text-red-500 font-semibold mb-1">جزئیات خطا</p>
                          <p className="text-xs text-red-600 dark:text-red-400">{log.error_text}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Pagination */}
      {!loading && (logs.length === PAGE_SIZE || page > 0) && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 disabled:opacity-40 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            قبلی
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">صفحه {page + 1}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={logs.length < PAGE_SIZE}
            className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 disabled:opacity-40 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Main SmsConfigPanel
// ════════════════════════════════════════════════════════════════════
export function SmsConfigPanel() {
  const [tab, setTab] = useState<'providers' | 'groups' | 'templates' | 'test' | 'reports'>('providers');

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-green-500" />تنظیمات پیامک
      </h3>

      {/* Tab bar */}
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'providers'  && <ProvidersTab />}
      {tab === 'groups'     && <GroupsTab />}
      {tab === 'templates'  && <TemplatesTab />}
      {tab === 'test'       && <TestTab />}
      {tab === 'reports'    && <ReportsTab />}
    </div>
  );
}
