import { Loader, Users, Eye, ShieldCheck } from 'lucide-react';
import type { UserProfile } from './types';

interface Props {
  userSearch: string;
  users: UserProfile[];
  searching: boolean;
  onSearch: (q: string) => void;
  onStartCall: (user: UserProfile) => void;
}

export function IdleView({ userSearch, users, searching, onSearch, onStartCall }: Props) {
  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* E2EE info banner */}
      <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">رمزنگاری سرتاسری (E2EE)</p>
          <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
            محتوای صوت و تصویر با <strong>AES-GCM-256</strong> رمز می‌شود. کلید رمزگشایی در اختیار سرور نیست — رمزگشایی فقط در مرورگر مخاطب انجام می‌شود.
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
            Metadata تماس (IP، مدت، codec، زمان‌بندی بسته‌ها) توسط E2EE محافظت نمی‌شود.
            برای اطمینان از عدم MITM در تبادل کلید، Safety Number را پس از اتصال تأیید کنید.
          </p>
        </div>
      </div>

      {/* User search card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Users className="w-4 h-4" /> تماس با کاربر
        </h3>
        <div className="relative">
          <input
            type="text"
            value={userSearch}
            onChange={e => onSearch(e.target.value)}
            placeholder="جستجوی نام یا ایمیل..."
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          {searching && (
            <Loader className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
          )}
        </div>
        {users.length > 0 && (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
            {users.map(u => (
              <li key={u.user_id}>
                <button
                  onClick={() => onStartCall(u)}
                  className="w-full text-right px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-3"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400 text-sm font-bold shrink-0">
                    {(u.full_name || u.email || '?')[0].toUpperCase()}
                  </div>
                  <div className="min-w-0 text-right">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email || ''}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Safety Number explainer */}
      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-1.5">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1">
          <Eye className="w-3.5 h-3.5" /> Safety Number چیست؟
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
          پس از اتصال، یک کد ۳۲ کاراکتری نشان داده می‌شود. اگر همین کد در مرورگر مخاطب نیز نمایش داده شود، تبادل کلید بدون دخالت واسطه انجام شده است.
          این مقایسه باید از طریق کانالی مستقل از این برنامه انجام شود.
        </p>
      </div>
    </div>
  );
}
