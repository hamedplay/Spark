import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Loader as Loader2, RefreshCw, FlaskConical, Wrench, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { EdgeFunctionCallError, invokeEdgeFunctionWithTimeout } from '../../lib/invokeEdgeFunction';
import { useSecurityStepUp, SecurityStepUpModal } from '../../features/security-settings';
import toast from 'react-hot-toast';

interface DryRunSummary {
  ALREADY_SYNCED?: number;
  IDENTITY_REPAIR_REQUIRED?: number;
  AUTH_PHONE_UNCONFIRMED?: number;
  PHONE_ONLY_AUTH_ORPHAN?: number;
  PROFILE_PHONE_MISSING?: number;
  PROFILE_DUPLICATE?: number;
  AUTH_PHONE_CONFLICT?: number;
  SAFE_TO_SYNC?: number;
  AUTH_PROFILE_MISMATCH?: number;
  [key: string]: number | undefined;
}

interface CanaryResult {
  masked_phone: string;
  success: boolean;
  status: number;
  error: string | null;
}

interface RepairResponse {
  ok: boolean;
  mode: string;
  summary?: DryRunSummary;
  canary_passed?: boolean;
  canary_result?: CanaryResult;
  total?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
  results?: CanaryResult[];
  error?: string;
  message?: string;
}

const STATUS_LABELS: Record<string, string> = {
  ALREADY_SYNCED: 'کاملاً همگام‌شده',
  IDENTITY_REPAIR_REQUIRED: 'نیازمند ترمیم هویت',
  AUTH_PHONE_UNCONFIRMED: 'تأییدنشده (نیازمند تأیید شماره)',
  PHONE_ONLY_AUTH_ORPHAN: 'حساب یتیم موبایلی',
  PROFILE_PHONE_MISSING: 'بدون شماره پروفایل',
  PROFILE_DUPLICATE: 'شماره تکراری',
  AUTH_PHONE_CONFLICT: 'تداخل شماره',
  SAFE_TO_SYNC: 'آماده همگام‌سازی',
  AUTH_PROFILE_MISMATCH: 'عدم تطابق',
};

const STATUS_ORDER = [
  'ALREADY_SYNCED',
  'IDENTITY_REPAIR_REQUIRED',
  'AUTH_PHONE_UNCONFIRMED',
  'PHONE_ONLY_AUTH_ORPHAN',
  'PROFILE_PHONE_MISSING',
  'PROFILE_DUPLICATE',
  'AUTH_PHONE_CONFLICT',
  'SAFE_TO_SYNC',
  'AUTH_PROFILE_MISMATCH',
];

const ERROR_LABELS: Record<string, string> = {
  AUTH_ACCESS_RESTRICTED: 'نشست شما اجازه دسترسی کامل ندارد.',
  MFA_STEP_UP_REQUIRED: 'برای این عملیات، احراز هویت دومرحله‌ای و تأیید مجدد اخیر لازم است.',
  NOT_SECURITY_ADMIN: 'این ابزار فقط در اختیار مدیر امنیتی فعال است.',
  ORIGIN_NOT_ALLOWED: 'نشانی مبدأ این صفحه در فهرست مجاز نیست.',
  CLASSIFY_FAILED: 'بررسی وضعیت هویت‌های موبایلی انجام نشد.',
  CANARY_FAILED: 'آزمایش ایمن ناموفق بود؛ ترمیم گروهی متوقف شد.',
  PROFILE_PHONE_NULL: 'شماره موبایل در پروفایل ثبت نشده است.',
  INVALID_PHONE: 'قالب شماره موبایل معتبر نیست.',
  AUTH_USER_NOT_ELIGIBLE: 'حساب احراز هویت برای ترمیم واجد شرایط نیست.',
  AUTH_PHONE_CONFLICT: 'شماره Auth با شماره پروفایل تعارض دارد.',
  AUTH_PHONE_UNCONFIRMED: 'شماره موبایل حساب هنوز تأیید نشده است.',
  IDENTITY_VERIFY_UNAVAILABLE: 'سرویس بررسی هویت در دسترس نیست؛ هیچ تغییری اعمال نشد.',
  IDENTITY_STATE_CONFLICT: 'هویت موجود غیرعادی است و به بررسی دستی نیاز دارد.',
  IDENTITY_REPAIR_FAILED: 'ایجاد هویت موبایلی ناموفق بود.',
  GOTRUE_IDENTITY_REPAIR_UNSUPPORTED: 'سامانه Auth تغییر را پذیرفت اما هویت موبایلی ایجاد نشد.',
  IDENTITY_VERIFY_FAILED: 'تأیید نهایی هویت ناموفق بود.',
  RUNTIME_STATE_CHANGED: 'وضعیت حساب هنگام عملیات تغییر کرد و از ترمیم صرف‌نظر شد.',
  INTERNAL_ERROR: 'خطای داخلی در سرویس ترمیم رخ داد.',
  INVALID_MODE: 'نوع عملیات معتبر نیست.',
  AUDIT_WRITE_FAILED: 'ثبت گزارش امنیتی انجام نشد؛ برای جلوگیری از تغییر ثبت‌نشده، عملیات متوقف شد.',
  REQUEST_TIMEOUT: 'پاسخ سرویس بیش از حد طول کشید. هیچ نتیجه‌ای به‌عنوان موفق ثبت نشد؛ دوباره وضعیت را بررسی کنید.',
  EMPTY_RESPONSE: 'سرویس ترمیم پاسخ معتبری برنگرداند.',
  RUNTIME_CONFIG_UNAVAILABLE: 'تنظیمات مبدأهای مجاز در دسترس نیست.',
  EDGE_FUNCTION_ERROR: 'ارتباط با سرویس ترمیم برقرار نشد.',
};

function errorLabel(code?: string | null): string {
  return code ? (ERROR_LABELS[code] || 'عملیات انجام نشد؛ جزئیات در گزارش امنیتی ثبت شده است.') : 'خطای نامشخص';
}

export function IdentityRepairCard() {
  const [loading, setLoading] = useState(true);
  const [isSecurityAdmin, setIsSecurityAdmin] = useState(false);
  const [summary, setSummary] = useState<DryRunSummary | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [canaryResult, setCanaryResult] = useState<CanaryResult | null>(null);
  const [repairResult, setRepairResult] = useState<RepairResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const stepUp = useSecurityStepUp({ purpose: 'account_security_change' });

  useEffect(() => {
    void (async () => {
      try {
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData?.user) return;
        const { data: profile, error: profileError } = await supabase
          .from('profiles')
          .select('is_security_admin, account_status')
          .eq('user_id', userData.user.id)
          .maybeSingle();
        if (!profileError) {
          setIsSecurityAdmin(profile?.is_security_admin === true && profile?.account_status === 'ACTIVE');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const invokeBulkSync = useCallback(async (mode: string): Promise<RepairResponse | null> => {
    setErrorMessage('');
    try {
      const result = await invokeEdgeFunctionWithTimeout<RepairResponse>(
        'bulk-sync-profile-phones',
        { mode },
        mode === 'dry_run' ? 20_000 : 120_000,
      );
      if (!result.ok) throw new EdgeFunctionCallError(result.error || 'EDGE_FUNCTION_ERROR');
      return result;
    } catch (error) {
      const code = error instanceof EdgeFunctionCallError ? error.code : 'EDGE_FUNCTION_ERROR';
      if (code === 'MFA_STEP_UP_REQUIRED') throw error;
      const message = errorLabel(code);
      setErrorMessage(message);
      toast.error(message);
      return null;
    }
  }, []);

  const handleCheckStatus = useCallback(async () => {
    setBusy('dry_run');
    setCanaryResult(null);
    setRepairResult(null);
    try {
      const result = await invokeBulkSync('dry_run');
      if (result?.summary) setSummary(result.summary as DryRunSummary);
    } finally {
      setBusy('');
    }
  }, [invokeBulkSync]);

  const handleCanary = useCallback(async () => {
    setBusy('identity_canary');
    setCanaryResult(null);
    try {
      const result = await stepUp.requireStepUp(() => invokeBulkSync('identity_canary'));
      if (result?.canary_result) {
        setCanaryResult(result.canary_result);
        if (result.canary_passed) toast.success('آزمایش ایمن موفق بود');
        else toast.error('آزمایش ایمن ناموفق بود');
      }
    } catch (error) {
      const code = error instanceof EdgeFunctionCallError ? error.code : 'EDGE_FUNCTION_ERROR';
      if (code === 'MFA_STEP_UP_REQUIRED') {
        const message = ERROR_LABELS.MFA_STEP_UP_REQUIRED;
        setErrorMessage(message);
        toast.error(message);
      } else {
        const message = errorLabel(code);
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setBusy('');
    }
  }, [invokeBulkSync, stepUp]);

  const handleRepair = useCallback(async () => {
    setShowConfirm(false);
    setBusy('identity_repair');
    setRepairResult(null);
    try {
      const result = await stepUp.requireStepUp(() => invokeBulkSync('identity_repair'));
      if (result) {
        setRepairResult(result);
        if (result.failed && result.failed > 0) toast.error(`${result.failed} کاربر ناموفق`);
        else toast.success('ترمیم تکمیل شد');
        const dryResult = await invokeBulkSync('dry_run');
        if (dryResult?.summary) setSummary(dryResult.summary as DryRunSummary);
      }
    } catch (error) {
      const code = error instanceof EdgeFunctionCallError ? error.code : 'EDGE_FUNCTION_ERROR';
      if (code === 'MFA_STEP_UP_REQUIRED') {
        const message = ERROR_LABELS.MFA_STEP_UP_REQUIRED;
        setErrorMessage(message);
        toast.error(message);
      } else {
        const message = errorLabel(code);
        setErrorMessage(message);
        toast.error(message);
      }
    } finally {
      setBusy('');
    }
  }, [invokeBulkSync, stepUp]);

  if (loading || !isSecurityAdmin) return null;

  const repairNeeded = summary?.IDENTITY_REPAIR_REQUIRED ?? 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
      <SecurityStepUpModal
        state={stepUp.state}
        title="تأیید امنیتی"
        description="برای اجرای این عملیات حساس، کد ۶ رقمی از برنامه احراز هویت خود را وارد کنید."
        confirmLabel="تأیید و ادامه"
        onSelectFactor={stepUp.setSelectedFactorId}
        onCodeChange={stepUp.setCode}
        onClose={stepUp.close}
        onVerify={() => { void stepUp.verify(); }}
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">پایش و ترمیم هویت موبایلی</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">رفع ناهمگونی شماره موبایل میان پروفایل کاربر و سامانه احراز هویت</p>
        </div>
      </div>

      <div className="space-y-3">
        {!summary && !busy && !errorMessage && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            برای مشاهده وضعیت فعلی، «بررسی وضعیت» را انتخاب کنید. این بررسی هیچ تغییری در حساب‌ها ایجاد نمی‌کند.
          </p>
        )}

        {errorMessage && (
          <div role="alert" className="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {summary && (
          <div className="grid grid-cols-2 gap-2">
            {STATUS_ORDER.filter(key => summary[key] !== undefined).map(key => (
              <div key={key} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                <span className="text-gray-600 dark:text-gray-300">{STATUS_LABELS[key] || 'وضعیت ناشناخته'}</span>
                <span className="font-bold text-gray-800 dark:text-white">{summary[key] ?? 0}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={handleCheckStatus}
            disabled={Boolean(busy)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            {busy === 'dry_run' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            بررسی وضعیت
          </button>
          <button
            onClick={handleCanary}
            disabled={Boolean(busy) || repairNeeded === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/20 dark:hover:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            {busy === 'identity_canary' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
            اجرای آزمایش ایمن
          </button>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={Boolean(busy) || repairNeeded === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
          >
            {busy === 'identity_repair' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
            ترمیم کاربران
          </button>
        </div>

        {canaryResult && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              نتیجه آزمایش ایمن: {canaryResult.success ? 'موفق' : 'ناموفق'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">شماره: {canaryResult.masked_phone}</p>
            {canaryResult.error && (
              <p className="text-xs text-red-600 dark:text-red-400">خطا: {errorLabel(canaryResult.error)}</p>
            )}
          </div>
        )}

        {repairResult && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              نتیجه آزمایش ایمن: {repairResult.canary_passed ? 'موفق' : 'ناموفق'}
            </p>
            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>کل: {repairResult.total ?? 0}</span>
              <span className="text-green-600 dark:text-green-400">موفق: {repairResult.succeeded ?? 0}</span>
              <span className="text-red-600 dark:text-red-400">ناموفق: {repairResult.failed ?? 0}</span>
            </div>
            {repairResult.results?.some(r => !r.success && r.error) && (
              <div className="space-y-1 mt-2">
                {repairResult.results.filter(r => !r.success && r.error).map((r, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">{errorLabel(r.error)}</p>
                ))}
              </div>
            )}
          </div>
        )}

        {showConfirm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-gray-800 dark:text-white">تأیید ترمیم گروهی</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                ابتدا هویت یک کاربر از مسیر رسمی احراز هویت، به‌صورت آزمایشی ترمیم و بررسی می‌شود.
                فقط در صورت موفقیت کامل، ترمیم بقیه کاربران آغاز خواهد شد.
              </p>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                پس از تأیید، کد ۶ رقمی احراز هویت دومرحله‌ای از شما خواسته می‌شود.
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors"
                >
                  انصراف
                </button>
                <button
                  onClick={handleRepair}
                  className="flex-1 px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  تأیید و شروع
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
