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
      return 'برای انجام اصلاح، تأیید دومرحله‌ای الزامی است.';
    case 'ORPHAN_AUTH_USER_NOT_ELIGIBLE':
      return 'این رکورد دیگر شرایط اصلاح را ندارد. فهرست دوباره بارگذاری می‌شود.';
    case 'USER_HAS_REFERENCES':
      return 'این رکورد به اطلاعات دیگری در سامانه متصل است و برای جلوگیری از تغییر ناخواسته اصلاح نشد.';
    default:
      return 'عملیات اصلاح رکورد ناقص انجام نشد.';
  }
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
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
        toast.error('فهرست رکوردهای ناقص بارگذاری نشد.');
        return;
      }
      setRecords(result.records);
      setLoaded(true);
    } catch (error) {
      console.error('[MALFORMED_PHONE_CLEANUP] Failed to load orphan auth users:', error);
      toast.error('فهرست رکوردهای ناقص بارگذاری نشد.');
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
    setClearingUserId(target.auth_user_id);
    try {
      const result = await clearMalformedPhoneRecord(target.auth_user_id);
      if (!result.ok) {
        toast.error(cleanupErrorMessage(result.error));
        if (result.error === 'ORPHAN_AUTH_USER_NOT_ELIGIBLE') {
          await loadRecords();
        }
        return;
      }

      toast.success('رکورد ناقص اصلاح شد و شماره برای ثبت صحیح آزاد شد.');
      setPendingRecord(null);
      await loadRecords();
    } catch (error) {
      console.error('[MALFORMED_PHONE_CLEANUP] Failed to fix orphan auth user:', error);
      toast.error('اصلاح رکورد ناقص انجام نشد.');
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
        title="تأیید اصلاح رکورد ناقص"
        description="این عملیات رکورد Auth بدون Profile را پاک‌سازی می‌کند تا شماره یا ایمیل باقی‌مانده مانع ثبت صحیح کاربر نشود. فقط رکوردهایی که همچنان بدون Profile هستند قابل اصلاح‌اند. برای ادامه، کد TOTP را وارد کنید."
        confirmLabel="تأیید و فیکس"
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
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">شناسایی Auth Userهای بدون Profile که شماره موبایل یا ایمیل واقعی دارند</p>
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
              این بخش رکوردهای Auth بدون Profile را نمایش می‌دهد. دکمه «فیکس» رکورد ناقص را پاک‌سازی می‌کند؛ اگر رکورد به داده دیگری وابسته باشد، عملیات متوقف می‌شود. انجام اصلاح نیازمند تأیید TOTP است.
            </span>
          </div>

          {!loaded && !loading && (
            <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              برای مشاهده رکوردهای مشکل‌دار، دکمه «بررسی شماره‌های مشکل‌دار» را بزنید.
            </p>
          )}

          {loaded && records.length === 0 && !loading && (
            <div className="text-center py-5">
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">رکورد ناقصی پیدا نشد.</p>
              <p className="text-xs text-gray-400 mt-1">هیچ Auth User بدون Profile دارای شماره یا ایمیل واقعی وجود ندارد.</p>
            </div>
          )}

          {records.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>{records.length.toLocaleString('fa-IR')} رکورد مشکل‌دار پیدا شد.</span>
                <span>هر رکورد به‌صورت مستقل فیکس می‌شود.</span>
              </div>

              {records.map((record) => {
                const clearing = clearingUserId === record.auth_user_id;
                return (
                  <div
                    key={record.auth_user_id}
                    className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-gray-50 dark:bg-gray-700/30 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                          {record.email || 'ایمیل ثبت نشده'}
                        </p>
                        <p className="text-[11px] text-gray-400 font-mono mt-1 break-all" dir="ltr">
                          {record.auth_user_id}
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => requestClear(record)}
                        disabled={clearingUserId !== null}
                        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-lg text-xs font-medium transition-colors"
                      >
                        {clearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        {clearing ? 'در حال فیکس...' : 'فیکس'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <ValueCard label="شماره ثبت‌شده" value={record.phone || '—'} dir="ltr" />
                      <ValueCard label="شماره نرمال‌شده" value={record.normalized_phone || '—'} dir="ltr" />
                      <ValueCard label="تاریخ ایجاد Auth" value={formatDate(record.created_at)} />
                      <ValueCard label="آخرین ورود" value={formatDate(record.last_sign_in_at)} />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <StatusBadge active={record.has_phone} label="دارای شماره" />
                      <StatusBadge active={record.has_real_email} label="دارای ایمیل واقعی" />
                      <span className="text-[10px] px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                        Profile ندارد
                      </span>
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

function ValueCard({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="rounded-lg p-3 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{label}</span>
      <p className="text-sm text-gray-700 dark:text-gray-200 mt-1 break-all" dir={dir}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`text-[10px] px-2 py-1 rounded-full ${active ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
      {label}: {active ? 'بله' : 'خیر'}
    </span>
  );
}
