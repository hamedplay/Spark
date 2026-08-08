import { useState, useEffect } from 'react';
import { ShieldCheck, Loader as Loader2, RefreshCw, FlaskConical, Wrench, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
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

export function IdentityRepairCard() {
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [summary, setSummary] = useState<DryRunSummary | null>(null);
  const [busy, setBusy] = useState<string>('');
  const [canaryResult, setCanaryResult] = useState<CanaryResult | null>(null);
  const [repairResult, setRepairResult] = useState<RepairResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('user_id', userData.user.id)
          .maybeSingle();
        setIsAdmin(profile?.is_admin === true);
      }
      setLoading(false);
    })();
  }, []);

  const invokeBulkSync = async (mode: string): Promise<RepairResponse | null> => {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) { toast.error('نشست معتبر نیست'); return null; }

    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bulk-sync-profile-phones`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ mode }),
      },
    );
    const json = (await resp.json()) as RepairResponse;
    if (!resp.ok || !json.ok) {
      toast.error(json.error || 'خطا در اجرای عملیات');
      return null;
    }
    return json;
  };

  const handleCheckStatus = async () => {
    setBusy('dry_run');
    setCanaryResult(null);
    setRepairResult(null);
    const result = await invokeBulkSync('dry_run');
    if (result?.summary) setSummary(result.summary as DryRunSummary);
    setBusy('');
  };

  const handleCanary = async () => {
    setBusy('identity_canary');
    setCanaryResult(null);
    const result = await invokeBulkSync('identity_canary');
    if (result?.canary_result) {
      setCanaryResult(result.canary_result);
      if (result.canary_passed) toast.success('Canary موفق بود');
      else toast.error('Canary ناموفق بود');
    }
    setBusy('');
  };

  const handleRepair = async () => {
    setShowConfirm(false);
    setBusy('identity_repair');
    setRepairResult(null);
    const result = await invokeBulkSync('identity_repair');
    if (result) {
      setRepairResult(result);
      if (result.failed && result.failed > 0) toast.error(`${result.failed} کاربر ناموفق`);
      else toast.success('ترمیم تکمیل شد');
      const dryResult = await invokeBulkSync('dry_run');
      if (dryResult?.summary) setSummary(dryResult.summary as DryRunSummary);
    }
    setBusy('');
  };

  if (loading || !isAdmin) return null;

  const repairNeeded = summary?.IDENTITY_REPAIR_REQUIRED ?? 0;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400">
          <ShieldCheck className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">ترمیم یکپارچگی ورود با موبایل</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">بررسی و ترمیم هویت موبایلی کاربران در Supabase Auth</p>
        </div>
      </div>

      <div className="space-y-3">
        {summary && (
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(summary).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                <span className="text-gray-600 dark:text-gray-300">{STATUS_LABELS[key] || key}</span>
                <span className="font-bold text-gray-800 dark:text-white">{val ?? 0}</span>
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
            اجرای Canary
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
              Canary: {canaryResult.success ? 'PASS' : 'FAIL'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">شماره: {canaryResult.masked_phone}</p>
            {canaryResult.error && (
              <p className="text-xs text-red-600 dark:text-red-400">خطا: {canaryResult.error}</p>
            )}
          </div>
        )}

        {repairResult && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Canary: {repairResult.canary_passed ? 'PASS' : 'FAIL'}
            </p>
            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>کل: {repairResult.total ?? 0}</span>
              <span className="text-green-600 dark:text-green-400">موفق: {repairResult.succeeded ?? 0}</span>
              <span className="text-red-600 dark:text-red-400">ناموفق: {repairResult.failed ?? 0}</span>
            </div>
            {repairResult.results?.some(r => !r.success && r.error) && (
              <div className="space-y-1 mt-2">
                {repairResult.results.filter(r => !r.success && r.error).map((r, i) => (
                  <p key={i} className="text-xs text-red-600 dark:text-red-400">{r.error}</p>
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
                ابتدا یک کاربر به‌عنوان Canary از مسیر رسمی Auth ترمیم و بررسی می‌شود.
                فقط در صورت موفقیت کامل، ترمیم بقیه کاربران آغاز خواهد شد.
              </p>
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
