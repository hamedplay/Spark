import { useMemo, useState } from 'react';
import { ArrowRight, Crown, Loader as Loader2, Shield, ShieldCheck, UserRound } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile } from './types';

type RoleLevel = 'user' | 'admin' | 'security_admin';

function currentRole(user: AdminProfile): RoleLevel {
  if (user.is_security_admin) return 'security_admin';
  if (user.is_admin) return 'admin';
  return 'user';
}

function errorMessage(code?: string): string {
  switch (code) {
    case 'SECURITY_ADMIN_REQUIRED':
      return 'تغییر سطح دسترسی فقط توسط مدیر امنیتی مجاز است.';
    case 'SELF_CHANGE_FORBIDDEN':
      return 'برای جلوگیری از قفل شدن مدیریت، نمی‌توانید سطح دسترسی حساب خودتان را از این بخش تغییر دهید.';
    case 'TARGET_NOT_ACTIVE':
      return 'برای اعطای نقش مدیریتی، حساب کاربر باید فعال باشد.';
    case 'TARGET_TOTP_REQUIRED':
      return 'برای اعطای Security Admin، کاربر مقصد باید TOTP فعال و تأییدشده داشته باشد.';
    case 'LAST_ADMIN_FORBIDDEN':
      return 'آخرین Admin فعال سامانه قابل تنزل به کاربر عادی نیست.';
    case 'LAST_SECURITY_ADMIN_FORBIDDEN':
      return 'آخرین Security Admin فعال سامانه قابل تنزل نیست.';
    case 'AUTH_ACCESS_RESTRICTED':
    case 'SESSION_INVALID':
    case 'SESSION_EXPIRED':
    case 'SESSION_REQUIRED':
      return 'نشست فعلی اجازه انجام این تغییر را ندارد. دوباره وارد سامانه شوید.';
    case 'CHANGE_REASON_REQUIRED':
      return 'دلیل تغییر سطح دسترسی الزامی است.';
    case 'CHANGE_REASON_TOO_SHORT':
      return 'دلیل تغییر باید حداقل ۱۰ کاراکتر باشد.';
    case 'CHANGE_REASON_TOO_LONG':
      return 'دلیل تغییر نباید بیشتر از ۵۰۰ کاراکتر باشد.';
    case 'NO_EFFECTIVE_CHANGE':
      return 'سطح دسترسی انتخاب‌شده با وضعیت فعلی کاربر یکسان است.';
    case 'TARGET_NOT_FOUND':
      return 'کاربر پیدا نشد.';
    default:
      return 'تغییر سطح دسترسی انجام نشد.';
  }
}

const roleOptions: Array<{
  value: RoleLevel;
  title: string;
  description: string;
  icon: typeof UserRound;
  classes: string;
}> = [
  {
    value: 'user',
    title: 'کاربر عادی',
    description: 'بدون دسترسی مدیریتی سامانه',
    icon: UserRound,
    classes: 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40',
  },
  {
    value: 'admin',
    title: 'Admin',
    description: 'مدیریت عمومی کاربران و تنظیمات مجاز',
    icon: Shield,
    classes: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20',
  },
  {
    value: 'security_admin',
    title: 'Security Admin',
    description: 'عملیات حساس امنیتی و مدیریت نقش‌های ممتاز؛ نیازمند TOTP تأییدشده برای کاربر مقصد',
    icon: Crown,
    classes: 'border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-900/20',
  },
];

export function RoleManagementPanel({
  user,
  currentUserId,
  onBack,
  onDone,
}: {
  user: AdminProfile;
  currentUserId: string;
  onBack: () => void;
  onDone: () => void | Promise<void>;
}) {
  const initialRole = useMemo(() => currentRole(user), [user]);
  const [role, setRole] = useState<RoleLevel>(initialRole);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const isSelf = user.user_id === currentUserId;

  const save = async () => {
    if (saving || role === initialRole) return;
    if (reason.trim().length < 10) {
      toast.error('دلیل تغییر باید حداقل ۱۰ کاراکتر باشد.');
      return;
    }

    const targetLabel = user.full_name || user.email || user.username || 'کاربر';
    const selected = roleOptions.find((item) => item.value === role)?.title || role;
    if (!window.confirm(`سطح دسترسی «${targetLabel}» به «${selected}» تغییر کند؟`)) return;

    setSaving(true);
    try {
      // Database types are generated from an older snapshot; keep the escape hatch scoped to this new RPC only.
      const { data, error } = await (supabase as any).rpc('set_user_role_level', {
        p_target_user_id: user.user_id,
        p_role: role,
        p_change_reason: reason.trim(),
      });

      if (error) {
        toast.error('ارتباط با سرویس مدیریت نقش برقرار نشد.');
        return;
      }

      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) {
        toast.error(errorMessage(result?.error));
        return;
      }

      toast.success(`سطح دسترسی «${targetLabel}» به «${selected}» تغییر کرد.`);
      await onDone();
    } catch {
      toast.error('تغییر سطح دسترسی انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white">مدیریت سطح دسترسی</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            {user.full_name || user.email || user.username || 'کاربر'}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <div className="flex items-start gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-900/30 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">سطح فعلی</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {roleOptions.find((item) => item.value === initialRole)?.title}
            </p>
          </div>
        </div>

        {isSelf && (
          <div className="mb-4 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-700 dark:text-amber-300">
            تغییر سطح دسترسی حساب خودتان از این بخش مجاز نیست.
          </div>
        )}

        <div className="space-y-3">
          {roleOptions.map((option) => {
            const Icon = option.icon;
            const active = role === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={isSelf || saving}
                onClick={() => setRole(option.value)}
                className={`w-full text-right rounded-2xl border p-4 transition-all ${option.classes} ${active ? 'ring-2 ring-purple-500 border-purple-400' : 'hover:border-gray-300 dark:hover:border-gray-600'} disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-gray-700 dark:text-gray-200 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900 dark:text-white">{option.title}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{option.description}</div>
                  </div>
                  <span className={`w-4 h-4 rounded-full border-2 ${active ? 'border-purple-600 bg-purple-600 shadow-[inset_0_0_0_3px_white]' : 'border-gray-300 dark:border-gray-600'}`} />
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            دلیل تغییر <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 500))}
            disabled={isSelf || saving}
            rows={3}
            placeholder="حداقل ۱۰ کاراکتر؛ مثال: واگذاری مسئولیت مدیریت سامانه"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60"
          />
          <div className="flex justify-between mt-1 text-xs text-gray-400">
            <span>این دلیل در Audit امنیتی ثبت می‌شود.</span>
            <span>{reason.length}/500</span>
          </div>
        </div>

        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={() => void save()}
            disabled={isSelf || saving || role === initialRole || reason.trim().length < 10}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            ذخیره سطح دسترسی
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={saving}
            className="px-4 py-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium disabled:opacity-50"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
