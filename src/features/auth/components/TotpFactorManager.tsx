import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleAlert as AlertCircle, Check, Copy, KeyRound, Loader as Loader2, Plus, QrCode, Shield, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import {
  cancelCurrentTotpEnrollment,
  activateCanonicalTotpAfterEnrollment,
  getCurrentAal,
  listCurrentUserTotpFactors,
  startTotpEnrollment,
  validateTotpCode,
  verifyTotpFactor,
  type MfaEnrollError,
  type TotpEnrollmentResult,
  type TotpFactor,
} from '../services/mfaOperations';

type Phase = 'idle' | 'enrolling' | 'verifying';

const ERROR_MESSAGES: Record<string, string> = {
  INSUFFICIENT_AAL: 'برای انجام این تغییر امنیتی ابتدا باید هویت خود را با روش احراز هویت فعلی تأیید کنید.',
  ENROLLMENT_FAILED: 'فعال‌سازی انجام نشد؛ دوباره تلاش کنید.',
  NETWORK_ERROR: 'ارتباط با سرور برقرار نشد. دوباره تلاش کنید.',
  INVALID_CODE: 'کد واردشده صحیح نیست یا منقضی شده است.',
  CHALLENGE_FAILED: 'تأیید کد ناموفق بود. دوباره تلاش کنید.',
  VERIFY_FAILED: 'تأیید کد ناموفق بود. دوباره تلاش کنید.',
  AAL2_NOT_REACHED: 'ارتقاء سطح احراز هویت ناموفق بود. دوباره تلاش کنید.',
  SESSION_INVALID: 'نشست نامعتبر است. لطفاً مجدداً وارد شوید.',
  UNKNOWN_MFA_ERROR: 'خطای ناشناخته. دوباره تلاش کنید.',
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return ERROR_MESSAGES[error.message as MfaEnrollError] ?? ERROR_MESSAGES.UNKNOWN_MFA_ERROR;
  }
  return ERROR_MESSAGES.UNKNOWN_MFA_ERROR;
}

export function TotpFactorManager() {
  const [factors, setFactors] = useState<TotpFactor[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('idle');
  const [enrollment, setEnrollment] = useState<TotpEnrollmentResult | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [stepUpRequired, setStepUpRequired] = useState(false);
  const [stepUpFactors, setStepUpFactors] = useState<TotpFactor[]>([]);
  const [stepUpFactorId, setStepUpFactorId] = useState<string | null>(null);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpError, setStepUpError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<TotpFactor | null>(null);
  const [removeCode, setRemoveCode] = useState('');
  const [removing, setRemoving] = useState(false);
  const enrolledFactorIdRef = useRef<string | null>(null);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const allFactors = await listCurrentUserTotpFactors();
      setFactors(allFactors.filter((factor) => factor.status === 'verified'));
      const { data: accessState } = await supabase.rpc('get_my_auth_access_state_v3' as never) as { data: unknown };
      setMfaRequired((accessState as { mfa_required?: boolean })?.mfa_required ?? false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadFactors(); }, [loadFactors]);

  const openStepUp = useCallback((verifiedFactors: TotpFactor[]) => {
    setStepUpFactors(verifiedFactors);
    setStepUpFactorId(verifiedFactors.length === 1 ? verifiedFactors[0].id : null);
    setStepUpCode('');
    setStepUpError(null);
    setStepUpRequired(true);
    setPhase('idle');
  }, []);

  const handleStartEnrollment = useCallback(async () => {
    setBusy(true);
    try {
      const allFactors = await listCurrentUserTotpFactors();
      const verifiedFactors = allFactors.filter((factor) => factor.status === 'verified');
      const currentAal = await getCurrentAal();

      if (verifiedFactors.length > 0 && currentAal !== 'aal2') {
        openStepUp(verifiedFactors);
        return;
      }

      const result = await startTotpEnrollment();
      enrolledFactorIdRef.current = result.factorId;
      setEnrollment(result);
      setShowSecret(false);
      setPhase('enrolling');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'INSUFFICIENT_AAL' || code === 'insufficient_aal') {
        try {
          const verifiedFactors = (await listCurrentUserTotpFactors()).filter((factor) => factor.status === 'verified');
          if (verifiedFactors.length > 0) {
            openStepUp(verifiedFactors);
          } else {
            toast.error(ERROR_MESSAGES.INSUFFICIENT_AAL);
          }
        } catch {
          toast.error(ERROR_MESSAGES.NETWORK_ERROR);
        }
      } else {
        toast.error(getErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }, [openStepUp]);

  const handleStepUpVerify = useCallback(async () => {
    const validCode = validateTotpCode(stepUpCode);
    if (!validCode || !stepUpFactorId) {
      setStepUpError('کد واردشده صحیح نیست.');
      return;
    }

    setBusy(true);
    setStepUpError(null);
    try {
      await verifyTotpFactor(stepUpFactorId, validCode);
      const result = await startTotpEnrollment();
      enrolledFactorIdRef.current = result.factorId;
      setEnrollment(result);
      setShowSecret(false);
      setStepUpRequired(false);
      setStepUpCode('');
      setStepUpFactorId(null);
      setStepUpFactors([]);
      setPhase('enrolling');
    } catch (error) {
      setStepUpError(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }, [stepUpCode, stepUpFactorId]);

  const cancelStepUp = useCallback(() => {
    if (busy) return;
    setStepUpRequired(false);
    setStepUpCode('');
    setStepUpFactorId(null);
    setStepUpFactors([]);
    setStepUpError(null);
  }, [busy]);

  const handleVerify = useCallback(async () => {
    const validCode = validateTotpCode(code);
    if (!validCode || !enrolledFactorIdRef.current) {
      toast.error(ERROR_MESSAGES.INVALID_CODE);
      return;
    }

    setBusy(true);
    setPhase('verifying');
    try {
      await verifyTotpFactor(enrolledFactorIdRef.current, validCode);
      await activateCanonicalTotpAfterEnrollment();
      enrolledFactorIdRef.current = null;
      setEnrollment(null);
      setCode('');
      setPhase('idle');
      await loadFactors();
      toast.success('احراز هویت دومرحله‌ای با موفقیت فعال شد.');
    } catch (error) {
      toast.error(getErrorMessage(error));
      setPhase('enrolling');
    } finally {
      setBusy(false);
    }
  }, [code, loadFactors]);

  const handleCancel = useCallback(async () => {
    if (enrolledFactorIdRef.current) {
      try { await cancelCurrentTotpEnrollment(enrolledFactorIdRef.current); } catch { /* best-effort */ }
    }
    enrolledFactorIdRef.current = null;
    setEnrollment(null);
    setCode('');
    setShowSecret(false);
    setPhase('idle');
  }, []);

  const handleCopySecret = useCallback(() => {
    if (!enrollment?.secret) return;
    navigator.clipboard.writeText(enrollment.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [enrollment]);

  const closeRemoveDialog = useCallback(() => {
    if (removing) return;
    setRemoveTarget(null);
    setRemoveCode('');
  }, [removing]);

  const handleRemoveConfirm = useCallback(async () => {
    if (!removeTarget) return;
    const validCode = validateTotpCode(removeCode);
    if (!validCode) {
      toast.error(ERROR_MESSAGES.INVALID_CODE);
      return;
    }

    setRemoving(true);
    try {
      await verifyTotpFactor(removeTarget.id, validCode);
      const { error } = await supabase.auth.mfa.unenroll({ factorId: removeTarget.id });
      if (error) throw error;
      setRemoveTarget(null);
      setRemoveCode('');
      await loadFactors();
      toast.success('برنامه احراز هویت حذف شد.');
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setRemoving(false);
    }
  }, [loadFactors, removeCode, removeTarget]);

  const verifiedCount = factors.length;

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-8 h-8 text-teal-500 animate-spin" /></div>;

  return <div className="space-y-4" dir="rtl">
    <div className={`flex items-center gap-3 p-4 rounded-xl border ${factors.length > 0 ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-700/40' : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600'}`}>
      {factors.length > 0 ? <ShieldCheck className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" /> : <Shield className="w-5 h-5 text-gray-400 flex-shrink-0" />}
      <div><p className="text-sm font-semibold text-gray-800 dark:text-white">{factors.length > 0 ? 'احراز هویت دومرحله‌ای فعال است' : 'احراز هویت دومرحله‌ای فعال نیست'}</p>{mfaRequired && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">MFA برای حساب شما الزامی است</p>}</div>
    </div>

    {factors.length > 0 && <div className="space-y-2">{factors.map((factor) => <div key={factor.id} className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
      <div className="flex items-center gap-3"><Smartphone className="w-4 h-4 text-gray-400" /><div><p className="text-sm font-medium text-gray-800 dark:text-white flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-green-500" />برنامه احراز هویت</p><p className="text-xs text-gray-400">{new Date(factor.createdAt).toLocaleDateString('fa-IR')}</p></div></div>
      <button type="button" onClick={() => { setRemoveTarget(factor); setRemoveCode(''); }} disabled={removing || (verifiedCount === 1 && mfaRequired)} className="p-2 rounded-lg text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title={verifiedCount === 1 && mfaRequired ? 'ابتدا یک برنامه احراز هویت دیگر اضافه کنید' : 'حذف'}><Trash2 className="w-4 h-4" /></button>
    </div>)}</div>}

    {stepUpRequired && <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50"><div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-5">
      <div className="flex items-center justify-between"><h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2"><KeyRound className="w-5 h-5 text-blue-500" />تأیید هویت برای افزودن برنامه جدید</h3><button type="button" onClick={cancelStepUp} disabled={busy} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400"><X className="w-4 h-4" /></button></div>
      <p className="text-sm text-gray-500 dark:text-gray-400">برای افزودن برنامه جدید، ابتدا کد یکی از برنامه‌های احراز هویت فعال را وارد کنید.</p>
      {stepUpFactors.length > 1 && <select value={stepUpFactorId ?? ''} onChange={(event) => setStepUpFactorId(event.target.value || null)} className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white text-sm"><option value="">انتخاب کنید</option>{stepUpFactors.map((factor) => <option key={factor.id} value={factor.id}>برنامه احراز هویت — {new Date(factor.createdAt).toLocaleDateString('fa-IR')}</option>)}</select>}
      <input type="text" inputMode="numeric" maxLength={6} value={stepUpCode} onChange={(event) => setStepUpCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="کد ۶ رقمی" className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white" dir="ltr" />
      {stepUpError && <p className="text-sm text-red-500 text-center">{stepUpError}</p>}
      <button type="button" onClick={handleStepUpVerify} disabled={busy || stepUpCode.length !== 6 || !stepUpFactorId} className="w-full flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}تأیید و ادامه</button>
    </div></div>}

    {(phase === 'enrolling' || phase === 'verifying') && enrollment && <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
      <div className="flex flex-col items-center gap-3"><p className="text-sm text-gray-600 dark:text-gray-400 text-center">QR را با برنامه احراز هویت سازگار اسکن کنید.</p><img src={enrollment.qrCode} alt="QR Code" className="w-40 h-40 rounded-xl border border-gray-200 dark:border-gray-600 bg-white p-2" />
      <button type="button" onClick={() => setShowSecret((value) => !value)} className="text-xs text-gray-500 hover:text-gray-700">نمی‌توانید QR را اسکن کنید؟ نمایش کلید راه‌اندازی</button>
      {showSecret && <div className="w-full flex items-center gap-2 bg-white dark:bg-gray-800 rounded-lg p-3"><code className="flex-1 text-xs text-gray-600 dark:text-gray-300 break-all font-mono">{enrollment.secret}</code><button type="button" onClick={handleCopySecret} className="flex-shrink-0 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700" title="کپی کلید">{copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-400" />}</button></div>}</div>
      <input type="text" inputMode="numeric" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="کد ۶ رقمی" className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white" dir="ltr" />
      <div className="flex gap-2"><button type="button" onClick={handleVerify} disabled={busy || code.length !== 6} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}تأیید و فعال‌سازی</button><button type="button" onClick={handleCancel} disabled={busy} className="px-4 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-600 dark:hover:bg-gray-500 text-gray-700 dark:text-gray-300 rounded-xl text-sm">انصراف</button></div>
    </div>}

    {phase === 'idle' && <button type="button" onClick={handleStartEnrollment} disabled={busy} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}فعال‌سازی احراز هویت دومرحله‌ای</button>}

    {removeTarget && <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50"><div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 space-y-4"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-red-600"><AlertCircle className="w-5 h-5" /><h3 className="font-bold">حذف برنامه احراز هویت</h3></div><button type="button" onClick={closeRemoveDialog} disabled={removing} aria-disabled={removing} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 disabled:opacity-50" title="بستن"><X className="w-4 h-4" /></button></div><p className="text-sm text-gray-500 dark:text-gray-400">برای حذف، کد ۶ رقمی این برنامه را وارد کنید.</p><input type="text" inputMode="numeric" maxLength={6} value={removeCode} onChange={(event) => setRemoveCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="کد ۶ رقمی" className="w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-white" dir="ltr" /><div className="flex gap-2"><button type="button" onClick={handleRemoveConfirm} disabled={removing || removeCode.length !== 6} className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium">{removing ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'حذف'}</button><button type="button" onClick={closeRemoveDialog} disabled={removing} aria-disabled={removing} className="px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl text-sm disabled:opacity-50">انصراف</button></div></div></div>}
  </div>;
}
