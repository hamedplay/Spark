import { useState, useEffect } from 'react';
import { RefreshCw, Search, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import toast from 'react-hot-toast';
import type { Profile } from './types';

export function PhoneSyncCard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<Profile | null>(null);
  const [checkResult, setCheckResult] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('user_id', userData.user.id)
          .maybeSingle();
        setIsAdmin(profile?.is_admin === true);
      }
      setLoading(false);
    })();
  }, []);

  const handleSearch = async () => {
    if (!searchTerm.trim()) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .or(`full_name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%,phone.ilike.%${searchTerm}%`)
      .eq('is_active', true)
      .limit(10);
    setSearchResults((data || []) as Profile[]);
  };

  const handleCheck = async () => {
    if (!selectedUser) return;
    setChecking(true);
    setCheckResult(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) { toast.error('نشست معتبر نیست'); return; }
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-profile-phone-to-auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: selectedUser.user_id, action: 'check' }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'خطا در بررسی');
        return;
      }
      setCheckResult(json);
    } catch {
      toast.error('خطا در ارتباط با سرور');
    } finally {
      setChecking(false);
    }
  };

  const handleSync = async () => {
    if (!selectedUser) return;
    setSyncing(true);
    setShowConfirm(false);
    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) { toast.error('نشست معتبر نیست'); return; }
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-profile-phone-to-auth`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: selectedUser.user_id, action: 'sync' }),
        }
      );
      const json = await res.json();
      if (!res.ok) {
        const errMap: Record<string, string> = {
          NOT_ADMIN: 'فقط ادمین می‌تواند',
          PROFILE_NOT_FOUND: 'پروفایل یافت نشد',
          PROFILE_INACTIVE: 'پروفایل غیرفعال است',
          PROFILE_PHONE_INVALID: 'شماره پروفایل نامعتبر است',
          AUTH_USER_NOT_FOUND: 'کاربر Auth یافت نشد',
          CONFLICT_PHONE_ON_ANOTHER_USER: 'شماره روی کاربر دیگری در Auth ثبت شده',
          AUTH_PHONE_CONFLICT: 'کاربر Auth شماره متفاوتی دارد',
          PHONE_DUPLICATE: 'شماره تکراری است',
          AUTH_UPDATE_FAILED: 'خطا در به‌روزرسانی Auth',
        };
        toast.error(errMap[json.error] || json.error || 'خطا در همگام‌سازی');
        return;
      }
      setCheckResult(json);
      toast.success(json.message === 'ALREADY_SYNCED' ? 'شماره قبلاً همگام شده' : 'شماره با موفقیت همگام شد');
      logAudit({ module: 'security', action: 'sync_profile_phone_to_auth', entity_name: selectedUser.user_id, severity: 'warning' });
    } catch {
      toast.error('خطا در ارتباط با سرور');
    } finally {
      setSyncing(false);
    }
  };

  if (loading || !isAdmin) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400">
          <RefreshCw className="w-4 h-4" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">همگام‌سازی شماره Profile با Supabase Auth</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">شماره پروفایل را به‌صورت امن در Auth ثبت می‌کند</p>
        </div>
      </div>

      <div className="space-y-3">
        {/* Search */}
        <div className="flex gap-2">
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="نام، ایمیل یا شماره..."
            className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
          />
          <button
            onClick={handleSearch}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors whitespace-nowrap flex items-center gap-1"
          >
            <Search className="w-4 h-4" /> جستجو
          </button>
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {searchResults.map(p => (
              <button
                key={p.user_id}
                onClick={() => { setSelectedUser(p); setCheckResult(null); }}
                className={`w-full text-right px-3 py-2 rounded-xl text-sm transition-colors ${
                  selectedUser?.user_id === p.user_id
                    ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                    : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
                }`}
              >
                {p.full_name || 'بدون نام'} — {p.email || ''}
              </button>
            ))}
          </div>
        )}

        {/* Selected user + check/sync */}
        {selectedUser && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {selectedUser.full_name || 'بدون نام'}
              </p>
              <span className="text-xs text-gray-400">{selectedUser.email || ''}</span>
            </div>

            <div className="flex gap-2">
              <button
                onClick={handleCheck}
                disabled={checking}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors disabled:opacity-50"
              >
                <Search className="w-4 h-4" /> بررسی
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                disabled={syncing}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} /> همگام‌سازی امن
              </button>
            </div>
          </div>
        )}

        {/* Check result */}
        {checkResult && (
          <div className="pt-3 border-t border-gray-100 dark:border-gray-700 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${checkResult.profile_exists ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-600 dark:text-gray-300">پروفایل: {checkResult.profile_exists ? 'موجود' : 'یافت نشد'}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${checkResult.profile_active ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-600 dark:text-gray-300">وضعیت: {checkResult.profile_active ? 'فعال' : 'غیرفعال'}</span>
            </div>
            {checkResult.profile_phone_masked !== undefined && (
              <p className="text-xs text-gray-500 dark:text-gray-400">شماره پروفایل: {checkResult.profile_phone_masked || '—'}</p>
            )}
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${checkResult.auth_user_exists ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-gray-600 dark:text-gray-300">Auth User: {checkResult.auth_user_exists ? 'موجود' : 'یافت نشد'}</span>
            </div>
            {checkResult.auth_phone_masked !== undefined && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                شماره Auth: {checkResult.auth_phone_masked || 'ثبت نشده'}
              </p>
            )}
            {checkResult.already_synced && (
              <p className="text-xs text-green-600 dark:text-green-400 font-medium">همگام‌سازی قبلاً انجام شده</p>
            )}
            {checkResult.conflict && (
              <p className="text-xs text-red-600 dark:text-red-400 font-medium">تداخل: شماره روی کاربر دیگری در Auth</p>
            )}
            {checkResult.message && checkResult.message !== 'ALREADY_SYNCED' && (
              <p className="text-xs text-green-600 dark:text-green-400 font-medium">{checkResult.message === 'SYNCED' ? 'همگام‌سازی موفق' : checkResult.message}</p>
            )}
          </div>
        )}

        {/* Confirmation modal */}
        {showConfirm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-sm w-full space-y-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-gray-800 dark:text-white">تأیید همگام‌سازی</h3>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                شماره پروفایل کاربر «{selectedUser?.full_name || '—'}» در Supabase Auth ثبت می‌شود. این عملیات قابل بازگشت است. ادامه می‌دهید؟
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors"
                >
                  انصراف
                </button>
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex-1 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {syncing ? 'در حال...' : 'تأیید و همگام‌سازی'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
