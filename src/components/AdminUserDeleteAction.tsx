import { useRef, useState } from 'react';
import { Loader as Loader2, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface AdminUserDeleteActionProps {
  userId: string;
  fullName?: string | null;
  email?: string | null;
  onDeleted: () => void | Promise<void>;
}

interface DeleteResponse {
  ok?: boolean;
  error?: string;
  has_storage_objects?: boolean;
  has_protected_records?: boolean;
}

interface RetireResponse {
  ok?: boolean;
  error?: string;
  retryable?: boolean;
  identifiers_released?: boolean;
  history_preserved?: boolean;
}

function deleteErrorMessage(result: DeleteResponse): string {
  switch (result.error) {
    case 'SELF_DELETE_FORBIDDEN':
      return 'برای جلوگیری از قفل شدن مدیریت سامانه، نمی‌توانید حساب خودتان را حذف کنید.';
    case 'LAST_ADMIN_FORBIDDEN':
      return 'آخرین مدیر فعال سامانه قابل حذف نیست.';
    case 'LAST_SECURITY_ADMIN_FORBIDDEN':
      return 'آخرین مدیر امنیتی فعال سامانه قابل حذف نیست.';
    case 'PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN':
      return 'حذف حساب مدیر یا مدیر امنیتی فقط توسط مدیر امنیتی مجاز است.';
    case 'USER_HAS_DEPENDENCIES':
      if (result.has_storage_objects && result.has_protected_records) {
        return 'این کاربر فایل و سوابق سازمانی محافظت‌شده دارد و حذف فیزیکی آن مجاز نیست.';
      }
      if (result.has_storage_objects) {
        return 'این کاربر مالک فایل در سامانه است و حذف فیزیکی آن مجاز نیست.';
      }
      return 'این کاربر سوابق سازمانی محافظت‌شده دارد و حذف فیزیکی آن مجاز نیست.';
    case 'USER_NOT_FOUND':
      return 'کاربر دیگر وجود ندارد. فهرست کاربران به‌روزرسانی می‌شود.';
    case 'NOT_ADMIN':
      return 'حذف کاربر فقط برای مدیر فعال سامانه مجاز است.';
    case 'AUTH_ACCESS_RESTRICTED':
      return 'نشست فعلی اجازه انجام این عملیات را ندارد.';
    case 'AUDIT_WRITE_FAILED':
      return 'ثبت رویداد امنیتی ناموفق بود؛ حذف کاربر انجام نشد.';
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'تنظیمات امنیتی حذف کاربر در دسترس نیست.';
    default:
      return 'حذف کاربر انجام نشد.';
  }
}

function retireErrorMessage(result: RetireResponse): string {
  switch (result.error) {
    case 'SELF_RETIRE_FORBIDDEN':
      return 'نمی‌توانید حساب خودتان را حذف دائمی کنید.';
    case 'LAST_ADMIN_FORBIDDEN':
      return 'آخرین مدیر فعال سامانه قابل حذف دائمی نیست.';
    case 'LAST_SECURITY_ADMIN_FORBIDDEN':
      return 'آخرین مدیر امنیتی فعال سامانه قابل حذف دائمی نیست.';
    case 'PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN':
      return 'حذف دائمی حساب مدیر یا مدیر امنیتی فقط توسط مدیر امنیتی مجاز است.';
    case 'NOT_ADMIN':
      return 'این عملیات فقط برای مدیر فعال سامانه مجاز است.';
    case 'AUTH_ACCESS_RESTRICTED':
      return 'نشست فعلی اجازه انجام این عملیات را ندارد.';
    case 'AUTH_RETIRE_PENDING':
      return 'دسترسی حساب قطع شد، اما آزادسازی شناسه‌های ورود هنوز کامل نشده است. دوباره روی حذف کاربر بزنید تا عملیات تکمیل شود.';
    case 'RETIRE_FINALIZE_PENDING':
      return 'حساب در Auth حذف شده است، اما پاک‌سازی پروفایل هنوز کامل نشده است. دوباره روی حذف کاربر بزنید تا عملیات تکمیل شود.';
    case 'CHANGE_REASON_REQUIRED':
      return 'دلیل حذف دائمی حساب معتبر نیست.';
    case 'RUNTIME_CONFIG_UNAVAILABLE':
      return 'تنظیمات امنیتی حذف دائمی حساب در دسترس نیست.';
    default:
      return 'حذف دائمی حساب با حفظ سوابق انجام نشد.';
  }
}

export function AdminUserDeleteAction({
  userId,
  fullName,
  email,
  onDeleted,
}: AdminUserDeleteActionProps) {
  const [deleting, setDeleting] = useState(false);
  const operationRef = useRef(false);
  const label = (fullName || '').trim() || email || 'این کاربر';
  const toastId = `admin-user-delete-${userId}`;

  const retireInsteadOfHardDelete = async (accessToken: string, dependency: DeleteResponse) => {
    const reason = dependency.has_storage_objects
      ? 'حذف دائمی حساب با حفظ سوابق به دلیل وجود فایل یا سوابق محافظت‌شده'
      : 'حذف دائمی حساب با حفظ سوابق به دلیل وجود سوابق سازمانی محافظت‌شده';

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-retire-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ user_id: userId, reason }),
    });
    const result = await response.json().catch(() => ({})) as RetireResponse;

    if (!response.ok || result.ok !== true) {
      toast.error(retireErrorMessage(result), { id: toastId });
      await onDeleted();
      return false;
    }

    toast.success(
      `حساب «${label}» به‌طور دائمی حذف شد؛ شناسه‌های ورود آزاد و سوابق سازمانی به‌صورت ناشناس حفظ شدند.`,
      { id: toastId },
    );
    await onDeleted();
    return true;
  };

  const executeDelete = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    setDeleting(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) {
        toast.error('نشست ورود معتبر نیست.', { id: toastId });
        return;
      }

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: userId }),
      });
      const result = await response.json().catch(() => ({})) as DeleteResponse;

      if (!response.ok || result.ok !== true) {
        if (result.error === 'USER_HAS_DEPENDENCIES') {
          const confirmed = window.confirm(
            `${deleteErrorMessage(result)}\n\n` +
            `می‌توان حساب «${label}» را به‌صورت دائمی بازنشسته کرد:\n` +
            `• دسترسی، رمز، Session و MFA برای همیشه از کار می‌افتد.\n` +
            `• نام کاربری، ایمیل و موبایل آزاد می‌شوند و دوباره قابل ثبت هستند.\n` +
            `• اطلاعات شخصی پروفایل ناشناس می‌شود.\n` +
            `• سوابق جلسات، صورت‌جلسات، چت و Audit حذف نمی‌شوند.\n\n` +
            `این عملیات برگشت‌پذیر نیست. ادامه می‌دهید؟`
          );
          if (confirmed) {
            await retireInsteadOfHardDelete(accessToken, result);
          }
          return;
        }

        toast.error(deleteErrorMessage(result), { id: toastId });
        if (result.error === 'USER_NOT_FOUND') await onDeleted();
        return;
      }

      toast.success(`کاربر «${label}» به‌صورت فیزیکی حذف شد.`, { id: toastId });
      await onDeleted();
    } catch {
      toast.error('ارتباط با سرویس حذف کاربر برقرار نشد.', { id: toastId });
    } finally {
      operationRef.current = false;
      setDeleting(false);
    }
  };

  const handleDeleteClick = async () => {
    if (operationRef.current) return;
    const confirmed = window.confirm(
      `آیا از حذف «${label}» مطمئن هستید؟\n\n` +
      `اگر حساب هیچ سابقه سازمانی نداشته باشد، حذف فیزیکی انجام می‌شود. ` +
      `اگر سابقه‌ای وجود داشته باشد، حذف فیزیکی متوقف می‌شود و گزینه حذف دائمی با حفظ سوابق ارائه خواهد شد.`
    );
    if (!confirmed) return;
    await executeDelete();
  };

  return (
    <button
      type="button"
      onClick={handleDeleteClick}
      disabled={deleting}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="حذف کاربر"
      aria-label={`حذف ${label}`}
    >
      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
