import { useState, useEffect } from 'react';
import { ArrowRight, User, Shield, Loader as Loader2, RefreshCw, TriangleAlert as AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AdminProfile } from './types';

function PhoneSyncPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [status, setStatus] = useState<string>('');
  const [profileMasked, setProfileMasked] = useState('');
  const [authMasked, setAuthMasked] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const checkStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('نشست فعال نیست'); setLoading(false); return; }
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-profile-phone-to-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_id: user.user_id, action: 'check' }),
      });
      const data = await resp.json();
      if (!resp.ok) { setError(data.error || 'خطا در بررسی وضعیت'); setLoading(false); return; }
      if (data.already_synced) setStatus('SYNCED');
      else if (data.conflict) setStatus('PHONE_USED_BY_OTHER_AUTH_USER');
      else if (!data.auth_phone_masked) setStatus('AUTH_PHONE_MISSING');
      else setStatus('MISMATCH');
      setProfileMasked(data.profile_phone_masked || '');
      setAuthMasked(data.auth_phone_masked || '');
    } catch { setError('خطای شبکه'); }
    setLoading(false);
  };

  const doSync = async () => {
    setSyncing(true);
    setResult('');
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('نشست فعال نیست'); setSyncing(false); return; }
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-profile-phone-to-auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ user_id: user.user_id, action: 'sync' }),
      });
      const data = await resp.json();
      if (resp.ok && data.ok) { setResult('همگام‌سازی موفق بود'); await checkStatus(); }
      else setError(data.auth_error_message || data.error || 'همگام‌سازی ناموفق بود');
    } catch { setError('خطای شبکه'); }
    setSyncing(false);
  };

  useEffect(() => { checkStatus(); /* eslint-disable-next-line */ }, []);

  const statusLabel: Record<string, string> = {
    SYNCED: 'همگام‌شده',
    AUTH_PHONE_MISSING: 'شماره در احراز هویت ثبت نشده',
    MISMATCH: 'عدم تطابق',
    PHONE_USED_BY_OTHER_AUTH_USER: 'شماره روی کاربر دیگری',
  };

  const statusColor: Record<string, string> = {
    SYNCED: 'text-green-600 bg-green-50',
    AUTH_PHONE_MISSING: 'text-amber-600 bg-amber-50',
    MISMATCH: 'text-red-600 bg-red-50',
    PHONE_USED_BY_OTHER_AUTH_USER: 'text-red-600 bg-red-50',
  };

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowRight className="w-5 h-5" />
        </button>
        <h2 className="text-lg font-bold text-slate-800">همگام‌سازی شماره موبایل</h2>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
            <User className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <p className="font-medium text-slate-800">{user.full_name || 'بدون نام'}</p>
            <p className="text-sm text-slate-500">{user.email}</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> در حال بررسی...</div>
        ) : error ? (
          <div className="text-red-600 text-sm">{error}</div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-slate-500">شماره در پروفایل</p>
                <p className="text-sm font-mono" dir="ltr">{profileMasked || '—'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-slate-500">شماره در احراز هویت</p>
                <p className="text-sm font-mono" dir="ltr">{authMasked || '—'}</p>
              </div>
            </div>

            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${statusColor[status] || 'text-slate-600 bg-slate-50'}`}>
              <Shield className="w-4 h-4" />
              {statusLabel[status] || status}
            </div>

            {status !== 'SYNCED' && (
              <div className="pt-4 border-t border-slate-100">
                <button
                  onClick={doSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  همگام‌سازی
                </button>
                {result && <p className="mt-3 text-sm text-green-600">{result}</p>}
                {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
              </div>
            )}

            {status === 'PHONE_USED_BY_OTHER_AUTH_USER' && (
              <div className="mt-4 p-3 bg-amber-50 rounded-lg text-sm text-amber-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>این شماره روی یک حساب احراز هویت دیگر ثبت شده است. ابتدا باید حساب یتیم موبایلی از پنل تعمیر حذف شود.</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export { PhoneSyncPanel };
