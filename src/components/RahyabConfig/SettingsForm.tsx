import { Info, Eye, EyeOff } from 'lucide-react';
import type { RahyabSettings } from './types';
import { inp } from './types';

export function SettingsForm(props: {
  form: RahyabSettings;
  set: (k: keyof RahyabSettings, v: unknown) => void;
  showPass: boolean;
  setShowPass: (fn: (v: boolean) => boolean) => void;
}) {
  const { form, set, showPass, setShowPass } = props;

  return (
    <div className="space-y-5">
      {/* Security note */}
      <div className="flex items-start gap-3 px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-2xl">
        <Info className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed space-y-1">
          <p className="font-medium">نکات امنیتی</p>
          <p>برای امنیت بیشتر از فیلد <strong>توکن</strong> به جای نام کاربری استفاده کنید. در صورت وجود توکن، نام کاربری نادیده گرفته می‌شود.</p>
          <p>آدرس وب‌سرویس: <span className="font-mono">http://RahvabBulk.ir/WebService/sms.asmx</span></p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">توکن (اولویت اول)</label>
            <input className={inp} value={form.token} onChange={e => set('token', e.target.value)}
              placeholder="برای امنیت بیشتر از توکن استفاده کنید" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نام کاربری</label>
            <input className={inp} value={form.username} onChange={e => set('username', e.target.value)}
              placeholder="نام کاربری پنل رهیاب رایان" dir="ltr" />
          </div>
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">کلمه عبور</label>
            <input className={inp + ' pl-10'} type={showPass ? 'text' : 'password'}
              value={form.password} onChange={e => set('password', e.target.value)} dir="ltr"
              placeholder="حداقل ۵ کاراکتر" />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute left-3 top-8 text-gray-400 hover:text-gray-600 transition-colors">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره اختصاصی *</label>
            <input className={inp} value={form.short_code} onChange={e => set('short_code', e.target.value)}
              placeholder="مثال: 5000123" dir="ltr" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس وب‌سرویس SOAP</label>
            <input className={inp} value={form.soap_url} onChange={e => set('soap_url', e.target.value)} dir="ltr" />
            <p className="text-xs text-gray-400 mt-1">
              گزینه‌های جایگزین: <span className="font-mono">https://RahvabBulk.ir:8443/WebService/sms.asmx</span>
            </p>
          </div>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3 pt-1">
          <button type="button" onClick={() => set('is_active', !form.is_active)}
            className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${form.is_active ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <span className="text-sm text-gray-700 dark:text-gray-300">این سرویس فعال است</span>
        </div>
      </div>
    </div>
  );
}
