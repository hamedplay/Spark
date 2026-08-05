import { useState, useEffect, useRef } from 'react';
import { Mail, Lock, UserPlus, KeyRound, ArrowRight, Loader as Loader2, CircleAlert as AlertCircle, Wifi, WifiOff, Phone, Smartphone, ChevronRight, Eye, EyeOff, User } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { normalizeIranPhone } from '../lib/phoneNormalize';
import toast from 'react-hot-toast';

type AuthMode = 'login' | 'register' | 'reset';
type LoginMethod = 'username' | 'email' | 'phone';
type PasswordRecoveryStep = 'phone' | 'otp' | 'new_password' | 'success';

interface AuthPageProps {
  onSuccess: () => void;
}

interface PublicAuthConfig {
  phone_login_ready: boolean;
  phone_password_recovery_ready: boolean;
  recovery_template_ready: boolean;
  recovery_secret_confirmed: boolean;
  recovery_ttl_valid: boolean;
  recovery_ttl_seconds: number;
  phone_login_canonical_enabled: boolean;
  phone_login_canonical_ready: boolean;
  phone_password_recovery_canonical_enabled: boolean;
  phone_password_recovery_canonical_ready: boolean;
  registration_enabled: boolean;
  registration_ready: boolean;
  registration_requires_admin_approval: boolean;
  require_profile_completion: boolean;
  registration_otp_ttl_seconds: number;
  registration_otp_resend_seconds: number;
}

interface PublicLoginMethods {
  username_login: boolean;
  email_login: boolean;
  phone_login: boolean;
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
  const [loginMethods, setLoginMethods] = useState<PublicLoginMethods | null>(null);

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
    void (async () => {
      try {
        const { data: configData } = await (supabase.rpc as any)('get_public_auth_config');
        if (configData) setAuthConfig(configData as PublicAuthConfig);
      } catch { setAuthConfig(null); }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { data: configData } = await (supabase.rpc as any)('get_public_auth_config');
        setConnectionStatus(configData ? 'connected' : 'disconnected');
      } catch { setConnectionStatus('disconnected'); }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { data, error } = await (supabase.rpc as any)('get_public_login_methods');
        if (error || !data) { setLoginMethods(null); return; }
        const row = Array.isArray(data) ? data[0] : data;
        const methods: PublicLoginMethods = {
          username_login: row?.username_login === true,
          email_login: row?.email_login === true,
          phone_login: row?.phone_login === true,
        };
        setLoginMethods(methods);
        // Pick first active method
        if (methods.username_login) setLoginMethod('username');
        else if (methods.email_login) setLoginMethod('email');
        else if (methods.phone_login) setLoginMethod('phone');
      } catch { setLoginMethods(null); }
    })();
  }, []);

  // Login form state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
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
    if (recoveryCountdown <= 0) return;
    const t = setTimeout(() => setRecoveryCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [recoveryCountdown]);

  const activeMethods: LoginMethod[] = [];
  if (loginMethods?.username_login) activeMethods.push('username');
  if (loginMethods?.email_login) activeMethods.push('email');
  if (loginMethods?.phone_login) activeMethods.push('phone');

  // ── Unified password login ──────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error('شناسه ورود و رمز عبور را وارد کنید');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/password-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ method: loginMethod, identifier: identifier.trim(), password }),
      });
      const result = await res.json();
      if (res.status === 401) { toast.error('شناسه ورود یا رمز عبور صحیح نیست.'); return; }
      if (res.status === 403) { toast.error('این روش ورود در حال حاضر غیرفعال است.'); return; }
      if (res.status === 429) { toast.error('تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'); return; }
      if (res.status === 503) { toast.error('در حال حاضر امکان ورود وجود ندارد.'); return; }
      if (!res.ok || !result.access_token || !result.refresh_token) {
        toast.error('شناسه ورود یا رمز عبور صحیح نیست.');
        return;
      }
      const { data: sessData, error: sessErr } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (sessErr || !sessData.user) { toast.error('شناسه ورود یا رمز عبور صحیح نیست.'); return; }
      onSuccess();
    } catch {
      toast.error('در حال حاضر امکان ورود وجود ندارد.');
    } finally { setLoading(false); }
  };

  // ── Register ─────────────────────────────────────────────────────────────────
  type RegStep = 'details' | 'otp' | 'submitting' | 'success';
  const [regStep, setRegStep] = useState<RegStep>('details');
  const [regForm, setRegForm] = useState({ firstName: '', lastName: '', username: '', email: '', phone: '', password: '', confirmPassword: '' });
  const [regChallengeId, setRegChallengeId] = useState<string | null>(null);
  const [regOtp, setRegOtp] = useState('');
  const [regCountdown, setRegCountdown] = useState(0);
  const [regSubmitting, setRegSubmitting] = useState(false);
  const regSubmitRef = useRef(false);

  useEffect(() => {
    if (regCountdown <= 0) return;
    const t = setTimeout(() => setRegCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [regCountdown]);

  const handleRegisterRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regSubmitRef.current) return;
    regSubmitRef.current = true;
    try {
      if (!regForm.firstName.trim() || !regForm.lastName.trim()) { toast.error('نام و نام خانوادگی را وارد کنید'); return; }
      if (!regForm.username.trim() || regForm.username.trim().length < 3) { toast.error('نام کاربری باید حداقل ۳ کاراکتر باشد'); return; }
      if (!/^[a-zA-Z][a-zA-Z0-9._]*$/.test(regForm.username.trim())) { toast.error('نام کاربری باید با حرف شروع شود و فقط شامل حروف انگلیسی، عدد، نقطه و _ باشد'); return; }
      if (!regForm.email.trim() || !/^[^@]+@[^@]+\.[^@]+$/.test(regForm.email.trim())) { toast.error('ایمیل معتبر وارد کنید'); return; }
      if (!regForm.phone.trim()) { toast.error('شماره موبایل را وارد کنید'); return; }
      if (regForm.password.length < 8) { toast.error('رمز عبور باید حداقل ۸ کاراکتر باشد'); return; }
      if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(regForm.password)) { toast.error('رمز عبور باید شامل حروف و عدد باشد'); return; }
      if (regForm.password !== regForm.confirmPassword) { toast.error('رمز عبور و تکرار آن مطابقت ندارند'); return; }
      if (authConfig?.registration_ready !== true) { toast.error('ثبت‌نام در حال حاضر فعال نیست.'); return; }

      setLoading(true);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-public-registration-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ first_name: regForm.firstName.trim(), last_name: regForm.lastName.trim(), username: regForm.username.trim(), email: regForm.email.trim(), phone: regForm.phone.trim() }),
      });
      const result = await res.json();
      if (!res.ok || result.error) { toast.error(result.error || 'خطا در ارسال کد تأیید'); return; }
      setRegChallengeId(result.challenge_id);
      setRegStep('otp');
      setRegCountdown(authConfig?.registration_otp_resend_seconds ?? 60);
      toast.success('اگر اطلاعات واردشده قابل ثبت باشد، کد تأیید ارسال شده است.');
    } catch { toast.error('خطا در ارسال کد تأیید'); }
    finally { setLoading(false); regSubmitRef.current = false; }
  };

  const handleRegisterResendOtp = async () => {
    if (regCountdown > 0 || regSubmitRef.current) return;
    regSubmitRef.current = true;
    try {
      setLoading(true);
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-public-registration-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ first_name: regForm.firstName.trim(), last_name: regForm.lastName.trim(), username: regForm.username.trim(), email: regForm.email.trim(), phone: regForm.phone.trim() }),
      });
      const result = await res.json();
      if (!res.ok || result.error) { toast.error(result.error || 'خطا در ارسال مجدد کد'); return; }
      setRegChallengeId(result.challenge_id);
      setRegCountdown(authConfig?.registration_otp_resend_seconds ?? 60);
      toast.success('اگر اطلاعات واردشده قابل ثبت باشد، کد تأیید ارسال شده است.');
    } catch { toast.error('خطا در ارسال مجدد کد'); }
    finally { setLoading(false); regSubmitRef.current = false; }
  };

  const handleRegisterVerifyOtp = async () => {
    if (regSubmitRef.current) return;
    if (!regOtp.trim() || !/^\d{6}$/.test(regOtp)) { toast.error('کد تأیید باید دقیقاً ۶ رقم باشد'); return; }
    if (!regChallengeId) { toast.error('خطا در فرآیند ثبت‌نام. لطفاً دوباره تلاش کنید.'); return; }
    regSubmitRef.current = true;
    setRegSubmitting(true);
    setRegStep('submitting');
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-public-registration-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ challenge_id: regChallengeId, otp: regOtp, first_name: regForm.firstName.trim(), last_name: regForm.lastName.trim(), username: regForm.username.trim(), email: regForm.email.trim(), phone: regForm.phone.trim(), password: regForm.password }),
      });
      const result = await res.json();
      if (!res.ok || result.error) { toast.error(result.error || 'کد نامعتبر است، منقضی شده یا امکان تکمیل ثبت‌نام وجود ندارد.'); setRegStep('otp'); return; }
      if (result.session) {
        await supabase.auth.setSession({ access_token: result.session.access_token, refresh_token: result.session.refresh_token });
      }
      setRegForm({ firstName: '', lastName: '', username: '', email: '', phone: '', password: '', confirmPassword: '' });
      setRegOtp('');
      setRegChallengeId(null);
      setRegStep('success');
      onSuccess();
    } catch { toast.error('خطا در تأیید کد'); setRegStep('otp'); }
    finally { setRegSubmitting(false); regSubmitRef.current = false; }
  };

  const handleRegisterCancel = () => {
    setRegForm({ firstName: '', lastName: '', username: '', email: '', phone: '', password: '', confirmPassword: '' });
    setRegOtp('');
    setRegChallengeId(null);
    setRegStep('details');
    setRegCountdown(0);
    setMode('login');
  };

  // ── Check if recovery form should be shown ──────────────────────────────────
  const isRecoveryAvailable = authConfig?.phone_password_recovery_canonical_ready === true;

  // ── Password recovery: request OTP via edge function ───────────────────────
  const handleRequestPasswordResetOtp = async () => {
    if (!recoveryPhone.trim()) { toast.error('شماره موبایل را وارد کنید'); return; }
    const normalized = normalizeIranPhone(recoveryPhone);
    if (!normalized) { toast.error('شماره موبایل نامعتبر است'); return; }
    setRecoveryLoading(true);
    try {
      const { data } = await supabase.functions.invoke('request-phone-password-reset-otp', {
        body: { phone: recoveryPhone },
      });
      const challengeId = data?.challenge_id || crypto.randomUUID();
      setRecoveryChallengeId(challengeId);
    } catch {
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
    if (!recoveryOtp.trim() || !/^\d{6}$/.test(recoveryOtp)) { toast.error('کد تأیید باید دقیقاً ۶ رقم باشد'); return; }
    if (!recoveryChallengeId) { toast.error('خطا در فرآیند بازیابی. لطفاً دوباره تلاش کنید.'); return; }
    setRecoveryLoading(true);
    try {
      const { data } = await supabase.functions.invoke('verify-phone-password-reset-otp', {
        body: { challenge_id: recoveryChallengeId, otp: recoveryOtp },
      });
      if (!data?.ok) {
        toast.error('کد نامعتبر است، منقضی شده یا امکان ادامه بازیابی وجود ندارد.');
        return;
      }
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
      const { data } = await supabase.functions.invoke('complete-phone-password-reset', {
        body: { challenge_id: recoveryChallengeId, reset_token: recoveryResetToken, new_password: recoveryPassword },
      });
      if (!data?.ok) {
        toast.error('کد نامعتبر است، منقضی شده یا امکان ادامه بازیابی وجود ندارد.');
        return;
      }
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

  const inp = 'w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all dark:bg-gray-700 dark:text-white text-sm';

  const methodLabel: Record<LoginMethod, string> = {
    username: 'نام کاربری',
    email: 'ایمیل',
    phone: 'موبایل',
  };

  const methodPlaceholder: Record<LoginMethod, string> = {
    username: 'نام کاربری خود را وارد کنید',
    email: 'example@domain.com',
    phone: '09123456789',
  };

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
            {mode === 'login' && activeMethods.length > 0 && (
              <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 mb-6">
                {activeMethods.includes('username') && (
                  <button onClick={() => setLoginMethod('username')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${loginMethod === 'username' ? 'bg-white dark:bg-gray-600 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                    <User className="w-4 h-4" /> نام کاربری
                  </button>
                )}
                {activeMethods.includes('email') && (
                  <button onClick={() => setLoginMethod('email')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${loginMethod === 'email' ? 'bg-white dark:bg-gray-600 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                    <Mail className="w-4 h-4" /> ایمیل
                  </button>
                )}
                {activeMethods.includes('phone') && (
                  <button onClick={() => setLoginMethod('phone')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${loginMethod === 'phone' ? 'bg-white dark:bg-gray-600 text-teal-600 dark:text-teal-400 shadow-sm' : 'text-gray-500 dark:text-gray-400'}`}>
                    <Smartphone className="w-4 h-4" /> موبایل
                  </button>
                )}
              </div>
            )}

            {/* No active methods */}
            {mode === 'login' && activeMethods.length === 0 && (
              <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-4 mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">ورود در حال حاضر در دسترس نیست.</p>
              </div>
            )}

            {/* ── Unified password login form ────────────────────────────────── */}
            {mode === 'login' && activeMethods.length > 0 && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-identifier" dir="rtl" className="block w-full !text-left text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{methodLabel[loginMethod]}</label>
                  <div className="relative">
                    <input id="login-identifier" type={loginMethod === 'phone' ? 'tel' : 'text'} required value={identifier} onChange={e => setIdentifier(e.target.value)}
                      placeholder={methodPlaceholder[loginMethod]} className={inp + ' pl-10'} autoComplete="username" spellCheck={false} autoCapitalize="off" dir="ltr" disabled={loading} />
                    {loginMethod === 'username' && <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" aria-hidden="true" />}
                    {loginMethod === 'email' && <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" aria-hidden="true" />}
                    {loginMethod === 'phone' && <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" aria-hidden="true" />}
                  </div>
                </div>
                <div>
                  <label htmlFor="login-password" dir="rtl" className="block w-full !text-left text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور</label>
                  <div className="relative">
                    <input id="login-password" dir="ltr" type={showPassword ? 'text' : 'password'} required value={password} onChange={e => setPassword(e.target.value)}
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
            {mode === 'register' && authConfig?.registration_ready === true && regStep === 'details' && (
              <form onSubmit={handleRegisterRequestOtp} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نام *</label>
                    <input type="text" required value={regForm.firstName} onChange={e => setRegForm({ ...regForm, firstName: e.target.value })} placeholder="نام" className={inp} disabled={loading} />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نام خانوادگی *</label>
                    <input type="text" required value={regForm.lastName} onChange={e => setRegForm({ ...regForm, lastName: e.target.value })} placeholder="نام خانوادگی" className={inp} disabled={loading} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">نام کاربری *</label>
                  <input type="text" required value={regForm.username} onChange={e => setRegForm({ ...regForm, username: e.target.value.replace(/[^a-zA-Z0-9._]/g, '') })} placeholder="h.khaleghi" className={inp} dir="ltr" disabled={loading} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ایمیل *</label>
                  <input type="email" required value={regForm.email} onChange={e => setRegForm({ ...regForm, email: e.target.value })} placeholder="example@domain.com" className={inp} dir="ltr" disabled={loading} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">شماره موبایل *</label>
                  <input type="tel" required value={regForm.phone} onChange={e => setRegForm({ ...regForm, phone: e.target.value })} placeholder="09123456789" className={inp} dir="ltr" disabled={loading} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">رمز عبور *</label>
                  <input type="password" required value={regForm.password} onChange={e => setRegForm({ ...regForm, password: e.target.value })} placeholder="حداقل ۸ کاراکتر (حروف و عدد)" className={inp} minLength={8} disabled={loading} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تکرار رمز عبور *</label>
                  <input type="password" required value={regForm.confirmPassword} onChange={e => setRegForm({ ...regForm, confirmPassword: e.target.value })} placeholder="••••••••" className={inp} minLength={8} disabled={loading} />
                </div>
                <button type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <><UserPlus className="w-5 h-5" />ارسال کد تأیید</>}
                </button>
                <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-teal-600 dark:text-teal-400 hover:underline pt-1">
                  قبلاً حساب دارید؟ وارد شوید
                </button>
              </form>
            )}

            {/* ── Register OTP step ─────────────────────────────────────── */}
            {mode === 'register' && authConfig?.registration_ready === true && regStep === 'otp' && (
              <div className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400 text-center">کد تأیید به شماره {regForm.phone} ارسال شد.</p>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">کد تأیید</label>
                  <input type="text" value={regOtp} onChange={e => setRegOtp(e.target.value.replace(/\D/g, '').slice(0,6))} placeholder="کد ۶ رقمی" className={inp + ' text-center text-xl tracking-[0.5em] font-mono'} dir="ltr" maxLength={6} disabled={regSubmitting} />
                </div>
                <button onClick={handleRegisterVerifyOtp} disabled={regSubmitting || regOtp.length !== 6}
                  className="w-full flex items-center justify-center gap-2 bg-teal-500 hover:bg-teal-600 text-white py-3 rounded-xl font-medium transition-colors disabled:opacity-50">
                  {regSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <><ArrowRight className="w-5 h-5" />تأیید و ثبت‌نام</>}
                </button>
                <button onClick={handleRegisterResendOtp} disabled={regCountdown > 0 || regSubmitting}
                  className="w-full text-sm text-teal-600 dark:text-teal-400 disabled:text-gray-400 py-2 transition-colors">
                  {regCountdown > 0 ? `ارسال مجدد پس از ${regCountdown} ثانیه` : 'ارسال مجدد کد'}
                </button>
                <button type="button" onClick={handleRegisterCancel} className="w-full text-sm text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors py-2">
                  انصراف و بازگشت به ورود
                </button>
              </div>
            )}

            {/* ── Register submitting ─────────────────────────────────────── */}
            {mode === 'register' && regStep === 'submitting' && (
              <div className="flex justify-center py-8">
                <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
              </div>
            )}

            {/* ── Registration not ready ─────────────────────────────────────── */}
            {mode === 'register' && authConfig?.registration_ready !== true && (
              <div className="space-y-4 text-center">
                <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">ثبت‌نام در حال حاضر فعال نیست.</p>
                </div>
                <button type="button" onClick={() => setMode('login')} className="w-full text-sm text-teal-600 dark:text-teal-400 hover:underline pt-1">
                  بازگشت به ورود
                </button>
              </div>
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
                <button onClick={handleRecoveryVerifyOtp} disabled={recoveryLoading || recoveryOtp.length !== 6}
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
