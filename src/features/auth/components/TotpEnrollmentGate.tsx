import { useState, useRef, useCallback } from 'react';
import { Shield, QrCode, Copy, Check, X, Loader as Loader2 } from 'lucide-react';
import {
  listCurrentUserTotpFactors,
  startTotpEnrollment,
  verifyTotpFactor,
  activateCanonicalTotpAfterEnrollment,
  cancelCurrentTotpEnrollment,
  validateTotpCode,
  type TotpEnrollmentResult,
} from '../services/mfaOperations';

interface TotpEnrollmentGateProps {
  onCompleted: () => Promise<void>;
  onSignOut: () => void;
}

type Phase = 'intro' | 'enrolling' | 'verifying';

function enrollmentErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'MFA_POLICY_DISABLED') {
    return 'سیاست MFA سامانه غیرفعال است و فعال‌سازی TOTP برای کاربران عادی مجاز نیست.';
  }
  if (code === 'TOTP_NOT_ALLOWED') {
    return 'فعال‌سازی TOTP در سیاست امنیتی فعلی مجاز نیست.';
  }
  if (code === 'MFA_POLICY_UNAVAILABLE') {
    return 'وضعیت سیاست MFA قابل بررسی نیست؛ برای جلوگیری از فعال‌سازی خارج از سیاست، عملیات متوقف شد.';
  }
  if (code === 'STEPUP_DENIED') {
    return 'روش MFA دیگری برای این حساب فعال است؛ تغییر روش باید از مسیر مدیریت MFA انجام شود.';
  }
  return 'فعال‌سازی انجام نشد؛ دوباره تلاش کنید.';
}

export function TotpEnrollmentGate({ onCompleted, onSignOut }: TotpEnrollmentGateProps) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [enrollment, setEnrollment] = useState<TotpEnrollmentResult | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const enrolledFactorIdRef = useRef<string | null>(null);

  const handleStart = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const factors = await listCurrentUserTotpFactors();
      if (factors.some((factor) => factor.status === 'verified')) {
        // Recover cleanly from a verified Supabase factor whose canonical
        // profile method was not finalized by an older enrollment flow.
        await activateCanonicalTotpAfterEnrollment();
        await onCompleted();
        return;
      }

      const result = await startTotpEnrollment();
      enrolledFactorIdRef.current = result.factorId;
      setEnrollment(result);
      setPhase('enrolling');
    } catch (err) {
      setError(enrollmentErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [onCompleted]);

  const handleVerify = useCallback(async () => {
    const validCode = validateTotpCode(code);
    if (!validCode || !enrolledFactorIdRef.current) {
      setError('کد واردشده معتبر نیست.');
      return;
    }

    setError(null);
    setBusy(true);
    setPhase('verifying');
    try {
      await verifyTotpFactor(enrolledFactorIdRef.current, validCode);
      await activateCanonicalTotpAfterEnrollment();
      setCode('');
      setEnrollment(null);
      enrolledFactorIdRef.current = null;
      await onCompleted();
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(
        message === 'STEPUP_DENIED' || message === 'VERIFY_FAILED'
          ? enrollmentErrorMessage(err)
          : 'کد واردشده معتبر نیست یا تأیید TOTP کامل نشد.'
      );
      setPhase('enrolling');
    } finally {
      setBusy(false);
    }
  }, [code, onCompleted]);

  const handleCancel = useCallback(async () => {
    if (enrolledFactorIdRef.current) {
      try { await cancelCurrentTotpEnrollment(enrolledFactorIdRef.current); } catch { /* best-effort */ }
    }
    enrolledFactorIdRef.current = null;
    setEnrollment(null);
    setCode('');
    setError(null);
    setPhase('intro');
  }, []);

  const handleCopySecret = useCallback(() => {
    if (!enrollment?.secret) return;
    navigator.clipboard.writeText(enrollment.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [enrollment]);

  if (phase === 'intro') {
    return <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 px-6" dir="rtl">
      <div className="w-20 h-20 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center"><Shield className="w-10 h-10 text-blue-500" /></div>
      <div className="text-center space-y-3"><h1 className="text-xl font-bold text-gray-800 dark:text-white">فعال‌سازی احراز هویت دو مرحله‌ای</h1><p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">برای امنیت حساب خود، برنامه احراز هویت را فعال کنید.</p></div>
      {error && <p className="text-sm text-red-500 text-center">{error}</p>}
      <button type="button" onClick={handleStart} disabled={busy} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50 w-full">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}فعال‌سازی</button>
      <button type="button" onClick={onSignOut} disabled={busy} className="flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 w-full">خروج از حساب</button>
    </div>;
  }

  return <div className="w-full max-w-md mx-auto flex flex-col items-center gap-6 px-6" dir="rtl">
    <div className="w-20 h-20 rounded-2xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center"><QrCode className="w-10 h-10 text-blue-500" /></div>
    <div className="text-center space-y-2"><h1 className="text-xl font-bold text-gray-800 dark:text-white">کد QR را اسکن کنید</h1><p className="text-sm text-gray-500 dark:text-gray-400">QR را با برنامه احراز هویت خود اسکن کنید، سپس کد ۶ رقمی را وارد کنید.</p></div>
    {enrollment && <div className="flex flex-col items-center gap-4 w-full">
      <img src={enrollment.qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-lg border border-gray-200 dark:border-gray-700" />
      <details className="w-full"><summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-500">نمی‌توانید QR را اسکن کنید؟ نمایش کلید راه‌اندازی</summary><div className="mt-2 flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg p-3"><code className="flex-1 text-xs text-gray-600 dark:text-gray-300 break-all font-mono">{enrollment.secret}</code><button type="button" onClick={handleCopySecret} className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700" title="کپی کلید">{copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-400" />}</button></div></details>
      <input type="text" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="کد ۶ رقمی" className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" dir="ltr" />
      {error && <p className="text-sm text-red-500 text-center">{error}</p>}
      <div className="flex gap-3 w-full"><button type="button" onClick={handleVerify} disabled={busy || code.length !== 6} className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}تأیید و فعال‌سازی</button><button type="button" onClick={handleCancel} disabled={busy} className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"><X className="w-4 h-4" /></button></div>
    </div>}
  </div>;
}
