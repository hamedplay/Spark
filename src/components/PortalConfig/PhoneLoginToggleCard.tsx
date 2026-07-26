import { useState, useCallback, useEffect } from 'react';
import { Smartphone, Loader as Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import toast from 'react-hot-toast';

export function PhoneLoginToggleCard() {
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [testReady, setTestReady] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [operatorConfirmed, setOperatorConfirmed] = useState(false);
  const [e2eVerified, setE2eVerified] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testPhoneMasked, setTestPhoneMasked] = useState('');
  const [testPhoneInput, setTestPhoneInput] = useState('');
  const [providerId, setProviderId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingTest, setSavingTest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminStatus, setAdminStatus] = useState<{ test_mode: boolean; test_phone_masked: string; provider_ready: boolean; operator_confirmed: boolean; e2e_verified: boolean; public_enabled: boolean; otp_ttl_seconds: number | null; otp_ttl_operator_confirmed: boolean; lock_seconds: number | null } | null>(null);
  const [otpTtlInput, setOtpTtlInput] = useState('');
  const [savingTtl, setSavingTtl] = useState(false);
  const [editTtl, setEditTtl] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_public_auth_config');
    const row = Array.isArray(data) ? data[0] : data;
    setEnabled(row?.phone_login_enabled ?? false);
    setReady(row?.phone_login_ready ?? false);
    setTestReady(row?.phone_login_test_ready ?? false);
    setProviderReady(row?.provider_ready ?? false);
    setOperatorConfirmed(row?.operator_confirmed ?? false);
    setE2eVerified(row?.e2e_verified ?? false);
    setTestMode(row?.phone_login_test_mode ?? false);
    const { data: providerRow } = await supabase
      .from('system_config').select('value').eq('section', 'sms').eq('key', 'phone_login_sms_provider_id').maybeSingle();
    const providerValue = providerRow?.value?.trim();
    setProviderId(providerValue ? providerValue : null);
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user) {
      const { data: profile } = await supabase.from('profiles').select('is_admin').eq('user_id', userData.user.id).maybeSingle();
      const admin = profile?.is_admin === true;
      setIsAdmin(admin);
      if (admin) {
        const { data: adminData } = await supabase.rpc('get_phone_login_admin_status');
        const aRow = Array.isArray(adminData) ? adminData[0] : adminData;
        setAdminStatus(aRow ?? null);
        setTestPhoneMasked(aRow?.test_phone_masked ?? '');
        setTestMode(aRow?.test_mode ?? false);
        setTestReady(row?.phone_login_test_ready ?? false);
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleToggle = async (v: boolean) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('set_phone_login_config', { p_enabled: v, p_provider_id: providerId || null });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.success !== true || error) {
      toast.error(row?.error || error?.message || 'خطا در ذخیره تنظیمات');
      setSaving(false);
      return;
    }
    setEnabled(v);
    setReady(v && testReady && e2eVerified);
    setSaving(false);
    toast.success(v ? 'ورود با موبایل فعال شد' : 'ورود با موبایل غیرفعال شد');
  };

  const handleTestModeToggle = async (v: boolean) => {
    if (v && !testReady) { toast.error('پیش‌نیازهای تست آماده نیست (Provider یا Auth Hook)'); return; }
    if (v && !testPhoneInput) { toast.error('شماره تست وارد کنید'); return; }
    setSavingTest(true);
    const { data, error } = await supabase.rpc('set_phone_login_test_mode', { p_test_mode: v, p_test_phone: v ? testPhoneInput : null });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.success !== true || error) {
      const errMap: Record<string, string> = {
        NOT_AUTHENTICATED: 'احراز هویت نشده', NOT_ADMIN: 'فقط ادمین می‌تواند', NO_PROVIDER: 'سرویس‌دهنده انتخاب نشده',
        PROVIDER_NOT_READY: 'سرویس‌دهنده فعال نیست', OPERATOR_NOT_CONFIRMED: 'Auth Hook تأیید نشده', INVALID_PHONE: 'شماره نامعتبر',
        PHONE_NOT_IN_ACTIVE_PROFILE: 'شماره در پروفایل فعال نیست', PHONE_NOT_IN_AUTH: 'شماره در Auth نیست', PHONE_DUPLICATE: 'شماره تکراری است',
        PHONE_DUPLICATE_PROFILE: 'این شماره روی بیش از یک پروفایل فعال ثبت شده است', AUTH_PROFILE_MISMATCH: 'عدم تطابق Auth و Profile',
        TTL_NOT_CONFIRMED: 'ابتدا TTL واقعی OTP را تأیید کنید', PUBLIC_LOGIN_ENABLED: 'ورود عمومی فعال است؛ ابتدا آن را غیرفعال کنید',
      };
      toast.error(errMap[row?.error] || error?.message || 'خطا');
      setSavingTest(false);
      return;
    }
    setTestMode(v);
    const maskedPhone = row?.test_phone_masked || 'masked';
    setTestPhoneMasked(v ? maskedPhone : '');
    setTestPhoneInput('');
    setSavingTest(false);
    toast.success(v ? 'حالت تست فعال شد' : 'حالت تست غیرفعال شد');
    logAudit({ module: 'security', action: v ? 'test_mode_enabled' : 'test_mode_disabled', entity_name: v ? maskedPhone : 'disabled', severity: 'warning' });
  };

  if (loading) return null;

  const otpTtlConfirmed = adminStatus?.otp_ttl_operator_confirmed ?? false;
  const otpTtlSeconds = adminStatus?.otp_ttl_seconds ?? null;
  const lockSeconds = adminStatus?.lock_seconds ?? null;

  const handleConfirmTtl = async () => {
    const ttl = parseInt(otpTtlInput, 10);
    if (isNaN(ttl) || ttl < 60 || ttl > 86400) { toast.error('مقدار TTL باید بین ۶۰ و ۸۶۴۰۰ ثانیه باشد'); return; }
    setSavingTtl(true);
    const { data, error } = await supabase.rpc('set_phone_login_otp_ttl', { p_ttl_seconds: ttl });
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.success !== true || error) { toast.error(row?.error || error?.message || 'خطا در ثبت TTL'); setSavingTtl(false); return; }
    setAdminStatus(prev => prev ? { ...prev, otp_ttl_seconds: ttl, otp_ttl_operator_confirmed: true, lock_seconds: row.lock_seconds } : prev);
    setOtpTtlInput(''); setEditTtl(false); setSavingTtl(false);
    toast.success('TTL ثبت و تأیید شد');
    logAudit({ module: 'security', action: 'otp_ttl_confirmed', entity_name: `${ttl}s`, severity: 'warning' });
  };

  const readinessItems = [
    { label: providerReady ? 'Provider آماده' : 'Provider آماده نیست', ok: providerReady },
    { label: 'Edge Function Secrets نیازمند تأیید اپراتور', ok: false, neutral: true },
    { label: operatorConfirmed ? 'Auth Hook تأیید شده' : 'Auth Hook تأیید نشده', ok: operatorConfirmed },
    { label: otpTtlConfirmed ? 'TTL OTP تأیید شده' : 'TTL OTP تأیید نشده', ok: otpTtlConfirmed },
    { label: testMode ? 'حالت تست فعال' : 'حالت تست غیرفعال', ok: testMode, neutral: true },
    { label: e2eVerified ? 'تست E2E موفق' : 'تست E2E انجام نشده', ok: e2eVerified, neutral: true },
    { label: enabled ? 'ورود عمومی فعال' : 'ورود عمومی غیرفعال', ok: enabled, neutral: true },
  ];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
            <Smartphone className="w-4.5 h-4.5" />
          </div>
          <div>
            <h4 className="font-semibold text-gray-800 dark:text-white">ورود با شماره موبایل</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400">{ready ? 'فعال و آماده' : 'غیرفعال'}</p>
          </div>
        </div>
        <button onClick={() => handleToggle(!enabled)} disabled={saving}
          className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'} ${saving ? 'opacity-50' : ''}`}>
          <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
        </button>
      </div>
      <div className="mt-4 space-y-1.5">
        {readinessItems.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${item.ok ? 'bg-green-500' : item.neutral ? 'bg-gray-300 dark:bg-gray-600' : 'bg-amber-400'}`} />
            <span className={item.ok ? 'text-gray-600 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500'}>{item.label}</span>
          </div>
        ))}
      </div>
      {isAdmin && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">تأیید TTL واقعی OTP</p>
              {otpTtlConfirmed ? (
                <span className="text-[10px] bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-1.5 py-0.5 rounded-full">تأیید شده</span>
              ) : (
                <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">تأیید نشده</span>
              )}
            </div>
            {otpTtlSeconds !== null && (<p className="text-xs text-gray-500 dark:text-gray-400">TTL ثبت‌شده: {otpTtlSeconds} ثانیه</p>)}
            {lockSeconds !== null && (<p className="text-xs text-gray-500 dark:text-gray-400">Lock محاسبه‌شده: {lockSeconds} ثانیه</p>)}
            {otpTtlConfirmed && !editTtl && (
              <button onClick={() => { setEditTtl(true); setOtpTtlInput(otpTtlSeconds !== null ? String(otpTtlSeconds) : ''); }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline">ویرایش و تأیید مجدد TTL</button>
            )}
            {(!otpTtlConfirmed || editTtl) && (
              <div className="flex gap-2">
                <input type="number" value={otpTtlInput} onChange={e => setOtpTtlInput(e.target.value)}
                  placeholder="TTL واقعی Dashboard (ثانیه)"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors" />
                <button onClick={handleConfirmTtl} disabled={savingTtl}
                  className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors whitespace-nowrap">ثبت و تأیید</button>
                {editTtl && (
                  <button onClick={() => { setEditTtl(false); setOtpTtlInput(''); }}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors whitespace-nowrap">انصراف</button>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">حالت تست ورود موبایلی</p>
              <p className="text-xs text-gray-400">فقط برای شماره تعیین‌شده OTP ارسال می‌کند</p>
            </div>
            <button onClick={() => handleTestModeToggle(!testMode)} disabled={savingTest || !testReady}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${testMode ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600'} ${(savingTest || !testReady) ? 'opacity-50' : ''}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${testMode ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">شماره مجاز برای تست</label>
            {testMode ? (
              <p className="text-sm font-mono text-gray-600 dark:text-gray-400 px-3 py-2 bg-gray-50 dark:bg-gray-700 rounded-xl">{testPhoneMasked || '****'}</p>
            ) : (
              <input type="tel" value={testPhoneInput} onChange={e => setTestPhoneInput(e.target.value)} placeholder="09xxxxxxxxx"
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
