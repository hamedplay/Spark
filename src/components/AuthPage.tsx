import { useState, useEffect } from 'react';
import { Mail, Lock, UserPlus, KeyRound, ArrowRight, Loader as Loader2, CircleAlert as AlertCircle, Wifi, WifiOff, User, Phone, Smartphone, ChevronRight, Eye, EyeOff } from 'lucide-react';
import { supabase, ensureProfile, handleSupabaseError, testSupabaseConnection } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { normalizeIranPhone } from '../lib/phoneNormalize';
import toast from 'react-hot-toast';

type AuthMode = 'login' | 'register' | 'reset';
type LoginMethod = 'email' | 'phone';
type PasswordRecoveryStep = 'phone' | 'otp' | 'new_password' | 'success';

interface AuthPageProps {
  onSuccess: () => void;
}

interface PublicAuthConfig {
  phone_login_enabled: boolean;
  phone_login_ready: boolean;
  phone_login_test_mode: boolean;
  phone_login_test_ready: boolean;
  phone_password_recovery_ready: boolean;
  phone_password_recovery_test_mode: boolean;
  phone_password_recovery_test_ready: boolean;
  recovery_template_ready: boolean;
  recovery_secret_confirmed: boolean;
  recovery_ttl_valid: boolean;
  recovery_ttl_seconds: number;
  phone_password_recovery_e2e_verified: boolean;
}

export function AuthPage({ onSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginMethod, setLoginMethod] = useState<LoginMethod>('email');
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [siteTitle, setSiteTitle] = useState('اسپارک سامانه هوشمند مدیریت سازمانی');
  const [siteDescription, setSiteDescription] = useState('مدیریت حرفه‌ای جلسات، پیگیری اقدامات و همکاری تیمی در یک پلتفرم');
  const [, setLogoUrl] = useState('');
  const [authConfig, setAuthConfig] = useState<PublicAuthConfig | null>(null);

  useEffect(() => {
    supabase.from('system_config').select('key,value,section').in('key', ['site_title', 'site_description', 'logo_url']).then(({ data }) => {
      if (!data) return;
      data.forEach(row => {
        if (row.key === 'site_title' && row.value) setSiteTitle(row.value);
        if (row.key === 'site_description' && row.value) setSiteDescription(row.value);
        if (row.key === 'logo_url' && row.value) setLogoUrl(row.value);
      });
    });
  }, []);

  useEffect(() => {
    supabase.rpc('get_public_auth_config').then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      setAuthConfig(row ?? { phone_login_enabled: false, phone_login_ready: false, phone_login_test_mode: false, phone_login_test_ready: false, phone_password_recovery_ready: false, phone_password_recovery_test_mode: false, phone_password_recovery_test_ready: false, recovery_template_ready: false, recovery_secret_confirmed: false, recovery_ttl_valid: false, recovery_ttl_seconds: 600, phone_password_recovery_e2e_verified: false });
    }).catch(() => setAuthConfig({ phone_login_enabled: false, phone_login_ready: false, phone_login_test_mode: false, phone_login_test_ready: false, phone_password_recovery_ready: false, phone_password_recovery_test_mode: false, phone_password_recovery_test_ready: false, recovery_template_ready: false, recovery_secret_confirmed: false, recovery_ttl_valid: false, recovery_ttl_seconds: 600, phone_password_recovery_e2e_verified: false }));
  }, []);

  // Email/password form
  const [form, setForm] = useState({ email: '', password: '', confirmPassword: '', fullName: '', username: '' });

  // Phone OTP form
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [showPassword, setShowPassword] = useState(false);

  // ── Password recovery state (scoped challenge, no Supabase session) ─
  const [recoveryStep, setRecoveryStep] = useState<PasswordRecoveryStep>('phone');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [recoveryCountdown, setRecoveryCountdown] = useState(0);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryShowPassword, setRecoveryShowPassword] = useState(false);
  const [recoveryChallengeId, setRecoveryChallengeId] = useState<string | null>(null);
  const [recoveryResetToken, setRecoveryResetToken] = useState<string | null>(null);

  useEffect(() => {
    testSupabaseConnection().then(ok => setConnectionStatus(ok ? 'connected' : 'disconnected')).catch(() => setConnectionStatus('disconnected'));
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    if (recoveryCountdown <= 0) return;
    const t = setTimeout(() => setRecoveryCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [recoveryCountdown]);

  // ── Email/username login ─────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('نام کاربری/ایمیل و رمز عبور را وارد کنید'); return; }
    setLoading(true);
    try {
      const identifier = form.email.trim();
      const isEmail = identifier.includes('@');
      let userId: string | undefined;
      let auditLabel = identifier;
      if (isEmail) {
        const { data, error } = await supabase.auth.signInWithPassword({ email: identifier, password: form.password });
        if (error || !data.user) { toast.error('نام کاربری، ایمیل یا رمز عبور صحیح نیست.'); return; }
        userId = data.user.id;
        auditLabel = identifier;
      } else {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/username-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ username: identifier, password: form.password }),
        });
        if (res.status === 401) { toast.error('نام کاربری، ایمیل یا رمز عبور صحیح نیست.'); return; }
        if (res.status === 503) { toast.error('در حال حاضر امکان ورود وجود ندارد. لطفاً دوباره تلاش کنید.'); return; }
        if (!res.ok) { toast.error('در حال حاضر امکان ورود وجود ندارد. لطفاً دوباره تلاش کنید.'); return; }
        const session = await res.json();
        if (!session.access_token || !session.refresh_token) { toast.error('نام کاربری، ایمیل یا رمز عبور صحیح نیست.'); return; }
        const { data: sessData, error: sessErr } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
        if (sessErr || !sessData.user) { toast.error('نام کاربری، ایمیل یا رمز عبور صحیح نیست.'); return; }
        userId = sessData.user.id;
        auditLabel = identifier;
      }
      if (userId) {
        const { data: profileData } = await supabase.from('profiles').select('is_active').eq('user_id', userId).maybeSingle();
        if (profileData && profileData.is_active === false) {
          await supabase.auth.signOut();
          toast.error('حساب کاربری شما غیرفعال شده است. لطفاً با مدیر خود در تماس باشید.', { duration: 6000 });
          return;
        }
        await ensureProfile(userId, '');
        toast.success('با موفقیت وارد شدید');
        logAudit({ module: 'auth', action: 'login', entity_name: 'user', entity_id: userId, details: `ورود: ${auditLabel}`, severity: 'info' });
        onSuccess();
      }
    } catch (err: any) { toast.error('در حال حاضر امکان ورود وجود ندارد. لطفاً دوباره تلاش کنید.'); }
    finally { setLoading(false); }
  };

  // ── Register ─────────────────────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) { toast.error('ایمیل و رمز عبور را وارد کنید'); return; }
    if (form.password.length < 6) { toast.error('رمز عبور باید حداقل ۶ کاراکتر باشد'); return; }
    if (form.password !== form.confirmPassword) { toast.error('رمز عبور و تکرار آن مطابقت ندارند'); return; }
    if (!form.fullName.trim()) { toast.error('نام و نام خانوادگی را وارد کنید'); return; }
    if (!form.username.trim()) { toast.error('نام کاربری را وارد کنید'); return; }
    if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(form.username.trim()) || form.username.trim().length < 3) {
      toast.error('نام کاربری باید با حرف شروع شود و فقط شامل حروف انگلیسی، عدد، نقطه و _ باشد (حداقل ۳ کاراکتر)');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ email: form.email.trim(), password: form.password, full_name: form.fullName.trim() }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) { toast.error(result.error || 'خطا در ثبت‌نام'); return; }
      if (result.session) {
        await supabase.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token });
      }
      // Save username to profile
      if (result.user?.id) {
        await supabase.from('profiles').update({ username: form.username.trim() }).eq('user_id', result.user.id);
      }
      toast.success('حساب کاربری ایجاد شد');
      logAudit({ module: 'auth', action: 'register', entity_name: 'user', entity_id: result.user?.id, details: `ثبت‌نام: ${form.email.trim()}`, severity: 'info' });
      onSuccess();
    } catch (err: any) { toast.error('خطا در ثبت‌نام'); }
    finally { setLoading(false); }
  };

  // ── Check if recovery form should be shown ──────────────────────────────────
  const isRecoveryAvailable = authConfig?.phone_password_recovery_ready === true
    || (authConfig?.phone_password_recovery_test_mode === true
        && authConfig?.phone_password_recovery_test_ready === true);

  // ── Password recovery: request OTP via edge function ───────────────────────
  const handleRequestPasswordResetOtp = async () => {
    if (!recoveryPhone.trim()) { toast.error('شماره موبایل را وارد کنید'); return; }
    const normalized = normalizeIranPhone(recoveryPhone);
    if (!normalized) { toast.error('شماره موبایل نامعتبر است'); return; }
    setRecoveryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('request-phone-password-reset-otp', {
        body: { phone: recoveryPhone },
      });
      // Always store challenge_id (real or decoy) — response is identical
      const challengeId = data?.challenge_id || crypto.randomUUID();
      setRecoveryChallengeId(challengeId);
    } catch {
      // Generate a decoy challenge_id so the flow looks identical
      setRecoveryChallengeId(crypto.randomUUID());
    } finally {
      setRecoveryLoading(false);
    }
    setRecoveryStep('otp');
    setRecoveryCountdown(60);
    toast.success('اگر شماره واردشده متعلق به یک حساب فعال باشد، کد بازیابی ارسال می‌شود.');
  };

  // ── Password recovery: verify OTP via edge function ─────────────────────────
  const handleRecoveryVerifyOtp = async () => {
    if (!recoveryOtp.trim() || recoveryOtp.length < 4) { toast.error('کد تأیید را وارد کنید'); return; }
    if (!recoveryChallengeId) { toast.error('خطا در فرآیند بازیابی. لطفاً دوباره تلاش کنید.'); return; }
    setRecoveryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('verify-phone-password-reset-otp', {
        body: { challenge_id: recoveryChallengeId, otp: recoveryOtp },
      });
      if (error || !data?.ok) {
        toast.error('کد نامعتبر است، منقضی شده یا امکان ادامه بازیابی وجود ندارد.');
        return;
      }
      // Store reset token in memory only (not localStorage)
      setRecoveryResetToken(data.reset_token);
      setRecoveryStep('new_password');
    } catch {
      toast.error('خطا در تأیید کد');
    } finally { setRecoveryLoading(false); }
  };

  // ── Password recovery: set new password via edge function ────────────────────
  const handleRecoverySetPassword = async () => {
    if (recoveryPassword.length < 8) { toast.error('رمز عبور باید حداقل ۸ کاراکتر باشد'); return; }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(recoveryPassword)) { toast.error('رمز عبور باید شامل حروف و عدد باشد'); return; }
    if (recoveryPassword !== recoveryConfirmPassword) { toast.error('رمز عبور و تکرار آن مطابقت ندارند'); return; }
    if (!recoveryChallengeId || !recoveryResetToken) { toast.error('خطا در فرآیند بازیابی. لطفاً دوباره تلاش کنید.'); return; }
    setRecoveryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('complete-phone-password-reset', {
        body: { challenge_id: recoveryChallengeId, reset_token: recoveryResetToken, new_password: recoveryPassword },
      });
      if (error || !data?.ok) {
        toast.error('کد نامعتبر است، منقضی شده یا امکان ادامه بازیابی وجود ندارد.');
        return;
      }
      // Clear all sensitive state
      setRecoveryPhone('');
      setRecoveryOtp('');
      setRecoveryPassword('');
      setRecoveryConfirmPassword('');
      setRecoveryChallengeId(null);
      setRecoveryResetToken(null);
      setRecoveryStep('success');
      toast.success('رمز عبور با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید.');
    } catch {
      toast.error('خطا در تغییر رمز عبور');
    } finally { setRecoveryLoading(false); }
  };

  // ── Password recovery: cancel ───────────────────────────────────────────────
  const handleRecoveryCancel = () => {
    setRecoveryPhone('');
    setRecoveryOtp('');
    setRecoveryPassword('');
    setRecoveryConfirmPassword('');
    setRecoveryChallengeId(null);
    setRecoveryResetToken(null);
    setRecoveryStep('phone');
    setRecoveryCountdown(0);
    setMode('login');
  };

  // ── Phone OTP ─────────────────────────────────────────────────────────────────
  const handleSendOtp = async () => {
    if (!phone.trim()) { toast.error('شماره موبایل را وارد کنید'); return; }
    const isPublicReady = authConfig?.phone_login_ready === true;
    const isTestModeActive = authConfig?.phone_login_test_mode === true && authConfig?.phone_login_test_ready === true;
    if (!isPublicReady && !isTestModeActive) { toast.error('ورود با شماره موبایل در حال حاضر فعال نیست.'); return; }
    const normalized = normalizeIranPhone(phone);
    if (!normalized) { toast.error('شماره موبایل نامعتبر است'); return; }
    void normalized;
    setOtpLoading(true);
    try {
      // Use server-side edge function to prevent enumeration
      // Always returns the same response regardless of whether the phone exists
      await supabase.functions.invoke('request-phone-login-otp', {
        body: { phone },
      });
      // Always show the same message — never reveal whether the phone exists
      setOtpSent(true);
      setCountdown(60);
      toast.success('اگر شماره معتبر و سرویس در دسترس باشد، کد ورود ارسال می‌شود.');
    } catch (err: any) {
      // Same generic message on error
      setOtpSent(true);
      setCountdown(60);
      toast.success('اگر شماره معتبر و سرویس در دسترس باشد، کد ورود ارسال می‌شود.');
    }
    finally { setOtpLoading(false); }
  };

  const handleVerifyOtp = async () => {
    if (!otp.trim() || otp.length < 4) { toast.error('کد تأیید را وارد کنید'); return; }
    const normalized = normalizeIranPhone(phone);
    if (!normalized) { toast.error('شماره موبایل نامعتبر است'); return; }
    const e164 = `+${normalized}`;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({ phone: e164, token: otp, type: 'sms' });
      if (error) { toast.error('کد نادرست است یا منقضی شده'); return; }
      if (data.user) {
        const { data: profileData } = await supabase.from('profiles').select('user_id, phone, is_active').eq('user_id', data.user.id).maybeSingle();
        // Profile must exist — do NOT create via ensureProfile for OTP users
        if (!profileData) {
          await supabase.auth.signOut();
          toast.error('حساب کاربری یافت نشد. لطفاً با مدیر خود در تماس باشید.', { duration: 6000 });
          return;
        }
        if (profileData.is_active !== true) {
          await supabase.auth.signOut();
          toast.error('حساب کاربری شما غیرفعال شده است. لطفاً با مدیر خود در تماس باشید.', { duration: 6000 });
          return;
        }
        // Compare normalized phone numbers (auth vs profile vs OTP) — all three must match
        const authPhone = normalizeIranPhone(data.user.phone);
        const profilePhone = normalizeIranPhone(profileData.phone);
        const otpPhone = normalizeIranPhone(phone);
        if (!profilePhone || profilePhone !== otpPhone) {
          await supabase.auth.signOut();
          toast.error('شماره موبایل با حساب کاربری تطابق ندارد.', { duration: 6000 });
          return;
        }
        if (!authPhone) {
          await supabase.auth.signOut();
          toast.error('شماره این حساب هنوز در Supabase Auth همگام نشده است.', { duration: 6000 });
          return;
        }
        if (authPhone !== otpPhone) {
          await supabase.auth.signOut();
          toast.error('شماره موبایل با حساب کاربری تطابق ندارد.', { duration: 6000 });
          return;
        }
        toast.success('با موفقیت وارد شدید');
        logAudit({ module: 'auth', action: 'phone_otp_login', entity_name: 'user', entity_id: data.user.id, details: 'ورود با کد یک‌بارمصرف موبایلی', severity: 'info' });
        onSuccess();
      }
    } catch (err: any) { toast.error('خطا در تأیید کد'); }
    finally { setLoading(false); }
  };

  const inp = 'w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all dark:bg-gray-700 dark:text-white text-sm';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-teal-50 via-gray-50 to-blue-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-800 px-4" dir="rtl">
      <div className="w-full max-w-5xl flex flex-col lg:flex-row rounded-3xl shadow-2xl overflow-hidden bg-white dark:bg-gray-800">

        {/* Left panel (decorative) */}
        <div className="hidden lg:flex w-5/12 flex-col relative overflow-hidden">
          <img src="/photo-1600880292203-757bb62b4baf.jpg"
            alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-br from-teal-800/80 to-teal-600/70" />
          <div className="relative flex flex-col items-center justify-center h-full text-white p-10">
            <div className="w-24 h-24 rounded-3xl bg-white/20 backdrop-blur flex items-center justify-center mb-6 overflow-hidden shadow-lg">
              <img src="/logo_spark.png" alt="Spark" className="w-full h-full object-contain p-2" />
            </div>
            <h1 className="text-3xl font-bold text-center leading-tight mb-3">{siteTitle}</h1>
            <p className="text-center text-teal-100 text-base leading-relaxed">
              {siteDescription}
            </p>
            <div className="mt-10 space-y-3 w-full max-w-xs">
              {['مدیریت و زمان‌بندی جلسات', 'چت سازمانی امن', 'ویدیو کنفرانس HD', 'تقویم شمسی یکپارچه', 'گزارشات تحلیلی'].map(f => (
                <div key={f} className="flex items-center gap-3 text-teal-100 text-sm">
                  <div className="w-1.5 h-1.5 rounded-full bg-teal-300" />
                  {f}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: form */}
        <div className="flex-1 p-8 md:p-12 flex flex-col justify-center">
          <div className="max-w-sm mx-auto w-full">

            {/* Logo — mobile only (desktop sees it in left panel) */}
            <div className="flex justify-center mb-5 lg:hidden">
              <img src="/logo_spark.png" alt="Spark" className="w-20 h-20 object-contain" />
            </div>

            {/* Connection status */}
            <div className="flex justify-center mb-6">
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                connectionStatus === 'connected' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                connectionStatus === 'disconnected' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                {connectionStatus === 'connected' ? <><Wifi className="w-3 h-3" />متصل</> :
                 connectionStatus === 'disconnected' ? <><WifiOff className="w-3 h-3" />قطع اتصال</> :
                 <><Loader2 className="w-3 h-3 animate-spin" />در حال بررسی...</>}
              </div>
            </div>

            <h2 className="text-2xl font-bold text-gray-800 dark:text-white text-center mb-8">
              {mode === 'login' ? 'ورود به سیستم' : mode === 'register' ? 'ثبت‌نام' : 'بازیابی رمز'}
            </h2>

            {/* Login method tabs (only on login) */}
            {mode === 'login' && (() => {
              const isPublicReady = authConfig?.phone_login_ready === true;
              const isTestModeActive = authConfig?.phone_login_test_mode === true && authConfig?.phone_login_test_ready === true;
              const phoneTabEnabled = isPublicReady || isTestModeActive;
              const isTestBadge = !isPublicReady && isTestModeActive;
              return (
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 mb-6">
                <button onClick={() => setLoginMethod('email')}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${loginMethod === 'email' ? 'bg-white dark:bg-gray-600 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                  <Mail className="w-4 h-4" /> ایمیل
                </button>
                <button onClick={() => setLoginMethod('phone')}
                  disabled={!phoneTabEnabled}
                  className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${loginMethod === 'phone' ? 'bg-white dark:bg-gray-600 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'} ${!phoneTabEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                  <Smartphone className="w-4 h-4" /> موبایل
                  {isTestBadge && <span className="text-[10px] bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full">حالت تست</span>}
                </button>
              </div>
              );
            })()}

            {/* ── Phone OTP login ────────────────────────────────────── */}
            {mode === 'login' && loginMethod === 'phone' && (() => {
              const isPublicReady = authConfig?.phone_login_ready === true;
              const isTestModeActive = authConfig?.phone_login_test_mode === true && authConfig?.phone_login_test_ready === true;
              const showForm = isPublicReady || isTestModeActive;
              return (
              <div className="space-y-4">
                {isTestModeActive && !isPublicReady && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>حالت تست فعال است. فقط شماره تعیین‌شده می‌تواند کد دریافت کند.</span>
                  </div>
                )}
                {!showForm && (
                  <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-3 flex gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>ورود با شماره موبایل در حال حاضر فعال نیست.</span>
                  </div>
                )}
                {showForm && (
                <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره موبایل</label>
                  <div className="relative">
                    <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="   مثال: 09123456789"
                      className={inp} dir="ltr" disabled={otpSent} />
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                {otpSent && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">کد تأیید</label>
                    <input type="text" value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0,6))}
                      placeholder="کد ۶ رقمی" className={inp + ' text-center text-xl tracking-[0.5em] font-mono'} dir="ltr" maxLength={6} />
                  </div>
                )}
                {!otpSent ? (
                  <button onClick={handleSendOtp} disabled={otpLoading || !phone}
                    className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                    {otpLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Smartphone className="w-5 h-5" />ارسال کد تأیید</>}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <button onClick={handleVerifyOtp} disabled={loading || otp.length < 4}
                      className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                      {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" />تأیید و ورود</>}
                    </button>
                    <button onClick={() => { if (countdown === 0) { setOtpSent(false); setOtp(''); } }}
                      disabled={countdown > 0}
                      className="w-full text-sm text-teal-600 dark:text-teal-400 disabled:text-gray-400 py-2 transition-colors">
                      {countdown > 0 ? `ارسال مجدد پس از ${countdown} ثانیه` : 'ارسال مجدد کد'}
                    </button>
                  </div>
                )}
                </>
                )}
                <button onClick={() => setLoginMethod('email')} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors py-2">
                  ورود با ایمیل
                </button>
              </div>
              );
            })()}

            {/* ── Email login ────────────────────────────────────── */}
            {mode === 'login' && loginMethod === 'email' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-identifier" dir="rtl" className="block w-full !text-left text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نام کاربری یا ایمیل</label>
                  <div className="relative">
                    <input id="login-identifier" type="text" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="نام کاربری یا ایمیل خود را وارد کنید" className={inp + ' pl-10'} autoComplete="username" spellCheck={false} autoCapitalize="off" dir="ltr" disabled={loading} />
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" aria-hidden="true" />
                  </div>
                </div>
                <div>
                  <label htmlFor="login-password" dir="rtl" className="block w-full !text-left text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور</label>
                  <div className="relative">
                    <input id="login-password" dir="ltr" type={showPassword ? 'text' : 'password'} required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="••••••••" className={inp + ' pl-10 pr-10 !text-left'} autoComplete="current-password" disabled={loading} />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" aria-hidden="true" />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                      aria-label={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'} aria-pressed={showPassword}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" />ورود</>}
                </button>
                <div className="flex justify-between text-sm pt-1">
                  <button type="button" onClick={() => setMode('reset')} className="text-teal-600 dark:text-teal-400 hover:underline">فراموشی رمز</button>
                  <button type="button" onClick={() => setMode('register')} className="text-teal-600 dark:text-teal-400 hover:underline">ثبت‌نام</button>
                </div>
              </form>
            )}

            {/* ── Register ─────────────────────────────────────── */}
            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نام و نام خانوادگی *</label>
                  <div className="relative">
                    <input type="text" required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })}
                      placeholder="نام کامل خود را وارد کنید" className={inp} disabled={loading} />
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نام کاربری *</label>
                  <div className="relative">
                    <input type="text" required value={form.username}
                      onChange={e => setForm({ ...form, username: e.target.value.replace(/[^a-zA-Z0-9._]/g, '') })}
                      placeholder="h.khaleghi" className={inp} dir="ltr" disabled={loading} />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-bold">@</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1 mr-1">مثال: h.khaleghi — حروف انگلیسی، عدد، نقطه و _</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ایمیل * <span className="text-xs text-gray-400 font-normal">(برای ثبت‌نام)</span></label>
                  <div className="relative">
                    <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                      placeholder="example@domain.com" className={inp} dir="ltr" disabled={loading} />
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور *</label>
                  <div className="relative">
                    <input type="password" required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                      placeholder="حداقل ۶ کاراکتر" className={inp} minLength={6} disabled={loading} />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تکرار رمز عبور *</label>
                  <div className="relative">
                    <input type="password" required value={form.confirmPassword} onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
                      placeholder="••••••••" className={inp} minLength={6} disabled={loading} />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><UserPlus className="w-5 h-5" />ایجاد حساب</>}
                </button>
                <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-teal-600 dark:text-teal-400 hover:underline pt-1">
                  قبلاً حساب دارید؟ وارد شوید
                </button>
              </form>
            )}

            {/* ── Password recovery (scoped challenge) ──────────────────── */}
            {mode === 'reset' && !isRecoveryAvailable && (
              <div className="space-y-4 text-center">
                <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">بازیابی رمز با موبایل در حال حاضر فعال نیست.</p>
                </div>
                <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-teal-600 dark:text-teal-400 hover:underline pt-1">
                  <span className="flex items-center justify-center gap-1"><ChevronRight className="w-4 h-4" />بازگشت به ورود</span>
                </button>
              </div>
            )}

            {mode === 'reset' && isRecoveryAvailable && recoveryStep === 'phone' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">بازیابی رمز عبور<br />شماره موبایل خود را وارد کنید تا کد تأیید برایتان ارسال شود.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره موبایل</label>
                  <div className="relative">
                    <input type="tel" value={recoveryPhone} onChange={e => setRecoveryPhone(e.target.value)}
                      placeholder="مثال: 09123456789" className={inp} dir="ltr" disabled={recoveryLoading} />
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                <button onClick={handleRequestPasswordResetOtp} disabled={recoveryLoading || !recoveryPhone.trim()}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {recoveryLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><Smartphone className="w-5 h-5" />ارسال کد بازیابی</>}
                </button>
                <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-teal-600 dark:text-teal-400 hover:underline pt-1">
                  <span className="flex items-center justify-center gap-1"><ChevronRight className="w-4 h-4" />بازگشت به ورود</span>
                </button>
              </div>
            )}

            {mode === 'reset' && recoveryStep === 'otp' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">اگر شماره واردشده متعلق به یک حساب فعال باشد، کد بازیابی ارسال می‌شود.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">کد تأیید</label>
                  <input type="text" value={recoveryOtp} onChange={e => setRecoveryOtp(e.target.value.replace(/\D/g, '').slice(0,6))}
                    placeholder="کد ۶ رقمی" className={inp + ' text-center text-xl tracking-[0.5em] font-mono'} dir="ltr" maxLength={6} />
                </div>
                <button onClick={handleRecoveryVerifyOtp} disabled={recoveryLoading || recoveryOtp.length < 4}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {recoveryLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" />تأیید کد</>}
                </button>
                <button onClick={() => { if (recoveryCountdown === 0) { handleRequestPasswordResetOtp(); } }}
                  disabled={recoveryCountdown > 0}
                  className="w-full text-sm text-teal-600 dark:text-teal-400 disabled:text-gray-400 py-2 transition-colors">
                  {recoveryCountdown > 0 ? `ارسال مجدد پس از ${recoveryCountdown} ثانیه` : 'ارسال مجدد کد'}
                </button>
                <button type="button" onClick={handleRecoveryCancel} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors py-2">
                  انصراف و بازگشت به ورود
                </button>
              </div>
            )}

            {mode === 'reset' && recoveryStep === 'new_password' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">رمز عبور جدید را وارد کنید.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور جدید</label>
                  <div className="relative">
                    <input type={recoveryShowPassword ? 'text' : 'password'} value={recoveryPassword}
                      onChange={e => setRecoveryPassword(e.target.value)}
                      placeholder="حداقل ۸ کاراکتر (حروف و عدد)" className={inp + ' pl-10 pr-10'} dir="ltr"
                      autoComplete="new-password" minLength={8} disabled={recoveryLoading} />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <button type="button" onClick={() => setRecoveryShowPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-1 rounded-md">
                      {recoveryShowPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تکرار رمز عبور جدید</label>
                  <div className="relative">
                    <input type={recoveryShowPassword ? 'text' : 'password'} value={recoveryConfirmPassword}
                      onChange={e => setRecoveryConfirmPassword(e.target.value)}
                      placeholder="••••••••" className={inp + ' pl-10'} dir="ltr"
                      autoComplete="new-password" minLength={8} disabled={recoveryLoading} />
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                  </div>
                </div>
                <button onClick={handleRecoverySetPassword} disabled={recoveryLoading}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {recoveryLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><KeyRound className="w-5 h-5" />تغییر رمز عبور</>}
                </button>
                <button type="button" onClick={handleRecoveryCancel} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors py-2">
                  انصراف و بازگشت به ورود
                </button>
              </div>
            )}

            {mode === 'reset' && recoveryStep === 'success' && (
              <div className="space-y-4 text-center">
                <div className="w-16 h-16 rounded-2xl bg-green-50 dark:bg-green-900/30 flex items-center justify-center mx-auto">
                  <KeyRound className="w-8 h-8 text-green-500" />
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-300">رمز عبور با موفقیت تغییر کرد. اکنون با رمز جدید وارد شوید.</p>
                <button type="button" onClick={() => { setRecoveryStep('phone'); setMode('login'); }}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors">
                  <ArrowRight className="w-5 h-5" />بازگشت به ورود
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
