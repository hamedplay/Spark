import { useCallback, useState } from 'react';
import { AlertTriangle, Loader as Loader2, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { SecurityStepUpDialog } from './SecurityStepUpDialog';
import {
  clearMalformedPhoneRecord,
  listMalformedPhoneRecords,
  type MalformedPhoneRecord,
} from '../services/malformedPhoneCleanupService';

const CLEAR_ERROR_MESSAGES: Record<string, string> = {
  UNAUTHORIZED: 'نشست کاربری معتبر نیست. دوباره وارد شوید.',
  SESSION_REQUIRED: 'شناسه نشست امنیتی در دسترس نیست. دوباره وارد شوید.',
  SESSION_INVALID: 'نشست امنیتی معتبر نیست. دوباره وارد شوید.',
  SECURITY_ADMIN_REQUIRED: 'فقط مدیر امنیت اجازه پاک‌سازی این شماره‌ها را دارد.',
  STEPUP_REQUIRED: 'برای حذف شماره، تأیید دومرحله‌ای لازم است.',
  PHONE_NOT_MALFORMED: 'این شماره دیگر در وضعیت مشکل‌دار نیست. فهرست به‌روزرسانی شد.',
  INVALID_USER_ID: 'شناسه کاربر نامعتبر است.',
};

export function MalformedPhoneCleanupCard() {
  const [records, setRecords] = useState<MalformedPhoneRecord[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clearingUserId, setClearingUserId] = useState<string | null>(null);
  const [pendingRecord, setPendingRecord] = useState<MalformedPhoneRecord | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await listMalformedPhoneRecords();
      setRecords(result);
      setExpanded(true);
    } catch {
      toast.error('خطا در دریافت شماره‌های مشکل‌دار.');
    } finally {
      setLoading(false);
    }
  }, []);

  const requestClear = useCallback((record: MalformedPhoneRecord) => {
    setPendingRecord(record);
    setStepUpOpen(true);
  }, []);

  const handleStepUpSuccess = useCallback(async () => {
    if (!pendingRecord) return;

    const target = pendingRecord;
    setClearingUserId(target.user_id);
    try {
      const result = await clearMalformedPhoneRecord(target.user_id);

      if (!result.ok) {
        const message = CLEAR_ERROR_MESSAGES[result.error ?? ''] ?? 'حذف شماره مشکل‌دار انجام نشد.';
        toast.error(message);
        if (result.error === 'PHONE_NOT_MALFORMED') {
          await loadRecords();
        }
        return;
      }

      toast.success('شماره مشکل‌دار با موفقیت حذف شد.');
      setRecords((current) => current.filter((item) => item.user_id !== target.user_id));
      setPendingRecord(null);
      setStepUpOpen(false);
    } finally {
      setClearingUserId(null);
    }
  }, [pendingRecord, loadRecords]);

  const pendingLabel = pendingRecord?.email || pendingRecord?.user_id || 'کاربر انتخاب‌شده';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-700/40 overflow-hidden">
      <SecurityStepUpDialog
        open={stepUpOpen}
        purpose="auth_settings_change"
        title="تأیید حذف شماره مشکل‌دار"
        description={`پس از تأیید TOTP فقط شماره خراب برای ${pendingLabel} پاک می‌شود؛ حساب کاربری و ایمیل حذف نمی‌شوند.`}
        confirmLabel="تأیید و حذف شماره"
        onClose={() => {
          if (clearingUserId) return;
          setStepUpOpen(false);
          setPendingRecord(null);
        }}
        onSuccess={handleStepUpSuccess}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 flex-shrink-0">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-gray-800 dark:text-white">پاک‌سازی شماره‌های مشکل‌دار</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              شماره‌های Legacy با فرمت خراب مانند <span dir="ltr" className="font-mono">0912... .0</span> یا <span dir="ltr" className="font-mono">+98912... .0</span> را نمایش می‌دهد.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadRecords}
          disabled={loading || clearingUserId !== null}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-amber-200 dark:border-amber-700/50 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm font-medium hover:bg-amber-100 dark:hover:bg-amber-900/30 transition disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : expanded ? <RefreshCw className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {loading ? 'در حال بررسی...' : expanded ? 'به‌روزرسانی فهرست' : 'نمایش شماره‌های مشکل‌دار'}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-amber-100 dark:border-amber-800/40">
          {records.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
              هیچ شماره مشکل‌داری پیدا نشد. ✅
            </div>
          ) : (
            <div className="divide-y divide-gray-100 dark:divide-gray-700">
              {records.map((record) => (
                <div key={record.user_id} className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                        {record.email || 'بدون ایمیل'}
                      </p>
                      <p className="text-xs text-gray-400 font-mono mt-1 break-all" dir="ltr">
                        {record.user_id}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => requestClear(record)}
                      disabled={clearingUserId !== null}
                      className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800/50 hover:bg-red-100 dark:hover:bg-red-900/30 text-sm font-medium transition disabled:opacity-50"
                    >
                      {clearingUserId === record.user_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      حذف شماره
                    </button>
                  </div>

                  <div className="grid gap-2 md:grid-cols-2">
                    <PhoneValueRow label="Profile" value={record.profile_phone} problem={record.profile_problem} />
                    <PhoneValueRow label="Auth" value={record.auth_phone} problem={record.auth_problem} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PhoneValueRow({ label, value, problem }: { label: string; value: string | null; problem: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${problem ? 'border-red-200 dark:border-red-800/50 bg-red-50/60 dark:bg-red-900/10' : 'border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30'}`}>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</span>
        {problem && (
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400">
            مشکل‌دار
          </span>
        )}
      </div>
      <div className="text-sm font-mono text-gray-800 dark:text-gray-200 break-all" dir="ltr">
        {value || '—'}
      </div>
    </div>
  );
}
