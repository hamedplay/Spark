import { useState } from 'react';
import { Globe, Save, Loader as Loader2, Eye, EyeOff, Info, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { SmsProvider } from './types';
import { inp, PROVIDER_TYPES } from './types';
import { SmsToggle as Toggle } from '../ConfigToggle';

export function ProviderForm({ provider, onSave, onCancel }: {
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
  const blankRahyabRest: Partial<SmsProvider> = {
    title: '', provider_name: 'rahyab_rest', provider_type: 'rahyab_rest', is_public_gateway: false,
    api_url: 'https://rahyabbulk.ir:8443/', api_key: '', line_number: '',
    sender_number: '', is_active: false, username: '', password: '', token: '', is_default: false,
  };

  const [form, setForm] = useState<Partial<SmsProvider>>(provider ? { ...provider } : blankRest);
  const [saving, setSaving] = useState(false);
  const [showPass, setShowPass] = useState(false);

  const set = (k: keyof SmsProvider, v: any) => setForm(f => ({ ...f, [k]: v }));
  const isRahyab = form.provider_type === 'rahyab';
  const isRahyabRest = form.provider_type === 'rahyab_rest';

  const switchType = (type: string) => {
    if (type === 'rahyab') setForm(f => ({ ...blankRahyab, title: f.title || '' }));
    else if (type === 'rahyab_rest') setForm(f => ({ ...blankRahyabRest, title: f.title || '' }));
    else setForm(f => ({ ...blankRest, title: f.title || '' }));
  };

  const handleSave = async () => {
    if (!form.title?.trim()) { toast.error('عنوان الزامی است'); return; }
    if ((isRahyab || isRahyabRest) && !form.username?.trim() && !form.token?.trim()) {
      toast.error('نام کاربری یا توکن الزامی است'); return;
    }
    if ((isRahyab || isRahyabRest) && !form.line_number?.trim()) {
      toast.error(isRahyabRest ? 'شماره فرستنده الزامی است' : 'شماره اختصاصی الزامی است'); return;
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

      {/* REST fields (sms.ir only — not shown for rahyab SOAP or rahyab REST) */}
      {!isRahyab && !isRahyabRest && (
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

      {/* Rahyab SOAP fields */}
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

      {/* Rahyab REST fields */}
      {isRahyabRest && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
              می‌توانید <strong>توکن</strong> را به جای نام کاربری استفاده کنید. در این حالت مقدار Username برابر توکن خواهد بود و Password می‌تواند هر رشته تصادفی حداقل ۵ کاراکتری باشد. این روش باعث می‌شود نام کاربری و رمز عبور اصلی افشا نشوند.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">توکن (اختیاری — جایگزین نام کاربری)</label>
              <input className={inp} value={form.token || ''} onChange={e => set('token', e.target.value)}
                placeholder="اگر توکن دارید اینجا وارد کنید" dir="ltr" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نام کاربری {form.token?.trim() ? '(نادیده گرفته می‌شود — توکن فعال است)' : '*'}</label>
              <input className={inp} value={form.username || ''} onChange={e => set('username', e.target.value)}
                placeholder="نام کاربری پنل رهیاب" dir="ltr"
                disabled={!!form.token?.trim()} />
            </div>
            <div className="relative">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">کلمه عبور *</label>
              <input className={inp + ' pl-10'} type={showPass ? 'text' : 'password'}
                value={form.password || ''} onChange={e => set('password', e.target.value)}
                placeholder="حداقل ۵ کاراکتر" dir="ltr" />
              <button type="button" onClick={() => setShowPass(v => !v)} className="absolute left-3 top-8 text-gray-400 hover:text-gray-600 transition-colors">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره فرستنده (from) *</label>
              <input className={inp} value={form.line_number || ''} onChange={e => set('line_number', e.target.value)}
                placeholder="مثال: 50001805" dir="ltr" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس پایه API</label>
              <input className={inp} value={form.api_url || ''} onChange={e => set('api_url', e.target.value)} dir="ltr" />
              <p className="text-xs text-gray-400 mt-1 font-mono">پیش‌فرض: https://rahyabbulk.ir:8443/</p>
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
