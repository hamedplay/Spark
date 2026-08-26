import { useRef, useState } from 'react';
import { UserX, UserCheck, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile } from './types';
import { DetailPanel } from './DetailPanel';

interface LifecycleResponse {
  ok?: boolean;
  error?: string;
}

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
    case 'INVALID_TRANSITION':
      return 'وضعیت فعلی حساب اجازه این تغییر را نمی‌دهد.';
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
  const isActive = user.is_active !== false;
  const [saving, setSaving] = useState(false);
  const operationRef = useRef(false);
  const toastId = `admin-user-lifecycle-${user.user_id}`;

  const handle = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setSaving(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error('نشست ورود معتبر نیست.', { id: toastId });
        return;
      }

      const action = isActive ? 'SUSPEND' : 'REACTIVATE';
      const reason = isActive
        ? 'غیرفعال‌سازی حساب توسط مدیر از پنل مدیریت کاربران'
        : 'فعال‌سازی مجدد حساب توسط مدیر از پنل مدیریت کاربران';

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

      toast.success(isActive ? 'کاربر با موفقیت غیرفعال شد.' : 'کاربر با موفقیت فعال شد.', { id: toastId });
      onDone();
    } catch {
      toast.error('ارتباط با سرویس مدیریت حساب برقرار نشد.', { id: toastId });
    } finally {
      operationRef.current = false;
      setSaving(false);
    }
  };

  return (
    <DetailPanel title={isActive ? 'غیرفعال کردن کاربر' : 'فعال کردن کاربر'} icon={isActive ? UserX : UserCheck} iconColor={isActive ? 'text-red-500' : 'text-green-500'} user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          {isActive
            ? `با غیرفعال کردن "${user.full_name || user.email}" دسترسی به سامانه مسدود و نشست‌های فعال لغو می‌شوند؛ اطلاعات و سوابق سازمانی حذف نمی‌شوند.`
            : `با فعال کردن "${user.full_name || user.email}" دسترسی به سامانه بازگردانده می‌شود.`}
        </p>
        <div className="flex gap-3">
          <button onClick={handle} disabled={saving}
            className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-60 ${isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            {saving ? 'در حال انجام...' : isActive ? 'غیرفعال کن' : 'فعال کن'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </DetailPanel>
  );
}

export { DeactivatePanel };
