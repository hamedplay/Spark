import { useCallback, useState } from 'react';
import { AlertTriangle, Loader as Loader2, RefreshCw, Trash2, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  clearMalformedPhoneRecord,
  loadMalformedPhoneRecords,
  type MalformedPhoneRecord,
} from '../services/securitySettingsService';
import { SecurityStepUpDialog } from './SecurityStepUpDialog';

function cleanupErrorMessage(error?: string): string {
  switch (error) {
    case 'UNAUTHORIZED':
    case 'SESSION_REQUIRED':
    case 'SESSION_INVALID':
      return 'نشست شما معتبر نیست. لطفاً دوباره وارد شوید.';
    case 'SECURITY_ADMIN_REQUIRED':
      return 'فقط مدیر امنیت اجازه انجام این عملیات را دارد.';
    case 'STEPUP_REQUIRED':
      return 'برای حذف شماره مشکل‌دار، تأیید دومرحله‌ای الزامی است.';
    case 'PHONE_NOT_MALFORMED':
      return 'این شماره دیگر در وضعیت مشکل‌دار نیست. فهرست دوباره بارگذاری می‌شود.';
    case 'INVALID_USER_ID':
      return 'شناسه کاربر معتبر نیست.';
    default:
      return 'عملیات پاک‌سازی شماره موبایل انجام نشد.';
  }
}

export function MalformedPhoneCleanupPanel() {
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<MalformedPhoneRecord[]>([]);
  const [pendingRecord, setPendingRecord] = useState<MalformedPhoneRecord | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [clearingUserId, setClearingUserId] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadMalformedPhoneRecords();
      if (!result.ok) {
        toast.error('فهرست شماره‌های مشکل‌دار بارگذاری نشد.');
        return;
      }
      setRecords(result.records);
      setLoaded(true);
    } catch (error) {
      console.error('[MALFORMED_PHONE_CLEANUP] Failed to load records:', error);
      toast.error('فهرست شماره‌های مشکل‌دار بارگذاری نشد.');
    } finally {
      setLoading(false);
    }
  }, []);

  const requestClear = useCallback((record: MalformedPhoneRecord) => {
    setPendingRecord(record);
    setStepUpOpen(true);
  }, []);

  const handleStepUpSuccess = useCallback(async () => {
    setStepUpOpen(false);
    if (!pendingRecord) return;

    const target = pendingRecord;
    setClearingUserId(target.user_id);
    try {
      const result = await clearMalformedPhoneRecord(target.user_id);
      if (!result.ok) {
        toast.error(cleanupErrorMessage(result.error));
        if (result.error === 'PHONE_NOT_MALFORMED') {
          await loadRecords();
        }
        return;
      }

      const clearedScopes = [
        result.profile_phone_cleared ? 'پروفایل' : null,
        result.auth_phone_cleared ? 'Auth' : null,
      ].filter(Boolean).join(' و ');

      toast.success(clearedScopes ? `شماره مشکل‌دار از ${clearedScopes} پاک شد.` : 'شماره مشکل‌دار پاک شد.');
      setPendingRecord(null);
      await loadRecords();
    } catch (error) {
      console.error('[MALFORMED_PHONE_CLEANUP] Failed to clear record:', error);
      toast.error('پاک‌سازی شماره موبایل انجام نشد.');
    } finally {
      setClearingUserId(null);
    }
  }, [pendingRecord, loadRecords]);

  const closeStepUp = useCallback(() => {
    setStepUpOpen(false);
    setPendingRecord(null);
  }, []);

  return (
    <>
      <SecurityStepUpDialog
        open={stepUpOpen}
        purpose="auth_settings_change"
        title="تأیید پاک‌سازی شماره موبایل"
        description="این عملیات فقط مقدار شماره موبایل مشکل‌دار را پاک می‌کند و حساب کاربر یا ایمیل او حذف نمی‌شود. برای ادامه، کد TOTP را وارد کنید."
        confirmLabel="تأیید و پاک‌سازی"
        onClose={closeStepUp}
        onSuccess={handleStepUpSuccess}
      />

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-800/50 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-amber-100 dark:border-amber-800/40 bg-amber-50/60 dark:bg-amber-900/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-gray-800 dark:text-white text-sm">پاک‌سازی شماره‌های مشکل‌دار</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">شناسایی شماره‌های قدیمی خراب مانند مقادیر دارای پسوند .0</p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadRecords}
            disabled={loading || clearingUserId !== null}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition-colors"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loaded ? 'بررسی مجدد' : 'بررسی شماره‌های مشکل‌دار'}
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              حذف از این بخش فقط شماره موبایل معیوب را در Profile و/یا Auth پاک می‌کند؛ خود کاربر، ایمیل، نام کاربری و سایر اطلاعات حساب حذف نمی‌شوند. حذف نیازمند تأیید TOTP است.
            </span>
          </div>

          {!loaded && !loading && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              برای مشاهده شماره‌های مشکل‌دار، دکمه «بررسی شماره‌های مشکل‌دار» را بزنید.
            </p>
          )}

          {loaded && records.length === 0 && !loading && (
            <div className="text-center py-5">
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">شماره موبایل مشکل‌داری پیدا نشد.</p>
              <p className="text-xs text-gray-400 mt-1">در حال حاضر رکوردی با الگوی خرابی شناخته‌شده وجود ندارد.</p>
            </div>
          )}

          {records.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{records.length.toLocaleString('fa-IR')} رکورد مشکل‌دار پیدا شد.</span>
                <span>حذف هر رکورد به‌صورت مستقل انجام می‌شود.</span>
              </div>

              {records.map((record) => {
                const clearing = clearingUserId === record.user_id;
                return (
                  <div
                    key={record.user_id}
                    className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-700/30 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                          {record.email || 'ایمیل ثبت نشده'}
                        </p>
                        <p className="text-[11px] text-gray-400 font-mono mt-1 break-all" dir="ltr">
                          {record.user_id}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => requestClear(record)}
                        disabled={clearingUserId !== null}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        {clearing ? 'در حال پاک‌سازی...' : 'حذف شماره خراب'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <PhoneValue
                        label="Profile"
                        value={record.profile_phone}
                        problematic={record.profile_problem}
                      />
                      <PhoneValue
                        label="Auth"
                        value={record.auth_phone}
                        problematic={record.auth_problem}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PhoneValue({ label, value, problematic }: { label: string; value: string | null; problematic: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${problematic ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20' : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</span>
        {problematic && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-300">مشکل‌دار</span>}
      </div>
      <p className={`text-sm font-mono break-all ${problematic ? 'text-red-700 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`} dir="ltr">
        {value || '—'}
      </p>
    </div>
  );
}
