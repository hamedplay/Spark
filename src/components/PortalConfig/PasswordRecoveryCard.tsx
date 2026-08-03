import { useState, useEffect, useCallback } from 'react';
import { KeyRound, ShieldCheck, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import toast from 'react-hot-toast';

export function PasswordRecoveryCard() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [testReady, setTestReady] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState('');
  const [testPhoneInput, setTestPhoneInput] = useState('');
  const [providerReady, setProviderReady] = useState(false);
  const [secretConfirmed, setSecretConfirmed] = useState(false);
  const [e2eVerified, setE2eVerified] = useState(false);
  const [templateReady, setTemplateReady] = useState(false);
  const [ttlValid, setTtlValid] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState(600);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testSaving, setTestSaving] = useState(false);
  const [secretSaving, setSecretSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_public_auth_config');
    const row = Array.isArray(data) ? data[0] : data;
    setEnabled(row?.phone_password_recovery_enabled ?? false);
    setReady(row?.phone_password_recovery_ready ?? false);
    setTestReady(row?.phone_password_recovery_test_ready ?? false);
    setTestMode(row?.phone_password_recovery_test_mode ?? false);
    setProviderReady(row?.provider_ready ?? false);
    setSecretConfirmed(row?.recovery_secret_confirmed ?? false);
    setE2eVerified(row?.phone_password_recovery_e2e_verified ?? false);
    setTemplateReady(row?.recovery_template_ready ?? false);
    setTtlValid(row?.recovery_ttl_valid ?? false);
    setTtlSeconds(row?.recovery_ttl_seconds ?? 600);
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('user_id', userData.user.id).maybeSingle();
      setIsAdmin(profile?.is_admin === true);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (v: boolean) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('set_phone_password_recovery_config', { p_enabled: v });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.success !== true || error) {
      const errMap: Record<string, string> = {
        NOT_AUTHENTICATED: 'احراز هویت نشده',
        NOT_ADMIN: 'فقط ادمین می‌تواند',
        PROVIDER_NOT_READY: 'سرویس‌دهنده فعال نیست',
        TEMPLATE_NOT_READY: 'قالب پیامک بازیابی ساخته نشده',
        SECRET_NOT_CONFIRMED: 'Secret بازیابی تأیید نشده',
        E2E_NOT_VERIFIED: 'تست E2E بازیابی انجام نشده',
        INVALID_TTL: 'TTL نامعتبر',
        TEST_MODE_STILL_ACTIVE: 'ابتدا حالت تست را غیرفعال کنید',
      };
      toast.error(errMap[row?.error] || error?.message || 'خطا');
      setSaving(false);
      return;
    }
    setSaving(false);
    toast.success(v ? 'بازیابی رمز با موبایل فعال شد' : 'بازیابی رمز با موبایل غیرفعال شد');
    logAudit({ module: 'security', action: v ? 'password_recovery_enabled' : 'password_recovery_disabled', entity_name: v ? 'enabled' : 'disabled', severity: 'warning' });
    await load();
  };

  const handleTestModeToggle = async (v: boolean) => {
    setTestSaving(true);
    const { data, error } = await supabase.rpc('set_phone_password_recovery_test_mode', {
      p_enabled: v,
      p_test_phone: v ? testPhoneInput : '',
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.success !== true || error) {
      const errMap: Record<string, string> = {
        NOT_AUTHENTICATED: 'احراز هویت نشده',
        NOT_ADMIN: 'فقط ادمین می‌تواند',
        PROVIDER_NOT_READY: 'سرویس‌دهنده فعال نیست',
        TEMPLATE_NOT_READY: 'قالب پیامک بازیابی ساخته نشده',
        SECRET_NOT_CONFIRMED: 'Secret بازیابی تأیید نشده',
        INVALID_TTL: 'TTL نامعتبر',
        INVALID_PHONE: 'شماره موبایل نامعتبر',
        PROFILE_NOT_FOUND: 'شماره در پروفایل فعال ثبت نشده است',
        PROFILE_DUPLICATE: 'شماره روی بیش از یک پروفایل فعال ثبت شده است',
        AUTH_PHONE_NOT_FOUND: 'شماره در Supabase Auth ثبت نشده است. ابتدا شماره را همگام کنید.',
        AUTH_PHONE_DUPLICATE: 'شماره در Auth تکراری است',
        AUTH_USER_NOT_FOUND: 'کاربر Auth برای این پروفایل یافت نشد',
        AUTH_PROFILE_MISMATCH: 'شماره Auth متعلق به Profile دیگری است',
        PHONE_NOT_UNIQUE: 'شماره موبایل منحصر به فرد نیست',
        TEST_MODE_STILL_ACTIVE: 'حالت تست هنوز فعال است',
      };
      toast.error(errMap[row?.error] || error?.message || 'خطا');
      setTestSaving(false);
      return;
    }
    setTestMode(v);
    setMaskedPhone(row?.masked_phone || '');
    setTestSaving(false);
    toast.success(v ? 'حالت تست فعال شد' : 'حالت تست غیرفعال شد');
    logAudit({ module: 'security', action: v ? 'recovery_test_mode_enabled' : 'recovery_test_mode_disabled', entity_name: v ? 'enabled' : 'disabled', severity: 'warning' });
  };

  const handleConfirmSecret = async () => {
    setSecretSaving(true);
    try {
      const { data: result } = await supabase.functions.invoke(
        'check-phone-password-reset-runtime',
        { body: {} },
      );
      if (
        result?.ok === true
        && result?.secret_configured === true
        && result?.origins_configured === true
        && result?.runtime_confirmed === true
      ) {
        toast.success('Secret بازیابی تأیید شد');
        logAudit({ module: 'security', action: 'recovery_secret_confirmed', entity_name: 'confirmed', severity: 'warning' });
        await load();
      } else {
        toast.error('Runtime بازیابی رمز کامل پیکربندی نشده است.');
      }
    } catch {
      toast.error('Runtime بازیابی رمز کامل پیکربندی نشده است.');
    }
    setSecretSaving(false);
  };

  if (loading) return null;

  const items = [
    { label: providerReady ? 'Provider آماده' : 'Provider آماده نیست', ok: providerReady },
    { label: templateReady ? 'قالب پیامک فعال' : 'قالب پیامک فعال نیست', ok: templateReady },
    { label: secretConfirmed ? 'Secret بازیابی تأیید شده' : 'Secret بازیابی تأیید نشده', ok: secretConfirmed },
    { label: ttlValid ? `TTL معتبر (${ttlSeconds} ثانیه)` : 'TTL نامعتبر', ok: ttlValid },
    { label: e2eVerified ? 'تست E2E بازیابی رمز موفق' : 'تست E2E بازیابی رمز انجام نشده', ok: e2eVerified },
    { label: enabled ? 'بازیابی رمز موبایلی فعال' : 'بازیابی رمز موبایلی غیرفعال', ok: enabled, neutral: true },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400">
            <KeyRound className="w-4.5 h-4.5" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-white">بازیابی رمز با موبایل</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {ready ? 'فعال و آماده' : 'غیرفعال'}
            </p>
          </div>
        </div>
        {isAdmin && (
          <button
            onClick={() => handleToggle(!enabled)}
            disabled={saving || testMode}
            className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${(saving || testMode) ? 'opacity-50' : ''}`}
            title={testMode ? 'ابتدا حالت تست را غیرفعال کنید' : ''}>
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
          </button>
        )}
      </div>
      <div className="mt-4 space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${item.ok ? 'bg-green-500' : item.neutral ? 'bg-gray-300 dark:bg-gray-600' : 'bg-amber-400'}`} />
            <span className={item.ok ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}>
              {item.label}
            </span>
          </div>
        ))}
      </div>

      {/* Secret confirmation button */}
      {isAdmin && !secretConfirmed && (
        <button
          onClick={handleConfirmSecret}
          disabled={secretSaving}
          className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/40 text-amber-700 dark:text-amber-400 rounded-xl text-xs font-medium transition-colors border border-amber-200 dark:border-amber-700/40">
          {secretSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
          تأیید Secret بازیابی رمز
        </button>
      )}

      {/* Test mode section */}
      {isAdmin && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-300">حالت تست</span>
            <button
              onClick={() => handleTestModeToggle(!testMode)}
              disabled={testSaving || (testMode ? false : !testReady)}
              className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${testMode ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'} ${(testSaving || (!testMode && !testReady)) ? 'opacity-50' : ''}`}
              title={!testReady && !testMode ? 'پیش‌نیازهای تست آماده نیست' : ''}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${testMode ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {testMode && maskedPhone && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">شماره تست: {maskedPhone}</p>
          )}
          {!testMode && (
            <input
              type="tel"
              value={testPhoneInput}
              onChange={e => setTestPhoneInput(e.target.value)}
              placeholder="مثال: 09123456789"
              dir="ltr"
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 transition-colors"
            />
          )}
          {!testReady && !testMode && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">پیش‌نیازها: Provider، قالب، Secret و TTL باید آماده باشند.</p>
          )}
        </div>
      )}
    </div>
  );
}
