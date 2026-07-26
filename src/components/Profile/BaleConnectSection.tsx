import { useState, useEffect, useRef } from 'react';
import { Loader as Loader2, MessageCircle, CircleCheck as CheckCircle2, Link2, Unlink, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export function BaleConnectSection() {
  const [connected, setConnected] = useState<boolean | null>(null); // null = loading
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [authCodesEnabled, setAuthCodesEnabled] = useState(true);
  const [authCodesSaving, setAuthCodesSaving] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const checkConnection = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('user_bale_mapping')
      .select('bale_chat_id, auth_codes_enabled')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) setAuthCodesEnabled(data.auth_codes_enabled !== false);
    return !!data;
  };

  useEffect(() => {
    checkConnection().then(setConnected);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollCountRef.current = 0;
  };

  const startPolling = () => {
    stopPolling();
    pollCountRef.current = 0;
    pollRef.current = setInterval(async () => {
      pollCountRef.current += 1;
      // Stop after 2 minutes (40 × 3s)
      if (pollCountRef.current > 40) {
        stopPolling();
        return;
      }
      const isConnected = await checkConnection();
      if (isConnected) {
        stopPolling();
        setConnected(true);
        setConnecting(false);
        toast.success('اتصال به بله با موفقیت انجام شد!');
      }
    }, 3000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('احراز هویت لازم است');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/bale-link-generate`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
        }
      );
      const data = await res.json();
      if (!data.ok || !data.url) throw new Error(data.error || 'خطا در تولید لینک');
      window.open(data.url, '_blank', 'noopener,noreferrer');
      startPolling();
    } catch (err: any) {
      toast.error(err.message || 'خطا در اتصال به بله');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('احراز هویت لازم است');
      const { error } = await supabase
        .from('user_bale_mapping')
        .delete()
        .eq('user_id', user.id);
      if (error) throw error;
      setConnected(false);
      toast.success('اتصال بله قطع شد');
    } catch (err: any) {
      toast.error(err.message || 'خطا در قطع اتصال');
    } finally {
      setDisconnecting(false);
    }
  };

  if (connected === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-teal-500" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-900/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        <div>
          <p className="font-semibold text-teal-800 dark:text-teal-200 text-sm">پیام‌رسان بله</p>
          <p className="text-xs text-teal-600 dark:text-teal-400">برای دریافت اعلان‌های جلسه در بله</p>
        </div>
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-teal-100 dark:bg-teal-900/30 rounded-xl">
            <div className="w-2.5 h-2.5 rounded-full bg-teal-500 flex-shrink-0" />
            <span className="text-sm text-teal-700 dark:text-teal-300 font-medium flex-1">
              به بله متصل هستید
            </span>
            <CheckCircle2 className="w-4 h-4 text-teal-500 flex-shrink-0" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            اعلان‌های جلسه به طور خودکار در بله برای شما ارسال می‌شوند.
          </p>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-sm transition disabled:opacity-60"
          >
            {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            قطع اتصال
          </button>
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-teal-200 dark:border-teal-800">
            <div>
              <p className="text-sm font-medium text-teal-800 dark:text-teal-200">دریافت کدهای ورود و بازیابی رمز در بله</p>
              <p className="text-xs text-teal-600 dark:text-teal-400 mt-0.5">کد یکبار مصرف علاوه بر پیامک، در بله نیز ارسال می‌شود.</p>
            </div>
            <button
              onClick={async () => {
                setAuthCodesSaving(true);
                try {
                  const newVal = !authCodesEnabled;
                  const { data, error } = await supabase
                    .rpc('set_my_bale_auth_codes_enabled', { p_enabled: newVal });
                  if (error) throw error;
                  if (!data || data.ok !== true) {
                    const errMsg = data?.error || 'UNKNOWN';
                    if (errMsg === 'MAPPING_NOT_FOUND') toast.error('اتصال بله یافت نشد');
                    else if (errMsg === 'UNAUTHORIZED') toast.error('احراز هویت لازم است');
                    else toast.error('خطا در تغییر تنظیمات');
                    return;
                  }
                  setAuthCodesEnabled(newVal);
                  toast.success(newVal ? 'دریافت کدهای بله فعال شد' : 'دریافت کدهای بله غیرفعال شد');
                } catch {
                  toast.error('خطا در تغییر تنظیمات');
                } finally {
                  setAuthCodesSaving(false);
                }
              }}
              disabled={authCodesSaving}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${authCodesEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${authCodesSaving ? 'opacity-50' : ''}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${authCodesEnabled ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm"
          >
            {connecting
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> در انتظار اتصال...</>
              : <><Link2 className="w-4 h-4" /> اتصال به بله</>
            }
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed text-center">
            روی دکمه بزنید، بات بله باز می‌شود، فقط دکمه «شروع» را بزنید.
          </p>
          {connecting && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                پس از زدن «شروع» در بله، اتصال به صورت خودکار تأیید می‌شود...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
