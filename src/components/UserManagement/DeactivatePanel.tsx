import { useRef, useState } from 'react';
import { UserX, UserCheck, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile } from './types';
import { DetailPanel } from './DetailPanel';

interface LifecycleResponse {
  ok?: boolean;
  user_id?: string;
  new_status?: string;
  error?: string;
}

type LifecycleAction = 'SUSPEND' | 'REACTIVATE' | 'APPROVE_REGISTRATION' | 'REJECT_REGISTRATION';

function lifecycleErrorMessage(code?: string): string {
  switch (code) {
    case 'SELF_CHANGE_FORBIDDEN':
      return 'نمی‌توانید وضعیت حساب خودتان را از این بخش تغییر دهید.';
    case 'LAST_ADMIN_FORBIDDEN':
      return 'آخرین مدیر فعال سامانه قابل غیرفعال‌سازی نیست.';
    case 'LAST_SECURITY_ADMIN_FORBIDDEN':
      return 'آخرین مدیر امنیتی فعال سامانه قابل غیرفعال‌سازی نیست.';
    case 'PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN':
      return 'تغییر وضعیت مدیر یا مدیر امنیتی فقط توسط مدیر امنیتی مجاز است.';
    case 'NOT_ADMIN':
      return 'این عملیات فقط برای مدیر فعال سامانه مجاز است.';
    case 'REGISTRATION_SOURCE_INVALID':
      return 'این حساب از مسیر ثبت‌نام عمومی ایجاد نشده و قابل تأیید از این مسیر نیست.';
    case 'INVALID_TRANSITION':
      return 'وضعیت فعلی حساب اجازه این تغییر را نمی‌دهد. فهرست را تازه‌سازی کنید.';
    case 'VERSION_CONFLICT':
      return 'وضعیت حساب هم‌زمان تغییر کرده است. فهرست را تازه‌سازی و دوباره تلاش کنید.';
    case 'AUTH_ACCESS_RESTRICTED':
    case 'SESSION_INVALID':
      return 'نشست فعلی اجازه انجام این عملیات را ندارد.';
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'تنظیمات امنیتی مدیریت حساب در دسترس نیست.';
    default:
      return 'تغییر وضعیت حساب انجام نشد.';
  }
}

function DeactivatePanel({ user, onBack, onDone }: { user: AdminProfile; onBack: () => void; onDone: () => void }) {
  const isPendingRegistration = user.account_status === 'PENDING_ADMIN_APPROVAL';
  const isActive = user.is_active !== false;
  const [savingAction, setSavingAction] = useState<LifecycleAction | null>(null);
  const operationRef = useRef(false);
  const toastId = `admin-user-lifecycle-${user.user_id}`;

  const runAction = async (action: LifecycleAction) => {
    if (operationRef.current) return;
    operationRef.current = true;
    setSavingAction(action);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error('نشست ورود معتبر نیست.', { id: toastId });
        return;
      }

      const reason = action === 'SUSPEND'
        ? 'غیرفعال‌سازی حساب توسط مدیر از پنل مدیریت کاربران'
        : action === 'REACTIVATE'
          ? 'فعال‌سازی مجدد حساب توسط مدیر از پنل مدیریت کاربران'
          : action === 'APPROVE_REGISTRATION'
            ? 'تأیید ثبت‌نام عمومی کاربر توسط مدیر از پنل مدیریت کاربران'
            : 'رد ثبت‌نام عمومی کاربر توسط مدیر از پنل مدیریت کاربران';

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-user-lifecycle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: user.user_id, action, reason }),
      });
      const result = await response.json().catch(() => ({})) as LifecycleResponse;

      if (!response.ok || result.ok !== true) {
        toast.error(lifecycleErrorMessage(result.error), { id: toastId });
        return;
      }

      const successMessage = action === 'SUSPEND'
        ? 'کاربر با موفقیت غیرفعال شد.'
        : action === 'REACTIVATE'
          ? 'کاربر با موفقیت فعال شد.'
          : action === 'APPROVE_REGISTRATION'
            ? 'ثبت‌نام تأیید شد و حساب کاربر فعال شد.'
            : 'ثبت‌نام رد شد و دسترسی حساب مسدود باقی ماند.';
      toast.success(successMessage, { id: toastId });
      onDone();
    } catch {
      toast.error('ارتباط با سرویس مدیریت حساب برقرار نشد.', { id: toastId });
    } finally {
      operationRef.current = false;
      setSavingAction(null);
    }
  };

  if (isPendingRegistration) {
    const approving = savingAction === 'APPROVE_REGISTRATION';
    const rejecting = savingAction === 'REJECT_REGISTRATION';
    const saving = savingAction !== null;

    return (
      <DetailPanel title="بررسی ثبت‌نام کاربر" icon={UserCheck} iconColor="text-amber-500" user={user} onBack={onBack}>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
          <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 p-4 mb-6">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">این حساب در انتظار تأیید مدیر است.</p>
            <p className="text-xs leading-5 text-amber-700 dark:text-amber-300 mt-1">
              تأیید، وضعیت حساب را به «فعال» تغییر می‌دهد. رد ثبت‌نام، حساب را در وضعیت «ردشده» نگه می‌دارد و نشست‌های احتمالی آن را لغو می‌کند. هر دو عملیات در تاریخچه امنیتی ثبت می‌شوند.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runAction('APPROVE_REGISTRATION')}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition"
            >
              {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
              {approving ? 'در حال تأیید...' : 'تأیید و فعال‌سازی'}
            </button>
            <button
              type="button"
              onClick={() => void runAction('REJECT_REGISTRATION')}
              disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition"
            >
              {rejecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserX className="w-4 h-4" />}
              {rejecting ? 'در حال رد...' : 'رد ثبت‌نام'}
            </button>
            <button onClick={onBack} disabled={saving} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
          </div>
        </div>
      </DetailPanel>
    );
  }

  const action: LifecycleAction = isActive ? 'SUSPEND' : 'REACTIVATE';
  const saving = savingAction !== null;

  return (
    <DetailPanel title={isActive ? 'غیرفعال کردن کاربر' : 'فعال کردن کاربر'} icon={isActive ? UserX : UserCheck} iconColor={isActive ? 'text-red-500' : 'text-green-500'} user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          {isActive
            ? `با غیرفعال کردن "${user.full_name || user.email}" دسترسی به سامانه مسدود و نشست‌های فعال لغو می‌شوند؛ اطلاعات و سوابق سازمانی حذف نمی‌شوند.`
            : `با فعال کردن "${user.full_name || user.email}" دسترسی به سامانه بازگردانده می‌شود.`}
        </p>
        <div className="flex gap-3">
          <button onClick={() => void runAction(action)} disabled={saving}
            className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-60 ${isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            {saving ? 'در حال انجام...' : isActive ? 'غیرفعال کن' : 'فعال کن'}
          </button>
          <button onClick={onBack} disabled={saving} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-60 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </DetailPanel>
  );
}

export { DeactivatePanel };
