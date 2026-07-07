import { useState, useRef } from 'react';
import { Loader, Users, ShieldCheck, Phone, X, ChevronDown, ChevronUp } from 'lucide-react';
import type { UserProfile } from './types';

interface Props {
  userSearch: string;
  users: UserProfile[];
  searching: boolean;
  onSearch: (q: string) => void;
  onStartCall: (user: UserProfile) => void;
}

function getInitial(nameOrEmail: string | null | undefined): string {
  const s = (nameOrEmail || '').trim();
  return s ? s[0].toUpperCase() : '?';
}

export function IdleView({ userSearch, users, searching, onSearch, onStartCall }: Props) {
  const [showE2EEDetail, setShowE2EEDetail] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasSearch    = userSearch.trim().length > 0;
  const noResults    = hasSearch && !searching && users.length === 0;

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* E2EE compact banner */}
      <div className="flex items-start gap-3 p-3.5 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
        <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-emerald-800 dark:text-emerald-300 leading-snug">
            صدا و تصویر تماس به‌صورت سرتاسری رمزگذاری می‌شود.
          </p>
          <button
            type="button"
            onClick={() => setShowE2EEDetail(v => !v)}
            className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 hover:underline focus-visible:outline-none"
          >
            {showE2EEDetail ? <ChevronUp aria-hidden="true" className="w-3 h-3" /> : <ChevronDown aria-hidden="true" className="w-3 h-3" />}
            {showE2EEDetail ? 'نمایش کمتر' : 'جزئیات بیشتر'}
          </button>
          {showE2EEDetail && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                محتوای صوت و تصویر با <strong>AES-GCM-256</strong> رمز می‌شود. کلید رمزگشایی در اختیار سرور نیست.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                Metadata تماس (IP، مدت، codec) توسط E2EE محافظت نمی‌شود.
                پس از اتصال Safety Number را برای تأیید عدم MITM بررسی کنید.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* User search card */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Users className="w-4 h-4" aria-hidden="true" /> تماس با کاربر
        </h3>

        {/* Search input */}
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={userSearch}
            onChange={e => onSearch(e.target.value)}
            placeholder="جستجوی نام یا ایمیل..."
            aria-label="جستجو در لیست کاربران"
            className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-shadow"
          />
          {/* Right-side icon: spinner or clear */}
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            {searching ? (
              <Loader aria-hidden="true" className="w-4 h-4 animate-spin text-gray-400" />
            ) : hasSearch ? (
              <button
                type="button"
                onClick={() => { onSearch(''); inputRef.current?.focus(); }}
                aria-label="پاک کردن جستجو"
                className="w-4 h-4 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors focus-visible:outline-none"
              >
                <X aria-hidden="true" className="w-4 h-4" />
              </button>
            ) : null}
          </div>
        </div>

        {/* Results list */}
        {users.length > 0 && (
          <ul
            role="listbox"
            aria-label="نتایج جستجو"
            className="divide-y divide-gray-100 dark:divide-gray-700 max-h-52 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700"
          >
            {users.map(u => (
              <li key={u.user_id} role="option" aria-selected="false">
                <button
                  type="button"
                  onClick={() => onStartCall(u)}
                  aria-label={`شروع تماس با ${u.full_name || u.email || 'کاربر'}`}
                  className="w-full text-right px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                >
                  <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400 text-sm font-bold shrink-0">
                    {getInitial(u.full_name || u.email)}
                  </div>
                  <div className="min-w-0 text-right flex-1">
                    <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email || ''}</p>
                  </div>
                  <Phone aria-hidden="true" className="w-4 h-4 text-emerald-500 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* No-results state */}
        {noResults && (
          <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            کاربری با این نام پیدا نشد
          </div>
        )}

        {/* Empty-query hint */}
        {!hasSearch && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            نام یا ایمیل کاربری را که می‌خواهید با او تماس بگیرید وارد کنید.
          </p>
        )}
      </div>
    </div>
  );
}
