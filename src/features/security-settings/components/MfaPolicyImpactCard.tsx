import { ShieldAlert, Users, KeyRound, ShieldCheck } from 'lucide-react';
import type { SecurityImpact } from '../types/securitySettings';

interface Props {
  impact: SecurityImpact;
  visible: boolean;
}

export function MfaPolicyImpactCard({ impact, visible }: Props) {
  if (!visible) return null;

  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        <h4 className="text-sm font-bold text-amber-800 dark:text-amber-200">
          پیش‌نمایش اثر فعال‌سازی MFA الزامی
        </h4>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl">
          <Users className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">کاربران فعال</p>
            <p className="text-lg font-bold text-gray-800 dark:text-white">{impact.active_users}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl">
          <ShieldCheck className="w-4 h-4 text-green-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">دارای TOTP تأییدشده</p>
            <p className="text-lg font-bold text-green-600 dark:text-green-400">{impact.users_with_verified_totp}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl">
          <KeyRound className="w-4 h-4 text-orange-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">فاقد TOTP تأییدشده</p>
            <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{impact.users_without_verified_totp}</p>
          </div>
        </div>

        <div className="flex items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-xl">
          <ShieldAlert className="w-4 h-4 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">مدیران امنیت فاقد TOTP</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{impact.security_admins_without_verified_totp}</p>
          </div>
        </div>
      </div>

      {impact.security_admins_without_verified_totp > 0 && (
        <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded-xl text-xs text-red-700 dark:text-red-300">
          برخی مدیران امنیت TOTP فعال ندارند. فعال‌سازی سیاست «الزامی» باعث قفل شدن حساب آن‌ها می‌شود.
        </div>
      )}
    </div>
  );
}
