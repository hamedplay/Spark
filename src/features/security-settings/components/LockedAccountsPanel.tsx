import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader as Loader2, RefreshCw, Unlock, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  loadLockedAccounts,
  unlockLockedAccount,
  type LockedAccountRecord,
} from '../services/securitySettingsService';
import { SecurityStepUpDialog } from './SecurityStepUpDialog';

function unlockErrorMessage(error?: string): string {
  switch (error) {
    case 'UNAUTHORIZED':
    case 'SESSION_INVALID':
      return 'نشست شما معتبر نیست. لطفاً دوباره وارد شوید.';
    case 'SECURITY_ADMIN_REQUIRED':
      return 'فقط مدیر امنیت اجازه آزادسازی حساب را دارد.';
    case 'STEPUP_REQUIRED':
      return 'برای آزادسازی حساب، تأیید دومرحله‌ای الزامی است.';
    case 'NOT_LOCKED':
      return 'این حساب دیگر قفل نیست. فهرست دوباره بارگذاری می‌شود.';
    case 'INVALID_USER_ID':
      return 'شناسه کاربر معتبر نیست.';
    default:
      return 'آزادسازی حساب انجام نشد.';
  }
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('fa-IR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function displayName(account: LockedAccountRecord): string {
  return account.full_name?.trim()
    || account.username?.trim()
    || account.email?.trim()
    || 'کاربر بدون نام';
}

export function LockedAccountsPanel() {
  const [records, setRecords] = useState<LockedAccountRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingAccount, setPendingAccount] = useState<LockedAccountRecord | null>(null);
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [unlockingUserId, setUnlockingUserId] = useState<string | null>(null);

  const loadRecords = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadLockedAccounts();
      if (!result.ok) {
        console.error('[LOCKED_ACCOUNTS] Failed to load records:', result.error);
        toast.error('فهرست حساب‌های قفل‌شده بارگذاری نشد.');
        return;
      }
      setRecords(result.records);
    } catch (error) {
      console.error('[LOCKED_ACCOUNTS] Failed to load records:', error);
      toast.error('فهرست حساب‌های قفل‌شده بارگذاری نشد.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  const requestUnlock = useCallback((account: LockedAccountRecord) => {
    setPendingAccount(account);
    setStepUpOpen(true);
  }, []);

  const closeStepUp = useCallback(() => {
    setStepUpOpen(false);
    setPendingAccount(null);
  }, []);

  const handleStepUpSuccess = useCallback(async () => {
    setStepUpOpen(false);
    if (!pendingAccount) return;

    const target = pendingAccount;
    setUnlockingUserId(target.user_id);
    try {
      const result = await unlockLockedAccount(target.user_id);
      if (!result.ok) {
        toast.error(unlockErrorMessage(result.error));
        if (result.error === 'NOT_LOCKED') {
          await loadRecords();
        }
        return;
      }

      toast.success(`قفل حساب «${displayName(target)}» آزاد شد.`);
      setPendingAccount(null);
      await loadRecords();
    } catch (error) {
      console.error('[LOCKED_ACCOUNTS] Failed to unlock account:', error);
      toast.error('آزادسازی حساب انجام نشد.');
    } finally {
      setUnlockingUserId(null);
    }
  }, [pendingAccount, loadRecords]);

  return (
    <>
      <SecurityStepUpDialog
        open={stepUpOpen}
        purpose="account_security_change"
        title="تأیید آزادسازی حساب"
        description={pendingAccount
          ? `برای آزادسازی قفل حساب «${displayName(pendingAccount)}»، کد TOTP را وارد کنید. شمارنده تلاش‌های ناموفق نیز از این لحظه بازنشانی می‌شود.`
          : 'برای آزادسازی حساب، کد TOTP را وارد کنید.'}
        confirmLabel="تأیید و آزادسازی"
        onClose={closeStepUp}
        onSuccess={handleStepUpSuccess}
      />

      <div className="mt-5 pt-5 border-t border-gray-200 dark:border-gray-700 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <UserRound className="w-4 h-4 text-amber-500" />
              <h4 className="text-sm font-bold text-gray-800 dark:text-white">حساب‌های قفل‌شده</h4>
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              حساب‌های دارای قفل موقت و حساب‌هایی که نیازمند آزادسازی مدیر هستند.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void loadRecords()}
            disabled={loading || unlockingUserId !== null}
            className="flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            بررسی مجدد
          </button>
        </div>

        <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            آزادسازی، قفل جاری را حذف و شمارنده امنیتی تلاش‌های ناموفق را از همان لحظه بازنشانی می‌کند؛ تاریخچه رویدادهای قبلی حذف نمی‌شود و عملیات در Audit ثبت می‌شود.
          </span>
        </div>

        {loading && records.length === 0 ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
          </div>
        ) : records.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/50 bg-emerald-50 dark:bg-emerald-900/10 px-4 py-5 text-center">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">در حال حاضر حساب قفل‌شده‌ای وجود ندارد.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {records.length.toLocaleString('fa-IR')} حساب قفل‌شده
            </div>

            {records.map((account) => {
              const unlocking = unlockingUserId === account.user_id;
              const permanent = account.lock_type === 'admin';

              return (
                <div
                  key={account.user_id}
                  className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/30 p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-800 dark:text-white truncate">
                          {displayName(account)}
                        </p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${permanent
                          ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                          : 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                        }`}>
                          {permanent ? 'قفل مدیریتی / دائمی' : 'قفل موقت'}
                        </span>
                      </div>
                      {account.email && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1" dir="ltr">{account.email}</p>
                      )}
                      <p className="text-[10px] text-gray-400 font-mono mt-1 break-all" dir="ltr">{account.user_id}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => requestUnlock(account)}
                      disabled={unlockingUserId !== null}
                      className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
                    >
                      {unlocking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5" />}
                      {unlocking ? 'در حال آزادسازی...' : 'آزادسازی قفل'}
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
                    <InfoCell label="نام کاربری" value={account.username || '—'} dir="ltr" />
                    <InfoCell label="موبایل" value={account.phone || '—'} dir="ltr" />
                    <InfoCell
                      label="پایان قفل"
                      value={permanent ? 'نیازمند آزادسازی مدیر امنیت' : formatDateTime(account.locked_until)}
                    />
                    <InfoCell
                      label="وضعیت تلاش‌ها"
                      value={`${account.failure_count.toLocaleString('fa-IR')} تلاش${account.lock_level > 0 ? ` — سطح ${account.lock_level.toLocaleString('fa-IR')}` : ''}`}
                    />
                  </div>

                  {account.last_failure_at && (
                    <p className="text-[11px] text-gray-400">
                      آخرین تلاش ناموفق: {formatDateTime(account.last_failure_at)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function InfoCell({ label, value, dir }: { label: string; value: string; dir?: 'ltr' | 'rtl' }) {
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <p className="text-[10px] text-gray-400 mb-1">{label}</p>
      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 break-words" dir={dir}>{value}</p>
    </div>
  );
}
