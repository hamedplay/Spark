import { useState, useCallback, useEffect } from 'react';
import { MessageCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export function BaleOtpConfigCard() {
  const [loginBaleEnabled, setLoginBaleEnabled] = useState(false);
  const [recoveryBaleEnabled, setRecoveryBaleEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('system_config').select('key, value').eq('section', 'security')
      .in('key', ['phone_login_bale_otp_enabled', 'phone_password_recovery_bale_otp_enabled']);
    if (data) {
      for (const row of data) {
        if (row.key === 'phone_login_bale_otp_enabled') setLoginBaleEnabled(row.value === 'true');
        if (row.key === 'phone_password_recovery_bale_otp_enabled') setRecoveryBaleEnabled(row.value === 'true');
      }
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key: string, current: boolean) => {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_bale_auth_otp_config', { p_key: key, p_enabled: !current });
      if (error) throw error;
      if (!data || data.ok !== true) {
        const errMsg = data?.error || 'UNKNOWN';
        if (errMsg === 'FORBIDDEN') toast.error('دسترسی ادمین لازم است');
        else if (errMsg === 'INVALID_KEY') toast.error('کلید نامعتبر');
        else if (errMsg === 'PROFILE_INACTIVE') toast.error('پروفایل غیرفعال');
        else if (errMsg === 'UNAUTHORIZED') toast.error('احراز هویت لازم است');
        else toast.error('خطا در ذخیره تنظیمات');
        return;
      }
      if (key === 'phone_login_bale_otp_enabled') setLoginBaleEnabled(!current);
      if (key === 'phone_password_recovery_bale_otp_enabled') setRecoveryBaleEnabled(!current);
      toast.success('ذخیره شد');
    } catch {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400">
          <MessageCircle className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">ارسال کدهای احراز هویت در بله</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">کانال تکمیلی — پیامک کانال اصلی و الزامی باقی می‌ماند</p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">ارسال کد ورود در بله</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">کد یکبار مصرف ورود علاوه بر پیامک، در بله نیز ارسال شود</p>
          </div>
          <button onClick={() => toggle('phone_login_bale_otp_enabled', loginBaleEnabled)} disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${loginBaleEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${saving ? 'opacity-50' : ''}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${loginBaleEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">ارسال کد بازیابی رمز در بله</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">کد یکبار مصرف بازیابی رمز علاوه بر پیامک، در بله نیز ارسال شود</p>
          </div>
          <button onClick={() => toggle('phone_password_recovery_bale_otp_enabled', recoveryBaleEnabled)} disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${recoveryBaleEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${saving ? 'opacity-50' : ''}`}>
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${recoveryBaleEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
