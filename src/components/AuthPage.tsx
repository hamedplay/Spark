import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MonitorUp,
  Phone,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  UserPlus,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { normalizeIranPhone } from '../lib/phoneNormalize';
import { invokeEdgeFunctionWithTimeout } from '../lib/invokeEdgeFunction';
import OtpCodeInput from '../features/auth/components/OtpCodeInput';

type AuthMode = 'login' | 'register' | 'reset';
type LoginTab = 'password' | 'phone_otp';
type CredentialMethod = 'username' | 'email' | 'phone';
type PhoneOtpStep = 'phone' | 'otp';
type PasswordRecoveryStep = 'phone' | 'otp' | 'new_password' | 'success';
type RegistrationStep = 'details' | 'otp' | 'submitting';

interface AuthPageProps {
  onSuccess: () => void;
}

interface PublicAuthConfig {
  phone_login_ready: boolean;
  phone_password_recovery_canonical_ready: boolean;
  phone_login_canonical_enabled: boolean;
  registration_ready: boolean;
  registration_otp_resend_seconds: number;
}

interface PublicLoginMethods {
  username_login: boolean;
  email_login: boolean;
  phone_login: boolean;
}

interface RegistrationForm {
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMPTY_REGISTRATION: RegistrationForm = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

function firstObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isValidOtpTimer(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 30 && value <= 300;
}

function maskPhone(phone: string): string {
  const normalized = phone.trim();
  if (normalized.length <= 7) return normalized;
  return `${normalized.slice(0, 4)}${'*'.repeat(normalized.length - 7)}${normalized.slice(-3)}`;
}

export function AuthPage({ onSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loginTab, setLoginTab] = useState<LoginTab>('password');
  const [credentialMethod, setCredentialMethod] = useState<CredentialMethod>('username');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberIdentifier, setRememberIdentifier] = useState(true);
  const [loading, setLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [authConfig, setAuthConfig] = useState<PublicAuthConfig | null>(null);
  const [loginMethods, setLoginMethods] = useState<PublicLoginMethods>({
    username_login: true,
    email_login: true,
    phone_login: false,
  });
  const [authConfigLoading, setAuthConfigLoading] = useState(true);

  const [phoneOtpStep, setPhoneOtpStep] = useState<PhoneOtpStep>('phone');
  const [phoneOtpPhone, setPhoneOtpPhone] = useState('');
  const [phoneOtpCode, setPhoneOtpCode] = useState('');
  const [phoneOtpError, setPhoneOtpError] = useState('');
  const [phoneOtpChallengeId, setPhoneOtpChallengeId] = useState<string | null>(null);
  const [phoneOtpResendSeconds, setPhoneOtpResendSeconds] = useState(0);
  const [phoneOtpExpiresSeconds, setPhoneOtpExpiresSeconds] = useState(0);
  const [phoneOtpLoading, setPhoneOtpLoading] = useState(false);
  const phoneOtpRequestRef = useRef(false);
  const phoneOtpVerifyRef = useRef(false);

  const [recoveryStep, setRecoveryStep] = useState<PasswordRecoveryStep>('phone');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryOtpError, setRecoveryOtpError] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirmPassword, setRecoveryConfirmPassword] = useState('');
  const [recoveryShowPassword, setRecoveryShowPassword] = useState(false);
  const [recoveryCountdown, setRecoveryCountdown] = useState(0);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryChallengeId, setRecoveryChallengeId] = useState<string | null>(null);
  const [recoveryResetToken, setRecoveryResetToken] = useState<string | null>(null);

  const [registrationStep, setRegistrationStep] = useState<RegistrationStep>('details');
  const [registrationForm, setRegistrationForm] = useState<RegistrationForm>(EMPTY_REGISTRATION);
  const [registrationOtp, setRegistrationOtp] = useState('');
  const [registrationOtpError, setRegistrationOtpError] = useState('');
  const [registrationChallengeId, setRegistrationChallengeId] = useState<string | null>(null);
  const [registrationCountdown, setRegistrationCountdown] = useState(0);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const registrationRequestRef = useRef(false);

  const loadAuthConfig = useCallback(async () => {
    setAuthConfigLoading(true);
    try {
      const [authResult, methodsResult] = await Promise.all([
        supabase.rpc('get_public_auth_config'),
        supabase.rpc('get_public_login_methods'),
      ]);
      const authValue = Array.isArray(authResult.data) ? authResult.data[0] : authResult.data;
      const methodsValue = Array.isArray(methodsResult.data) ? methodsResult.data[0] : methodsResult.data;
      const authRow = firstObject(authValue);
      const methodsRow = firstObject(methodsValue);

      if (authResult.error || !authRow) {
        setAuthConfig(null);
        setConnectionStatus('disconnected');
      } else {
        setAuthConfig(authRow as unknown as PublicAuthConfig);
        setConnectionStatus('connected');
      }

      if (methodsRow) {
        const nextMethods: PublicLoginMethods = {
          username_login: methodsRow.username_login === true,
          email_login: methodsRow.email_login === true,
          phone_login: methodsRow.phone_login === true,
        };
        setLoginMethods(nextMethods);
        setCredentialMethod(current => {
          if (current === 'username' && nextMethods.username_login) return current;
          if (current === 'email' && nextMethods.email_login) return current;
          if (current === 'phone' && nextMethods.phone_login) return current;
          if (nextMethods.username_login) return 'username';
          if (nextMethods.email_login) return 'email';
          return 'phone';
        });
      }
    } catch {
      setConnectionStatus('disconnected');
      setAuthConfig(null);
    } finally {
      setAuthConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAuthConfig();
  }, [loadAuthConfig]);

  useEffect(() => {
    try {
      const savedIdentifier = localStorage.getItem('spark_login_identifier');
      const savedMethod = localStorage.getItem('spark_login_method') as CredentialMethod | null;
      if (savedIdentifier) setIdentifier(savedIdentifier);
      if (savedMethod === 'username' || savedMethod === 'email' || savedMethod === 'phone') {
        setCredentialMethod(savedMethod);
      }
    } catch {
      // Hardened/private contexts may deny storage access; login still works.
    }
  }, []);

  useEffect(() => {
    if (phoneOtpResendSeconds <= 0) return;
    const timeout = setTimeout(() => setPhoneOtpResendSeconds(value => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [phoneOtpResendSeconds]);

  useEffect(() => {
    if (phoneOtpExpiresSeconds <= 0) return;
    const timeout = setTimeout(() => setPhoneOtpExpiresSeconds(value => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [phoneOtpExpiresSeconds]);

  useEffect(() => {
    if (phoneOtpExpiresSeconds === 0 && phoneOtpStep === 'otp' && phoneOtpChallengeId) {
      setPhoneOtpChallengeId(null);
      setPhoneOtpCode('');
      setPhoneOtpStep('phone');
      toast.error('کد تأیید منقضی شده است. لطفاً دوباره درخواست ارسال کد کنید.');
    }
  }, [phoneOtpChallengeId, phoneOtpExpiresSeconds, phoneOtpStep]);

  useEffect(() => {
    if (recoveryCountdown <= 0) return;
    const timeout = setTimeout(() => setRecoveryCountdown(value => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [recoveryCountdown]);

  useEffect(() => {
    if (registrationCountdown <= 0) return;
    const timeout = setTimeout(() => setRegistrationCountdown(value => value - 1), 1000);
    return () => clearTimeout(timeout);
  }, [registrationCountdown]);

  const handlePasswordLogin = async (event: FormEvent) => {
    event.preventDefault();
    if (!identifier.trim() || !password) {
      toast.error('شناسه ورود و رمز عبور را وارد کنید');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/password-login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          method: credentialMethod,
          identifier: identifier.trim(),
          password,
        }),
      });
      const result = await response.json().catch(() => ({}));

      if (response.status === 401) { toast.error('شناسه ورود یا رمز عبور صحیح نیست.'); return; }
      if (response.status === 403) { toast.error('این روش ورود در حال حاضر غیرفعال است.'); return; }
      if (response.status === 429) { toast.error('تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'); return; }
      if (response.status === 503) { toast.error('در حال حاضر امکان ورود وجود ندارد.'); return; }
      if (!response.ok || !isNonEmptyString(result.access_token) || !isNonEmptyString(result.refresh_token)) {
        toast.error('شناسه ورود یا رمز عبور صحیح نیست.');
        return;
      }

      const { data, error } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (error || !data.user) {
        toast.error('شناسه ورود یا رمز عبور صحیح نیست.');
        return;
      }

      try {
        if (rememberIdentifier) {
          localStorage.setItem('spark_login_identifier', identifier.trim());
          localStorage.setItem('spark_login_method', credentialMethod);
        } else {
          localStorage.removeItem('spark_login_identifier');
          localStorage.removeItem('spark_login_method');
        }
      } catch {
        // Remembering the identifier is optional and must never block authentication.
      }
      onSuccess();
    } catch {
      toast.error('در حال حاضر امکان ورود وجود ندارد.');
    } finally {
      setLoading(false);
    }
  };

  const requestPhoneOtp = async (phone: string) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-phone-login-otp-v2`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ phone }),
    });
    const result = await response.json().catch(() => ({}));

    if (response.status === 400) { toast.error('شماره موبایل نامعتبر است'); throw new Error('INVALID_PHONE'); }
    if (response.status === 429) {
      const retry = typeof result.retry_after_seconds === 'number' ? result.retry_after_seconds : 60;
      toast.error(`محدودیت درخواست. ${retry} ثانیه بعد تلاش کنید.`);
      throw new Error('RATE_LIMITED');
    }
    if (!response.ok || result.ok !== true || !isValidUuid(result.challenge_id) ||
      !isValidOtpTimer(result.retry_after_seconds) || !isValidOtpTimer(result.expires_in_seconds) ||
      result.retry_after_seconds > result.expires_in_seconds) {
      toast.error('ورود پیامکی در دسترس نیست');
      throw new Error('UNAVAILABLE');
    }

    setPhoneOtpChallengeId(result.challenge_id);
    setPhoneOtpResendSeconds(result.retry_after_seconds);
    setPhoneOtpExpiresSeconds(result.expires_in_seconds);
    setPhoneOtpCode('');
    setPhoneOtpError('');
    setPhoneOtpStep('otp');
    toast.success('کد تأیید ارسال شد.');
  };

  const phoneOtpLoadingRefReset = () => {
    setPhoneOtpLoading(false);
    phoneOtpRequestRef.current = false;
  };

  const handlePhoneOtpRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (phoneOtpRequestRef.current || !phoneOtpPhone.trim()) return;
    phoneOtpRequestRef.current = true;
    setPhoneOtpLoading(true);
    try {
      await requestPhoneOtp(phoneOtpPhone.trim());
    } catch {
      // requestPhoneOtp surfaces a safe user-facing message.
    } finally {
      phoneOtpLoadingRefReset();
    }
  };

  const handlePhoneOtpVerify = async () => {
    if (phoneOtpVerifyRef.current) return;
    if (!/^\d{6}$/.test(phoneOtpCode) || !phoneOtpChallengeId) {
      const message = 'کد تأیید باید دقیقاً ۶ رقم باشد';
      setPhoneOtpError(message);
      toast.error(message);
      return;
    }
    setPhoneOtpError('');
    phoneOtpVerifyRef.current = true;
    setPhoneOtpLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-phone-login-otp-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          challenge_id: phoneOtpChallengeId,
          phone: phoneOtpPhone.trim(),
          otp: phoneOtpCode,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) { const message = 'کد اشتباه یا منقضی شده است'; setPhoneOtpError(message); toast.error(message); return; }
      if (response.status === 429) { toast.error('تعداد تلاش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.'); return; }
      if (!response.ok || !isNonEmptyString(result.access_token) || !isNonEmptyString(result.refresh_token)) {
        toast.error('ورود پیامکی در دسترس نیست');
        return;
      }
      const { data, error } = await supabase.auth.setSession({
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      });
      if (error || !data.user) { toast.error('ورود پیامکی در دسترس نیست'); return; }
      onSuccess();
    } catch {
      toast.error('ورود پیامکی در دسترس نیست');
    } finally {
      setPhoneOtpLoading(false);
      phoneOtpVerifyRef.current = false;
    }
  };

  const handlePhoneOtpResend = async () => {
    if (phoneOtpRequestRef.current || phoneOtpResendSeconds > 0 || phoneOtpExpiresSeconds <= 0) return;
    phoneOtpRequestRef.current = true;
    setPhoneOtpLoading(true);
    try {
      await requestPhoneOtp(phoneOtpPhone.trim());
    } catch {
      // requestPhoneOtp surfaces a safe user-facing message.
    } finally {
      phoneOtpLoadingRefReset();
    }
  };

  const openRecovery = () => {
    setMode('reset');
    setRecoveryStep('phone');
    void loadAuthConfig();
  };

  const handleRecoveryRequest = async () => {
    if (!normalizeIranPhone(recoveryPhone)) {
      toast.error('شماره موبایل نامعتبر است');
      return;
    }
    setRecoveryLoading(true);
    try {
      const result = await invokeEdgeFunctionWithTimeout<{ ok?: boolean; challenge_id?: unknown }>(
        'request-phone-password-reset-otp',
        { phone: recoveryPhone },
      );
      if (result.ok !== true || !isValidUuid(result.challenge_id)) throw new Error('INVALID_RECOVERY_RESPONSE');
      setRecoveryChallengeId(result.challenge_id);
      setRecoveryOtp('');
      setRecoveryOtpError('');
      setRecoveryStep('otp');
      setRecoveryCountdown(60);
      toast.success('اگر شماره واردشده متعلق به یک حساب فعال باشد، کد بازیابی ارسال می‌شود.');
    } catch {
      toast.error('ارسال کد بازیابی انجام نشد. لطفاً دوباره تلاش کنید.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleRecoveryVerify = async () => {
    if (!/^\d{6}$/.test(recoveryOtp) || !recoveryChallengeId) {
      const message = 'کد تأیید باید دقیقاً ۶ رقم باشد';
      setRecoveryOtpError(message);
      toast.error(message);
      return;
    }
    setRecoveryOtpError('');
    setRecoveryLoading(true);
    try {
      const result = await invokeEdgeFunctionWithTimeout<{ ok?: boolean; reset_token?: unknown }>(
        'verify-phone-password-reset-otp',
        { challenge_id: recoveryChallengeId, otp: recoveryOtp },
      );
      if (result.ok !== true || !isNonEmptyString(result.reset_token)) {
        const message = 'کد نامعتبر است یا منقضی شده است.';
        setRecoveryOtpError(message);
        toast.error(message);
        return;
      }
      setRecoveryResetToken(result.reset_token);
      setRecoveryStep('new_password');
    } catch {
      const message = 'خطا در تأیید کد';
      setRecoveryOtpError(message);
      toast.error(message);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleRecoveryComplete = async () => {
    if (recoveryPassword.length < 8 || !/(?=.*[a-zA-Z])(?=.*\d)/.test(recoveryPassword)) {
      toast.error('رمز عبور باید حداقل ۸ کاراکتر و شامل حروف و عدد باشد');
      return;
    }
    if (recoveryPassword !== recoveryConfirmPassword) {
      toast.error('رمز عبور و تکرار آن مطابقت ندارند');
      return;
    }
    if (!recoveryChallengeId || !recoveryResetToken) return;

    setRecoveryLoading(true);
    try {
      const result = await invokeEdgeFunctionWithTimeout<{ ok?: boolean }>(
        'complete-phone-password-reset',
        {
          challenge_id: recoveryChallengeId,
          reset_token: recoveryResetToken,
          new_password: recoveryPassword,
        },
        30_000,
      );
      if (result.ok !== true) {
        toast.error('امکان تغییر رمز عبور وجود ندارد. لطفاً دوباره تلاش کنید.');
        return;
      }
      setRecoveryStep('success');
      toast.success('رمز عبور با موفقیت تغییر کرد.');
    } catch {
      toast.error('خطا در تغییر رمز عبور');
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleRegistrationRequest = async (event?: FormEvent) => {
    event?.preventDefault();
    if (registrationRequestRef.current) return;
    if (!registrationForm.firstName.trim() || !registrationForm.lastName.trim()) { toast.error('نام و نام خانوادگی را وارد کنید'); return; }
    if (!/^[a-zA-Z][a-zA-Z0-9._]{2,}$/.test(registrationForm.username.trim())) { toast.error('نام کاربری معتبر وارد کنید'); return; }
    if (!/^[^@]+@[^@]+\.[^@]+$/.test(registrationForm.email.trim())) { toast.error('ایمیل معتبر وارد کنید'); return; }
    if (!normalizeIranPhone(registrationForm.phone)) { toast.error('شماره موبایل معتبر وارد کنید'); return; }
    if (registrationForm.password.length < 8 || !/(?=.*[a-zA-Z])(?=.*\d)/.test(registrationForm.password)) { toast.error('رمز عبور باید حداقل ۸ کاراکتر و شامل حروف و عدد باشد'); return; }
    if (registrationForm.password !== registrationForm.confirmPassword) { toast.error('رمز عبور و تکرار آن مطابقت ندارند'); return; }
    if (authConfig?.registration_ready !== true) { toast.error('ثبت‌نام در حال حاضر فعال نیست.'); return; }

    registrationRequestRef.current = true;
    setRegistrationLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/request-public-registration-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          first_name: registrationForm.firstName.trim(),
          last_name: registrationForm.lastName.trim(),
          username: registrationForm.username.trim(),
          email: registrationForm.email.trim(),
          phone: registrationForm.phone.trim(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !isValidUuid(result.challenge_id)) {
        toast.error(result.error || 'خطا در ارسال کد تأیید');
        return;
      }
      setRegistrationChallengeId(result.challenge_id);
      setRegistrationOtp('');
      setRegistrationOtpError('');
      setRegistrationStep('otp');
      setRegistrationCountdown(authConfig?.registration_otp_resend_seconds ?? 60);
      toast.success('اگر اطلاعات قابل ثبت باشد، کد تأیید ارسال شده است.');
    } catch {
      toast.error('خطا در ارسال کد تأیید');
    } finally {
      setRegistrationLoading(false);
      registrationRequestRef.current = false;
    }
  };

  const handleRegistrationVerify = async () => {
    if (!/^\d{6}$/.test(registrationOtp) || !registrationChallengeId) {
      const message = 'کد تأیید باید دقیقاً ۶ رقم باشد';
      setRegistrationOtpError(message);
      toast.error(message);
      return;
    }
    setRegistrationOtpError('');
    setRegistrationLoading(true);
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-public-registration-otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          challenge_id: registrationChallengeId,
          otp: registrationOtp,
          first_name: registrationForm.firstName.trim(),
          last_name: registrationForm.lastName.trim(),
          username: registrationForm.username.trim(),
          email: registrationForm.email.trim(),
          phone: registrationForm.phone.trim(),
          password: registrationForm.password,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.error) {
        const message = result.error || 'کد نامعتبر است یا امکان تکمیل ثبت‌نام وجود ندارد.';
        setRegistrationOtpError(message);
        toast.error(message);
        setRegistrationStep('otp');
        return;
      }
      if (result.session?.access_token && result.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: result.session.access_token,
          refresh_token: result.session.refresh_token,
        });
      }
      setRegistrationForm(EMPTY_REGISTRATION);
      setRegistrationOtp('');
      setRegistrationChallengeId(null);
      onSuccess();
    } catch {
      const message = 'خطا در تأیید کد';
      setRegistrationOtpError(message);
      toast.error(message);
      setRegistrationStep('otp');
    } finally {
      setRegistrationLoading(false);
    }
  };

  const credentialTabs: Array<{ method: CredentialMethod; label: string; icon: typeof UserRound }> = [];
  if (loginMethods.username_login) credentialTabs.push({ method: 'username', label: 'ورود با نام کاربری', icon: UserRound });
  if (loginMethods.email_login) credentialTabs.push({ method: 'email', label: 'ورود با ایمیل', icon: Mail });
  if (loginMethods.phone_login) credentialTabs.push({ method: 'phone', label: 'ورود با موبایل', icon: Phone });

  const identifierLabel = credentialMethod === 'email' ? 'ایمیل' : credentialMethod === 'phone' ? 'شماره موبایل' : 'نام کاربری';
  const identifierPlaceholder = credentialMethod === 'email' ? 'example@domain.com' : credentialMethod === 'phone' ? '09123456789' : 'نام کاربری خود را وارد کنید';
  const phoneOtpAvailable = authConfig?.phone_login_canonical_enabled === true && authConfig?.phone_login_ready === true;
  const recoveryAvailable = authConfig?.phone_password_recovery_canonical_ready === true;

  return (
    <div className="spark-reference-login" dir="rtl">
      <div className="spark-reference-matrix" aria-hidden="true" />
      <div className="spark-reference-grid" aria-hidden="true" />
      <div className="spark-reference-aurora spark-reference-aurora-a" aria-hidden="true" />
      <div className="spark-reference-aurora spark-reference-aurora-b" aria-hidden="true" />

      <main className="spark-reference-shell">
        <section className="spark-reference-form-panel" aria-label="ورود به سامانه اسپارک">
          <div className="spark-reference-form-inner">
            <div className="spark-reference-brand">
              <div className="spark-reference-brand-mark">
                <img src="/logo_spark.png" alt="Spark" />
                <span className="spark-reference-brand-halo" aria-hidden="true" />
              </div>
              <div className="spark-reference-wordmark" dir="ltr">Spark</div>
              <h1>{mode === 'login' ? 'ورود به سیستم' : mode === 'register' ? 'ثبت‌نام' : 'بازیابی رمز'}</h1>
              <p>{mode === 'login' ? 'برای ادامه، وارد حساب کاربری خود شوید.' : mode === 'register' ? 'اطلاعات حساب سازمانی خود را تکمیل کنید.' : 'دسترسی امن به حساب خود را بازیابی کنید.'}</p>
            </div>

            <div className={`spark-reference-connection spark-reference-connection-${connectionStatus}`} title={connectionStatus === 'connected' ? 'ارتباط با سامانه برقرار است' : connectionStatus === 'disconnected' ? 'ارتباط با سامانه برقرار نیست' : 'در حال بررسی ارتباط'}>
              {connectionStatus === 'connected' ? <Wifi /> : connectionStatus === 'disconnected' ? <WifiOff /> : <LoaderCircle className="spark-spin" />}
            </div>

            {mode === 'login' && (
              <>
                {loginTab === 'password' ? (
                  <form className="spark-reference-form" onSubmit={handlePasswordLogin}>
                    <div className="spark-reference-tabs" role="tablist" aria-label="روش ورود">
                      {credentialTabs.map(({ method, label, icon: Icon }) => (
                        <button
                          key={method}
                          type="button"
                          role="tab"
                          aria-selected={credentialMethod === method}
                          className={credentialMethod === method ? 'is-active' : ''}
                          onClick={() => setCredentialMethod(method)}
                        >
                          <Icon />
                          <span>{label}</span>
                        </button>
                      ))}
                    </div>

                    {authConfigLoading && credentialTabs.length === 0 ? (
                      <div className="spark-reference-inline-state"><LoaderCircle className="spark-spin" /> در حال دریافت روش‌های ورود...</div>
                    ) : credentialTabs.length === 0 ? (
                      <button type="button" className="spark-reference-retry" onClick={() => void loadAuthConfig()}>تلاش دوباره</button>
                    ) : (
                      <>
                        <label className="spark-reference-field">
                          <span>{identifierLabel}</span>
                          <div className="spark-reference-input-wrap">
                            <UserRound className="spark-reference-input-icon" />
                            <input
                              type={credentialMethod === 'email' ? 'email' : credentialMethod === 'phone' ? 'tel' : 'text'}
                              value={identifier}
                              onChange={event => setIdentifier(event.target.value)}
                              placeholder={identifierPlaceholder}
                              autoComplete="username"
                              dir="ltr"
                              disabled={loading}
                              required
                            />
                          </div>
                        </label>

                        <label className="spark-reference-field">
                          <span>رمز عبور</span>
                          <div className="spark-reference-input-wrap">
                            <LockKeyhole className="spark-reference-input-icon" />
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={password}
                              onChange={event => setPassword(event.target.value)}
                              placeholder="••••••••"
                              autoComplete="current-password"
                              dir="ltr"
                              disabled={loading}
                              required
                            />
                            <button
                              type="button"
                              className="spark-reference-eye"
                              onClick={() => setShowPassword(value => !value)}
                              aria-label={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                            >
                              {showPassword ? <EyeOff /> : <Eye />}
                            </button>
                          </div>
                        </label>

                        <div className="spark-reference-options">
                          <button type="button" className="spark-reference-link" onClick={openRecovery}>رمز عبور خود را فراموش کرده‌ام؟</button>
                          <label className="spark-reference-check">
                            <input type="checkbox" checked={rememberIdentifier} onChange={event => setRememberIdentifier(event.target.checked)} />
                            <span className="spark-reference-checkbox"><Check /></span>
                            <span>مرا به خاطر بسپار</span>
                          </label>
                        </div>

                        <button type="submit" className="spark-reference-submit" disabled={loading}>
                          {loading ? <LoaderCircle className="spark-spin" /> : <><span>ورود</span><ArrowLeft /></>}
                        </button>

                        {(phoneOtpAvailable || authConfig?.registration_ready === true) && (
                          <div className="spark-reference-secondary-actions">
                            {phoneOtpAvailable && <button type="button" onClick={() => setLoginTab('phone_otp')}><Smartphone />ورود با کد پیامکی</button>}
                            {authConfig?.registration_ready === true && <button type="button" onClick={() => setMode('register')}><UserPlus />ثبت‌نام</button>}
                          </div>
                        )}
                      </>
                    )}
                  </form>
                ) : (
                  <div className="spark-reference-form spark-reference-compact-flow">
                    {phoneOtpStep === 'phone' ? (
                      <form onSubmit={handlePhoneOtpRequest} className="spark-reference-form">
                        <label className="spark-reference-field">
                          <span>شماره موبایل</span>
                          <div className="spark-reference-input-wrap">
                            <Phone className="spark-reference-input-icon" />
                            <input type="tel" dir="ltr" value={phoneOtpPhone} onChange={event => setPhoneOtpPhone(event.target.value)} placeholder="09123456789" required />
                          </div>
                        </label>
                        <button type="submit" className="spark-reference-submit" disabled={phoneOtpLoading || !phoneOtpPhone.trim()}>
                          {phoneOtpLoading ? <LoaderCircle className="spark-spin" /> : <><span>ارسال کد</span><ArrowLeft /></>}
                        </button>
                      </form>
                    ) : (
                      <div className="spark-reference-form">
                        <p className="spark-reference-helper">کد تأیید برای <b dir="ltr">{maskPhone(phoneOtpPhone)}</b> ارسال شد.</p>
                        <OtpCodeInput
                          value={phoneOtpCode}
                          onChange={nextValue => { setPhoneOtpCode(nextValue); if (phoneOtpError) setPhoneOtpError(''); }}
                          status={phoneOtpLoading ? 'checking' : phoneOtpError ? 'error' : 'idle'}
                          errorMessage={phoneOtpError}
                          hint="کد ۶ رقمی ارسال‌شده به شماره موبایل را وارد کنید"
                          autoFocusKey={phoneOtpChallengeId ?? 'phone-login'}
                          disabled={phoneOtpLoading}
                        />
                        <p className="spark-reference-timer">زمان باقی‌مانده: {Math.floor(phoneOtpExpiresSeconds / 60)}:{String(phoneOtpExpiresSeconds % 60).padStart(2, '0')}</p>
                        <button type="button" className="spark-reference-submit" disabled={phoneOtpLoading || phoneOtpCode.length !== 6} onClick={handlePhoneOtpVerify}>
                          {phoneOtpLoading ? <LoaderCircle className="spark-spin" /> : <><span>تأیید و ورود</span><ArrowLeft /></>}
                        </button>
                        <button type="button" className="spark-reference-link spark-reference-center-link" disabled={phoneOtpResendSeconds > 0} onClick={() => void handlePhoneOtpResend()}>
                          {phoneOtpResendSeconds > 0 ? `ارسال مجدد پس از ${phoneOtpResendSeconds} ثانیه` : 'ارسال مجدد کد'}
                        </button>
                      </div>
                    )}
                    <button type="button" className="spark-reference-back" onClick={() => { setLoginTab('password'); setPhoneOtpStep('phone'); }}><ChevronRight />بازگشت به ورود با رمز عبور</button>
                  </div>
                )}
              </>
            )}

            {mode === 'reset' && (
              <div className="spark-reference-form spark-reference-compact-flow">
                {!recoveryAvailable && !authConfigLoading ? (
                  <div className="spark-reference-inline-state">بازیابی رمز در حال حاضر آماده نیست.</div>
                ) : recoveryStep === 'phone' ? (
                  <>
                    <p className="spark-reference-helper">شماره موبایل حساب را وارد کنید تا کد بازیابی ارسال شود.</p>
                    <label className="spark-reference-field">
                      <span>شماره موبایل</span>
                      <div className="spark-reference-input-wrap"><Phone className="spark-reference-input-icon" /><input type="tel" dir="ltr" value={recoveryPhone} onChange={event => setRecoveryPhone(event.target.value)} placeholder="09123456789" /></div>
                    </label>
                    <button type="button" className="spark-reference-submit" disabled={recoveryLoading || !recoveryPhone.trim()} onClick={() => void handleRecoveryRequest()}>{recoveryLoading ? <LoaderCircle className="spark-spin" /> : <><span>ارسال کد بازیابی</span><ArrowLeft /></>}</button>
                  </>
                ) : recoveryStep === 'otp' ? (
                  <>
                    <OtpCodeInput
                      value={recoveryOtp}
                      onChange={nextValue => { setRecoveryOtp(nextValue); if (recoveryOtpError) setRecoveryOtpError(''); }}
                      status={recoveryLoading ? 'checking' : recoveryOtpError ? 'error' : 'idle'}
                      errorMessage={recoveryOtpError}
                      hint="کد ۶ رقمی بازیابی را وارد کنید"
                      autoFocusKey={recoveryChallengeId ?? 'password-recovery'}
                      disabled={recoveryLoading}
                    />
                    <button type="button" className="spark-reference-submit" disabled={recoveryLoading || recoveryOtp.length !== 6} onClick={() => void handleRecoveryVerify()}>{recoveryLoading ? <LoaderCircle className="spark-spin" /> : <><span>تأیید کد</span><ArrowLeft /></>}</button>
                    <button type="button" className="spark-reference-link spark-reference-center-link" disabled={recoveryCountdown > 0} onClick={() => void handleRecoveryRequest()}>{recoveryCountdown > 0 ? `ارسال مجدد پس از ${recoveryCountdown} ثانیه` : 'ارسال مجدد کد'}</button>
                  </>
                ) : recoveryStep === 'new_password' ? (
                  <>
                    <label className="spark-reference-field"><span>رمز عبور جدید</span><div className="spark-reference-input-wrap"><KeyRound className="spark-reference-input-icon" /><input type={recoveryShowPassword ? 'text' : 'password'} dir="ltr" value={recoveryPassword} onChange={event => setRecoveryPassword(event.target.value)} placeholder="حداقل ۸ کاراکتر" /><button type="button" className="spark-reference-eye" onClick={() => setRecoveryShowPassword(value => !value)}>{recoveryShowPassword ? <EyeOff /> : <Eye />}</button></div></label>
                    <label className="spark-reference-field"><span>تکرار رمز عبور جدید</span><div className="spark-reference-input-wrap"><LockKeyhole className="spark-reference-input-icon" /><input type={recoveryShowPassword ? 'text' : 'password'} dir="ltr" value={recoveryConfirmPassword} onChange={event => setRecoveryConfirmPassword(event.target.value)} placeholder="••••••••" /></div></label>
                    <button type="button" className="spark-reference-submit" disabled={recoveryLoading} onClick={() => void handleRecoveryComplete()}>{recoveryLoading ? <LoaderCircle className="spark-spin" /> : <><span>تغییر رمز عبور</span><ArrowLeft /></>}</button>
                  </>
                ) : (
                  <div className="spark-reference-success"><ShieldCheck /><strong>رمز عبور با موفقیت تغییر کرد</strong><p>اکنون می‌توانید با رمز جدید وارد سامانه شوید.</p></div>
                )}
                <button type="button" className="spark-reference-back" onClick={() => setMode('login')}><ChevronRight />بازگشت به صفحه ورود</button>
              </div>
            )}

            {mode === 'register' && (
              <div className="spark-reference-compact-flow">
                {authConfig?.registration_ready !== true ? (
                  <div className="spark-reference-inline-state">ثبت‌نام در حال حاضر فعال نیست.</div>
                ) : registrationStep === 'details' ? (
                  <form className="spark-reference-form spark-reference-registration" onSubmit={handleRegistrationRequest}>
                    <div className="spark-reference-two-col">
                      <label className="spark-reference-field"><span>نام</span><div className="spark-reference-input-wrap"><input value={registrationForm.firstName} onChange={event => setRegistrationForm(value => ({ ...value, firstName: event.target.value }))} /></div></label>
                      <label className="spark-reference-field"><span>نام خانوادگی</span><div className="spark-reference-input-wrap"><input value={registrationForm.lastName} onChange={event => setRegistrationForm(value => ({ ...value, lastName: event.target.value }))} /></div></label>
                    </div>
                    <label className="spark-reference-field"><span>نام کاربری</span><div className="spark-reference-input-wrap"><input dir="ltr" value={registrationForm.username} onChange={event => setRegistrationForm(value => ({ ...value, username: event.target.value.replace(/[^a-zA-Z0-9._]/g, '') }))} /></div></label>
                    <label className="spark-reference-field"><span>ایمیل</span><div className="spark-reference-input-wrap"><input type="email" dir="ltr" value={registrationForm.email} onChange={event => setRegistrationForm(value => ({ ...value, email: event.target.value }))} /></div></label>
                    <label className="spark-reference-field"><span>شماره موبایل</span><div className="spark-reference-input-wrap"><input type="tel" dir="ltr" value={registrationForm.phone} onChange={event => setRegistrationForm(value => ({ ...value, phone: event.target.value }))} /></div></label>
                    <div className="spark-reference-two-col">
                      <label className="spark-reference-field"><span>رمز عبور</span><div className="spark-reference-input-wrap"><input type="password" dir="ltr" value={registrationForm.password} onChange={event => setRegistrationForm(value => ({ ...value, password: event.target.value }))} /></div></label>
                      <label className="spark-reference-field"><span>تکرار رمز</span><div className="spark-reference-input-wrap"><input type="password" dir="ltr" value={registrationForm.confirmPassword} onChange={event => setRegistrationForm(value => ({ ...value, confirmPassword: event.target.value }))} /></div></label>
                    </div>
                    <button type="submit" className="spark-reference-submit" disabled={registrationLoading}>{registrationLoading ? <LoaderCircle className="spark-spin" /> : <><span>ارسال کد تأیید</span><ArrowLeft /></>}</button>
                  </form>
                ) : registrationStep === 'otp' ? (
                  <div className="spark-reference-form">
                    <p className="spark-reference-helper">کد تأیید ارسال‌شده را وارد کنید.</p>
                    <OtpCodeInput
                      value={registrationOtp}
                      onChange={nextValue => { setRegistrationOtp(nextValue); if (registrationOtpError) setRegistrationOtpError(''); }}
                      status={registrationLoading ? 'checking' : registrationOtpError ? 'error' : 'idle'}
                      errorMessage={registrationOtpError}
                      hint="کد ۶ رقمی ثبت‌نام را وارد کنید"
                      autoFocusKey={registrationChallengeId ?? 'registration'}
                      disabled={registrationLoading}
                    />
                    <button type="button" className="spark-reference-submit" disabled={registrationLoading || registrationOtp.length !== 6} onClick={() => void handleRegistrationVerify()}><span>تأیید و ثبت‌نام</span><ArrowLeft /></button>
                    <button type="button" className="spark-reference-link spark-reference-center-link" disabled={registrationLoading || registrationCountdown > 0} onClick={() => void handleRegistrationRequest()}>{registrationCountdown > 0 ? `ارسال مجدد پس از ${registrationCountdown} ثانیه` : 'ارسال مجدد کد'}</button>
                  </div>
                ) : (
                  <div className="spark-reference-inline-state"><LoaderCircle className="spark-spin" /> در حال تکمیل ثبت‌نام...</div>
                )}
                <button type="button" className="spark-reference-back" onClick={() => { setMode('login'); setRegistrationStep('details'); }}><ChevronRight />بازگشت به صفحه ورود</button>
              </div>
            )}

            <div className="spark-reference-secure-note"><ShieldCheck /><span>ورود امن به سامانه اسپارک</span></div>
          </div>
        </section>

        <section className="spark-reference-hero" aria-label="معرفی سامانه اسپارک">
          <div className="spark-reference-hero-scan" aria-hidden="true" />
          <header className="spark-reference-hero-header">
            <h2>به سامانه <span>اسپارک</span> خوش آمدید</h2>
            <p>مدیریت هوشمند، سریع و یکپارچه</p>
          </header>

          <div className="spark-reference-feature-grid">
            <article className="spark-reference-feature spark-feature-one"><div className="spark-reference-feature-copy"><strong>مدیریت کاربران</strong><span>کنترل و نظارت پیشرفته</span><i /></div><div className="spark-reference-feature-icon"><UsersRound /></div></article>
            <article className="spark-reference-feature spark-feature-two"><div className="spark-reference-feature-copy"><strong>گزارش‌گیری لحظه‌ای</strong><span>دسترسی به داده‌های کلیدی</span><i /></div><div className="spark-reference-feature-icon"><TrendingUp /></div></article>
            <article className="spark-reference-feature spark-feature-three"><div className="spark-reference-feature-copy"><strong>ارتباط‌گیری مدرن</strong><span>تجربه‌ای ساده و یکپارچه</span><i /></div><div className="spark-reference-feature-icon"><MonitorUp /></div></article>
            <article className="spark-reference-feature spark-feature-four"><div className="spark-reference-feature-copy"><strong>امنیت بالا</strong><span>حفاظت از اطلاعات شما</span><i /></div><div className="spark-reference-feature-icon"><ShieldCheck /></div></article>
          </div>

          <div className="spark-reference-hologram" aria-hidden="true">
            <div className="spark-reference-data-rain">0100110101<br />1010011010<br />0011010110<br />1100100101</div>
            <div className="spark-reference-orbit spark-reference-orbit-one" />
            <div className="spark-reference-orbit spark-reference-orbit-two" />
            <div className="spark-reference-orbit spark-reference-orbit-three" />

            <div className="spark-reference-node spark-reference-node-users"><UsersRound /></div>
            <div className="spark-reference-node spark-reference-node-chart"><BarChart3 /></div>
            <div className="spark-reference-node spark-reference-node-monitor"><MonitorUp /></div>
            <div className="spark-reference-node spark-reference-node-shield"><ShieldCheck /></div>

            <div className="spark-reference-platform">
              <div className="spark-reference-platform-layer layer-one" />
              <div className="spark-reference-platform-layer layer-two" />
              <div className="spark-reference-platform-layer layer-three" />
              <div className="spark-reference-core"><img src="/logo_spark.png" alt="" /></div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
