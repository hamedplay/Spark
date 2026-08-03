import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, CircleCheck as CheckCircle2, Circle as XCircle, TriangleAlert as AlertTriangle, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface RuntimeStatus {
  bale_channel_active: boolean;
  bale_bot_token_set: boolean;
  bale_bot_username_set: boolean;
  bale_login_template_ready: boolean;
  bale_recovery_template_ready: boolean;
  bale_mapping_count: number;
  bale_auth_codes_enabled_count: number;
}

interface DispatchSummary {
  counts: {
    sent: number;
    failed: number;
    skipped: number;
    processing: number;
    total: number;
  };
  last_error_code: string | null;
  last_status: string | null;
  last_purpose: string | null;
  last_at: string | null;
}

export function BaleOtpConfigCard() {
  const [loginBaleEnabled, setLoginBaleEnabled] = useState(false);
  const [recoveryBaleEnabled, setRecoveryBaleEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [dispatch, setDispatch] = useState<DispatchSummary | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const load = useCallback(async () => {
    const [cfgRes, rtRes, dispRes] = await Promise.all([
      supabase
        .from('system_config')
        .select('key, value')
        .eq('section', 'security')
        .in('key', ['phone_login_bale_otp_enabled', 'phone_password_recovery_bale_otp_enabled']),
      supabase.rpc('get_auth_runtime_status'),
      supabase.rpc('get_bale_auth_dispatch_summary'),
    ]);

    if (cfgRes.data) {
      for (const row of cfgRes.data) {
        if (row.key === 'phone_login_bale_otp_enabled') setLoginBaleEnabled(row.value === 'true');
        if (row.key === 'phone_password_recovery_bale_otp_enabled') setRecoveryBaleEnabled(row.value === 'true');
      }
    }

    if (rtRes.data && rtRes.data.ok) {
      setRuntime({
        bale_channel_active: rtRes.data.bale_channel_active,
        bale_bot_token_set: rtRes.data.bale_bot_token_set,
        bale_bot_username_set: rtRes.data.bale_bot_username_set,
        bale_login_template_ready: rtRes.data.bale_login_template_ready,
        bale_recovery_template_ready: rtRes.data.bale_recovery_template_ready,
        bale_mapping_count: rtRes.data.bale_mapping_count,
        bale_auth_codes_enabled_count: rtRes.data.bale_auth_codes_enabled_count,
      });
    }

    if (dispRes.data && dispRes.data.ok) {
      setDispatch(dispRes.data);
    }

    setLoadingStatus(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (key: string, current: boolean) => {
    setSaving(true);
    try {
      const { data, error } = await supabase
        .rpc('set_bale_auth_otp_config', { p_key: key, p_enabled: !current });
      if (error) throw error;
      if (!data || data.ok !== true) {
        const errMsg = data?.error || 'UNKNOWN';
        const errMap: Record<string, string> = {
          FORBIDDEN: 'دسترسی ادمین لازم است',
          INVALID_KEY: 'کلید نامعتبر',
          PROFILE_INACTIVE: 'پروفایل غیرفعال',
          UNAUTHORIZED: 'احراز هویت لازم است',
          BALE_CHANNEL_INACTIVE: 'کانال بله فعال نیست',
          BALE_BOT_TOKEN_MISSING: 'توکن ربات بله تنظیم نشده',
          BALE_BOT_USERNAME_MISSING: 'نام کاربری ربات بله تنظیم نشده',
          BALE_TEMPLATE_NOT_READY: 'قالب پیام بله آماده نیست یا {{otp}} ندارد',
          CONFIG_NOT_FOUND: 'رکورد پیکربندی یافت نشد',
        };
        toast.error(errMap[errMsg] || 'خطا در ذخیره تنظیمات');
        return;
      }
      if (key === 'phone_login_bale_otp_enabled') setLoginBaleEnabled(!current);
      if (key === 'phone_password_recovery_bale_otp_enabled') setRecoveryBaleEnabled(!current);
      toast.success('ذخیره شد');
      await load();
    } catch {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setSaving(false);
    }
  };

  const prerequisiteOk = runtime?.bale_channel_active && runtime?.bale_bot_token_set && runtime?.bale_bot_username_set;
  const loginTemplateOk = runtime?.bale_login_template_ready ?? false;
  const recoveryTemplateOk = runtime?.bale_recovery_template_ready ?? false;

  const purposeLabel = (purpose: string | null): string => {
    if (purpose === 'phone_login') return 'ورود';
    if (purpose === 'phone_password_recovery') return 'بازیابی رمز';
    return purpose || '—';
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

      {/* Runtime status */}
      {loadingStatus ? (
        <div className="flex items-center gap-2 text-xs text-gray-400 mb-3">
          <Loader2 className="w-3 h-3 animate-spin" /> بارگذاری وضعیت...
        </div>
      ) : runtime ? (
        <div className="space-y-1.5 mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <div className="flex items-center gap-2 text-xs">
            {runtime.bale_channel_active
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <XCircle className="w-3.5 h-3.5 text-red-500" />}
            <span className="text-gray-600 dark:text-gray-300">کانال بله: {runtime.bale_channel_active ? 'فعال' : 'غیرفعال'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {runtime.bale_bot_token_set
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <XCircle className="w-3.5 h-3.5 text-red-500" />}
            <span className="text-gray-600 dark:text-gray-300">توکن ربات: {runtime.bale_bot_token_set ? 'تنظیم شده' : 'تنظیم نشده'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {runtime.bale_bot_username_set
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <XCircle className="w-3.5 h-3.5 text-red-500" />}
            <span className="text-gray-600 dark:text-gray-300">نام کاربری ربات: {runtime.bale_bot_username_set ? 'تنظیم شده' : 'تنظیم نشده'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {loginTemplateOk
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <XCircle className="w-3.5 h-3.5 text-red-500" />}
            <span className="text-gray-600 dark:text-gray-300">قالب ورود: {loginTemplateOk ? 'آماده' : 'نامعتبر'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {recoveryTemplateOk
              ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
              : <XCircle className="w-3.5 h-3.5 text-red-500" />}
            <span className="text-gray-600 dark:text-gray-300">قالب بازیابی: {recoveryTemplateOk ? 'آماده' : 'نامعتبر'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500 dark:text-gray-400">کاربران متصل: {runtime.bale_mapping_count}</span>
            <span className="text-gray-300 dark:text-gray-600">|</span>
            <span className="text-gray-500 dark:text-gray-400">با کد احراز هویت: {runtime.bale_auth_codes_enabled_count}</span>
          </div>
        </div>
      ) : null}

      {/* Dispatch summary */}
      {dispatch && (
        <div className="space-y-1 mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <p className="text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">آخرین وضعیت ارسال OTP</p>
          <div className="flex flex-wrap gap-3 text-xs text-gray-500 dark:text-gray-400">
            <span>ارسال شده: {dispatch.counts.sent}</span>
            <span>خطا: {dispatch.counts.failed}</span>
            <span>رد شده: {dispatch.counts.skipped}</span>
            <span>در حال: {dispatch.counts.processing}</span>
          </div>
          {dispatch.last_error_code && (
            <div className="flex items-center gap-1.5 text-xs mt-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              <span className="text-gray-500 dark:text-gray-400">
                آخرین خطا: {dispatch.last_error_code} ({purposeLabel(dispatch.last_purpose)})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Toggles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">ارسال کد ورود در بله</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">کد یکبار مصرف ورود علاوه بر پیامک، در بله نیز ارسال شود</p>
            {!prerequisiteOk && (
              <p className="text-[10px] text-red-500 dark:text-red-400 mt-1">پیش‌نیازها کامل نیست — کانال، توکن یا نام کاربری بله تنظیم نشده</p>
            )}
          </div>
          <button
            onClick={() => toggle('phone_login_bale_otp_enabled', loginBaleEnabled)}
            disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${loginBaleEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${saving ? 'opacity-50' : ''}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${loginBaleEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">ارسال کد بازیابی رمز در بله</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">کد یکبار مصرف بازیابی رمز علاوه بر پیامک، در بله نیز ارسال شود</p>
            {!prerequisiteOk && (
              <p className="text-[10px] text-red-500 dark:text-red-400 mt-1">پیش‌نیازها کامل نیست — کانال، توکن یا نام کاربری بله تنظیم نشده</p>
            )}
          </div>
          <button
            onClick={() => toggle('phone_password_recovery_bale_otp_enabled', recoveryBaleEnabled)}
            disabled={saving}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${recoveryBaleEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${saving ? 'opacity-50' : ''}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${recoveryBaleEnabled ? 'left-7' : 'left-1'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
