import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Loader as Loader2, RefreshCw, ShieldCheck, Smartphone, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  createCustomMfaChallenge,
  enrollSmsFactor,
  loadCustomMfaReadiness,
  resendCustomMfaChallenge,
  verifyCustomMfaChallenge,
} from '../services/customMfaService';
import {
  activateCanonicalTotpAfterEnrollment,
  listCurrentUserTotpFactors,
  validateTotpCode,
  verifyTotpFactor,
  type TotpFactor,
} from '../services/mfaOperations';
import {
  beginMfaMethodSwitch,
  confirmCurrentMfaMethodSwitch,
  loadCanonicalMfaState,
  type CanonicalMfaMethod,
  type CanonicalMfaState,
} from '../services/mfaMethodPreferenceService';

type VerificationPhase =
  | 'verify_current_totp'
  | 'verify_current_sms'
  | 'verify_target_totp'
  | 'verify_target_sms';

interface VerificationDialogState {
  phase: VerificationPhase;
  target: CanonicalMfaMethod;
  intentId: string | null;
  challengeId: string | null;
  factors: TotpFactor[];
  factorId: string | null;
}

interface Props {
  refreshKey?: number;
  onRequestTotpEnrollment: () => void;
  onCanonicalStateChanged?: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  ACCOUNT_NOT_ACTIVE: 'حساب شما فعال نیست و امکان تغییر روش MFA وجود ندارد.',
  SESSION_INVALID: 'نشست فعلی معتبر نیست. دوباره وارد سامانه شوید.',
  NO_ACTIVE_MFA: 'روش MFA فعالی برای تغییر پیدا نشد.',
  TOTP_NOT_AVAILABLE: 'روش برنامه احراز هویت طبق سیاست فعلی سامانه در دسترس نیست.',
  SMS_MFA_NOT_AVAILABLE: 'MFA پیامکی توسط مدیر فعال نشده یا زیرساخت پیامک آماده نیست.',
  PHONE_NOT_CONFIRMED: 'برای استفاده از MFA پیامکی ابتدا شماره موبایل حساب باید تأیید شده باشد.',
  CURRENT_FACTOR_PROOF_REQUIRED: 'ابتدا روش فعلی احراز هویت را دوباره تأیید کنید.',
  TARGET_FACTOR_PROOF_REQUIRED: 'تأیید روش جدید کامل نشده است.',
  SWITCH_EXPIRED: 'مهلت تغییر روش MFA تمام شده است. دوباره شروع کنید.',
  SWITCH_NOT_FOUND: 'درخواست تغییر روش MFA پیدا نشد. دوباره شروع کنید.',
  SWITCH_STATE_INVALID: 'وضعیت درخواست تغییر MFA معتبر نیست. دوباره شروع کنید.',
  MFA_METHOD_CHANGED: 'روش MFA هم‌زمان تغییر کرده است. وضعیت را تازه‌سازی کنید.',
  MFA_SWITCH_REQUIRED: 'برای تغییر روش MFA باید فرآیند امن تغییر روش انجام شود.',
  MFA_NOT_READY: 'زیرساخت MFA پیامکی هنوز آماده نیست.',
  MFA_DISABLED: 'MFA پیامکی توسط مدیر غیرفعال است.',
  SMS_FACTOR_NOT_ALLOWED: 'روش پیامکی در تنظیمات فعلی مجاز نیست.',
  FACTOR_INDEPENDENCE_REQUIRED: 'ورود اولیه با OTP موبایل نمی‌تواند همان شماره را بدون احراز مستقل به‌عنوان عامل دوم استفاده کند.',
  TRANSPORT_UNAVAILABLE: 'ارسال پیامک کد تأیید ممکن نشد.',
  RATE_LIMITED: 'تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.',
  INVALID_CODE: 'کد واردشده صحیح نیست یا منقضی شده است.',
  CHALLENGE_INVALID: 'کد تأیید معتبر نیست یا منقضی شده است.',
  MFA_OPERATION_FAILED: 'عملیات MFA انجام نشد. دوباره تلاش کنید.',
};

function errorMessage(error: unknown, fallback = 'عملیات تغییر روش احراز هویت انجام نشد.'): string {
  if (typeof error === 'string') return ERROR_MESSAGES[error] ?? fallback;
  if (error instanceof Error) return ERROR_MESSAGES[error.message] ?? fallback;
  return fallback;
}

function methodLabel(method: CanonicalMfaMethod | null): string {
  if (method === 'totp') return 'برنامه احراز هویت (TOTP)';
  if (method === 'sms') return 'کد پیامکی';
  return 'هنوز انتخاب نشده';
}

export function MfaMethodSelector({ refreshKey = 0, onRequestTotpEnrollment, onCanonicalStateChanged }: Props) {
  const [state, setState] = useState<CanonicalMfaState | null>(null);
  const [smsRuntimeReady, setSmsRuntimeReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<VerificationDialogState | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const canonical = await loadCanonicalMfaState();
      setState(canonical);

      if (canonical.sms_enabled_by_admin) {
        try {
          const readiness = await loadCustomMfaReadiness();
          setSmsRuntimeReady(readiness.ok === true && readiness.readiness === 'ready');
        } catch {
          setSmsRuntimeReady(false);
        }
      } else {
        setSmsRuntimeReady(false);
      }
    } catch (loadError) {
      console.error('[MFA_METHOD_SELECTOR] Failed to load state:', loadError);
      setState(null);
      setSmsRuntimeReady(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load, refreshKey]);

  const verifiedTotpFactors = useCallback(async () => {
    const factors = await listCurrentUserTotpFactors();
    return factors.filter((factor) => factor.status === 'verified');
  }, []);

  const openTotpDialog = useCallback((
    phase: Extract<VerificationPhase, 'verify_current_totp' | 'verify_target_totp'>,
    target: CanonicalMfaMethod,
    intentId: string | null,
    factors: TotpFactor[],
  ) => {
    setCode('');
    setError(null);
    setDialog({
      phase,
      target,
      intentId,
      challengeId: null,
      factors,
      factorId: factors.length === 1 ? factors[0].id : null,
    });
  }, []);

  const openSmsDialog = useCallback((
    phase: Extract<VerificationPhase, 'verify_current_sms' | 'verify_target_sms'>,
    target: CanonicalMfaMethod,
    intentId: string | null,
    challengeId: string,
  ) => {
    setCode('');
    setError(null);
    setDialog({ phase, target, intentId, challengeId, factors: [], factorId: null });
  }, []);

  const startSmsTarget = useCallback(async (intentId: string | null) => {
    const enrollment = await enrollSmsFactor();
    if (!enrollment.ok || !enrollment.challenge_id) {
      throw new Error(enrollment.error || 'MFA_OPERATION_FAILED');
    }
    openSmsDialog('verify_target_sms', 'sms', intentId, enrollment.challenge_id);
  }, [openSmsDialog]);

  const prepareTotpTarget = useCallback(async (intentId: string | null) => {
    const factors = await verifiedTotpFactors();
    if (factors.length === 0) {
      setDialog(null);
      setCode('');
      setError(null);
      onRequestTotpEnrollment();
      toast('برای انتخاب TOTP، برنامه احراز هویت را در بخش پایین فعال و کد آن را تأیید کنید.');
      return;
    }
    openTotpDialog('verify_target_totp', 'totp', intentId, factors);
  }, [onRequestTotpEnrollment, openTotpDialog, verifiedTotpFactors]);

  const chooseMethod = useCallback(async (target: CanonicalMfaMethod) => {
    if (!state || state.mfa_method === target || busy) return;

    if (target === 'sms' && (!state.sms_selectable || !smsRuntimeReady)) {
      toast.error(state.has_confirmed_phone
        ? 'MFA پیامکی هنوز توسط مدیر/زیرساخت سامانه آماده نشده است.'
        : 'شماره موبایل تأییدشده برای حساب شما وجود ندارد.');
      return;
    }
    if (target === 'totp' && !state.totp_selectable) {
      toast.error('TOTP طبق سیاست فعلی سامانه برای حساب شما در دسترس نیست.');
      return;
    }

    setBusy(true);
    try {
      if (state.mfa_method === null) {
        if (target === 'sms') {
          await startSmsTarget(null);
        } else {
          await prepareTotpTarget(null);
        }
        return;
      }

      const begin = await beginMfaMethodSwitch(target);
      if (!begin.ok) throw new Error(begin.error || 'MFA_SWITCH_START_FAILED');
      if (begin.already_active) {
        await load();
        return;
      }
      if (!begin.intent_id || !begin.from_method) throw new Error('MFA_SWITCH_START_FAILED');

      if (begin.from_method === 'totp') {
        const factors = await verifiedTotpFactors();
        if (factors.length === 0) throw new Error('TOTP_NOT_AVAILABLE');
        openTotpDialog('verify_current_totp', target, begin.intent_id, factors);
      } else {
        const challenge = await createCustomMfaChallenge('sms');
        if (!challenge.ok || !challenge.challenge_id) {
          throw new Error(challenge.error || 'MFA_OPERATION_FAILED');
        }
        openSmsDialog('verify_current_sms', target, begin.intent_id, challenge.challenge_id);
      }
    } catch (chooseError) {
      console.error('[MFA_METHOD_SELECTOR] Failed to start method change:', chooseError);
      toast.error(errorMessage(chooseError));
    } finally {
      setBusy(false);
    }
  }, [busy, load, openSmsDialog, openTotpDialog, prepareTotpTarget, smsRuntimeReady, startSmsTarget, state, verifiedTotpFactors]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setDialog(null);
    setCode('');
    setError(null);
  }, [busy]);

  const finishSelection = useCallback(async (message: string) => {
    setDialog(null);
    setCode('');
    setError(null);
    await load();
    onCanonicalStateChanged?.();
    toast.success(message);
  }, [load, onCanonicalStateChanged]);

  const verify = useCallback(async () => {
    if (!dialog || busy) return;
    const validCode = validateTotpCode(code);
    if (!validCode) {
      setError('کد ۶ رقمی معتبر وارد کنید.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (dialog.phase === 'verify_current_totp') {
        if (!dialog.factorId || !dialog.intentId) throw new Error('MFA_SWITCH_CONFIRM_FAILED');
        await verifyTotpFactor(dialog.factorId, validCode);
        const confirmed = await confirmCurrentMfaMethodSwitch(dialog.intentId);
        if (!confirmed.ok) throw new Error(confirmed.error || 'MFA_SWITCH_CONFIRM_FAILED');
        await startSmsTarget(dialog.intentId);
        return;
      }

      if (dialog.phase === 'verify_current_sms') {
        if (!dialog.challengeId || !dialog.intentId) throw new Error('MFA_SWITCH_CONFIRM_FAILED');
        const verified = await verifyCustomMfaChallenge(dialog.challengeId, validCode);
        if (!verified.ok) throw new Error(verified.error || 'INVALID_CODE');
        const confirmed = await confirmCurrentMfaMethodSwitch(dialog.intentId);
        if (!confirmed.ok) throw new Error(confirmed.error || 'MFA_SWITCH_CONFIRM_FAILED');
        await prepareTotpTarget(dialog.intentId);
        return;
      }

      if (dialog.phase === 'verify_target_sms') {
        if (!dialog.challengeId) throw new Error('MFA_OPERATION_FAILED');
        const verified = await verifyCustomMfaChallenge(dialog.challengeId, validCode);
        if (!verified.ok) throw new Error(verified.error || 'INVALID_CODE');
        await finishSelection(dialog.intentId ? 'روش ورود دومرحله‌ای به «کد پیامکی» تغییر کرد.' : 'کد پیامکی به‌عنوان روش ورود دومرحله‌ای انتخاب شد.');
        return;
      }

      if (!dialog.factorId) throw new Error('TOTP_NOT_AVAILABLE');
      await verifyTotpFactor(dialog.factorId, validCode);
      await activateCanonicalTotpAfterEnrollment();
      await finishSelection(dialog.intentId ? 'روش ورود دومرحله‌ای به «برنامه احراز هویت» تغییر کرد.' : 'برنامه احراز هویت به‌عنوان روش ورود دومرحله‌ای انتخاب شد.');
    } catch (verifyError) {
      console.error('[MFA_METHOD_SELECTOR] MFA verification failed:', verifyError);
      setError(errorMessage(verifyError, 'تأیید روش احراز هویت انجام نشد.'));
    } finally {
      setBusy(false);
    }
  }, [busy, code, dialog, finishSelection, prepareTotpTarget, startSmsTarget]);

  const resend = useCallback(async () => {
    if (!dialog?.challengeId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await resendCustomMfaChallenge(dialog.challengeId);
      if (!result.ok) throw new Error(result.error || 'MFA_OPERATION_FAILED');
      toast.success('کد جدید ارسال شد.');
    } catch (resendError) {
      setError(errorMessage(resendError, 'ارسال مجدد کد انجام نشد.'));
    } finally {
      setBusy(false);
    }
  }, [busy, dialog]);

  const dialogTitle = useMemo(() => {
    if (!dialog) return '';
    if (dialog.phase === 'verify_current_totp') return 'تأیید روش فعلی — برنامه احراز هویت';
    if (dialog.phase === 'verify_current_sms') return 'تأیید روش فعلی — پیامک';
    if (dialog.phase === 'verify_target_totp') return 'تأیید روش جدید — برنامه احراز هویت';
    return 'تأیید روش جدید — پیامک';
  }, [dialog]);

  if (loading) {
    return <div className="flex justify-center py-6"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>;
  }

  if (!state) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/10 p-4 text-sm text-red-700 dark:text-red-300">
        وضعیت روش احراز هویت قابل دریافت نیست. صفحه را تازه‌سازی کنید.
      </div>
    );
  }

  const smsAvailable = state.sms_selectable && smsRuntimeReady;
  const totpAvailable = state.totp_selectable;

  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-blue-800 dark:text-blue-200">روش ورود دومرحله‌ای شما</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 leading-5">
              مدیر فقط روش‌های قابل استفاده را فعال می‌کند؛ انتخاب روش ورود برای حساب شما از این قسمت انجام می‌شود. در هر زمان فقط یک روش، روش اصلی MFA حساب است.
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
              روش فعلی: <span className="font-semibold">{methodLabel(state.mfa_method)}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MethodCard
          icon={KeyRound}
          title="برنامه احراز هویت (TOTP)"
          description="کد ۶ رقمی برنامه‌هایی مانند Google Authenticator یا Microsoft Authenticator."
          active={state.mfa_method === 'totp'}
          available={totpAvailable}
          busy={busy}
          unavailableText={state.has_verified_totp ? 'این روش طبق سیاست فعلی قابل انتخاب نیست.' : 'فعال‌سازی TOTP طبق سیاست فعلی سامانه مجاز نیست.'}
          onSelect={() => void chooseMethod('totp')}
        />
        <MethodCard
          icon={Smartphone}
          title="کد پیامکی"
          description={state.masked_phone ? `ارسال کد به ${state.masked_phone}` : 'ارسال کد به شماره موبایل تأییدشده حساب.'}
          active={state.mfa_method === 'sms'}
          available={smsAvailable}
          busy={busy}
          unavailableText={!state.sms_enabled_by_admin
            ? 'مدیر سامانه MFA پیامکی را فعال نکرده است.'
            : !state.has_confirmed_phone
              ? 'شماره موبایل تأییدشده ندارید.'
              : 'زیرساخت پیامکی MFA آماده نیست.'}
          onSelect={() => void chooseMethod('sms')}
        />
      </div>

      {dialog && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-bold text-gray-800 dark:text-white">{dialogTitle}</h3>
              <button type="button" onClick={closeDialog} disabled={busy} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-gray-500 dark:text-gray-400 leading-6">
              {dialog.phase.startsWith('verify_current')
                ? 'برای جلوگیری از تغییر غیرمجاز، ابتدا روش MFA فعلی خود را تأیید کنید. سپس روش جدید فعال می‌شود.'
                : dialog.target === 'sms'
                  ? 'کد ارسال‌شده به شماره موبایل تأییدشده خود را وارد کنید.'
                  : 'کد فعلی برنامه احراز هویت را وارد کنید تا این روش به‌عنوان روش اصلی ورود انتخاب شود.'}
            </p>

            {dialog.factors.length > 1 && (
              <select
                value={dialog.factorId ?? ''}
                onChange={(event) => setDialog((current) => current ? { ...current, factorId: event.target.value || null } : current)}
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"
              >
                <option value="">برنامه احراز هویت را انتخاب کنید</option>
                {dialog.factors.map((factor) => (
                  <option key={factor.id} value={factor.id}>
                    برنامه احراز هویت — {new Date(factor.createdAt).toLocaleDateString('fa-IR')}
                  </option>
                ))}
              </select>
            )}

            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="کد ۶ رقمی"
              dir="ltr"
              className="w-full text-center text-2xl tracking-[0.45em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />

            {error && <p className="text-sm text-red-500 text-center">{error}</p>}

            <button
              type="button"
              onClick={() => void verify()}
              disabled={busy || code.length !== 6 || (dialog.factors.length > 0 && !dialog.factorId)}
              className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              تأیید و ادامه
            </button>

            {(dialog.phase === 'verify_current_sms' || dialog.phase === 'verify_target_sms') && (
              <button type="button" onClick={() => void resend()} disabled={busy} className="w-full flex items-center justify-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 disabled:opacity-50">
                <RefreshCw className="w-4 h-4" />
                ارسال مجدد کد
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MethodCard({
  icon: Icon,
  title,
  description,
  active,
  available,
  busy,
  unavailableText,
  onSelect,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  active: boolean;
  available: boolean;
  busy: boolean;
  unavailableText: string;
  onSelect: () => void;
}) {
  return (
    <div className={`rounded-xl border p-4 space-y-3 ${active
      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/15'
      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${active ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
            <Icon className={`w-4 h-4 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-white">{title}</p>
            {active && <span className="inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">روش فعلی</span>}
          </div>
        </div>
      </div>
      <p className="text-xs leading-5 text-gray-500 dark:text-gray-400">{description}</p>
      {!available && !active && <p className="text-[11px] leading-5 text-amber-600 dark:text-amber-400">{unavailableText}</p>}
      <button
        type="button"
        onClick={onSelect}
        disabled={busy || active || !available}
        className={`w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors ${active
          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 cursor-default'
          : 'bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-200 dark:disabled:bg-gray-700 disabled:text-gray-400 disabled:cursor-not-allowed'
        }`}
      >
        {active ? 'انتخاب‌شده' : 'انتخاب این روش'}
      </button>
    </div>
  );
}
