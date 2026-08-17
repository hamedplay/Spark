import { useState, useEffect, useRef } from 'react';
import { Loader as Loader2, MessageCircle, CircleCheck as CheckCircle2, Link2, Unlink, RefreshCw, Info } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export function BaleConnectSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
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

  const toggleAuthCodes = async () => {
    setAuthCodesSaving(true);
    try {
      const newVal = !authCodesEnabled;
      const { data, error } = await supabase.rpc('set_my_bale_auth_codes_enabled', { p_enabled: newVal });
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
  };

  if (connected === null) {
    return (
      <div className="flex min-h-20 items-center justify-center rounded-2xl border border-teal-100 bg-teal-50/60 dark:border-teal-900/60 dark:bg-teal-900/10">
        <Loader2 className="h-5 w-5 animate-spin text-teal-500" />
      </div>
    );
  }

  return (
    <section className="space-y-2.5 rounded-2xl border border-teal-200 bg-teal-50/70 p-3 dark:border-teal-800 dark:bg-teal-900/10 sm:p-4" aria-label="اتصال پیام‌رسان بله">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400">
            <MessageCircle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-teal-800 dark:text-teal-200">پیام‌رسان بله</p>
            <p className="hidden truncate text-xs text-teal-600 dark:text-teal-400 min-[420px]:block">اعلان جلسه و کدهای ورود</p>
          </div>
        </div>
        <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${connected ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'}`}>
          {connected && <CheckCircle2 className="h-3.5 w-3.5" />}
          {connected ? 'متصل' : 'متصل نیست'}
        </span>
      </div>

      {connected ? (
        <>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 dark:bg-gray-800/40">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-200">کد ورود و بازیابی در بله</p>
              <p className="mt-0.5 hidden text-[11px] text-gray-500 dark:text-gray-400 min-[420px]:block">همراه پیامک، کد یکبارمصرف در بله هم ارسال شود</p>
            </div>
            <button
              type="button"
              onClick={toggleAuthCodes}
              disabled={authCodesSaving}
              aria-pressed={authCodesEnabled}
              aria-label="دریافت کدهای ورود در بله"
              title={authCodesEnabled ? 'غیرفعال‌کردن دریافت کد در بله' : 'فعال‌کردن دریافت کد در بله'}
              className={`relative h-7 w-12 flex-shrink-0 rounded-full transition-colors ${authCodesEnabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'} ${authCodesSaving ? 'opacity-50' : ''}`}
            >
              <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${authCodesEnabled ? 'right-6' : 'right-1'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between gap-2">
            <details className="min-w-0 text-[11px] text-gray-500 dark:text-gray-400">
              <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-teal-700 dark:text-teal-300">
                <Info className="h-3.5 w-3.5" /> راهنما
              </summary>
              <p className="mt-1 leading-5">اعلان‌های جلسه به‌صورت خودکار در بله ارسال می‌شوند. در صورت فعال‌بودن گزینه بالا، کدهای ورود و بازیابی هم در بله دریافت می‌شوند.</p>
            </details>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs text-red-600 transition hover:bg-red-100 disabled:opacity-60 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40"
            >
              {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
              قطع اتصال
            </button>
          </div>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-teal-500 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-teal-600 disabled:opacity-60 sm:w-auto"
          >
            {connecting
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> در انتظار اتصال...</>
              : <><Link2 className="h-4 w-4" /> اتصال به بله</>}
          </button>
          <details className="text-[11px] text-gray-500 dark:text-gray-400">
            <summary className="flex cursor-pointer list-none items-center gap-1 py-1 text-teal-700 dark:text-teal-300">
              <Info className="h-3.5 w-3.5" /> راهنمای اتصال
            </summary>
            <p className="mt-1 leading-5">دکمه اتصال را بزنید؛ بات بله باز می‌شود. در بات فقط «شروع» را بزنید و اتصال خودکار تأیید می‌شود.</p>
          </details>
          {connecting && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 dark:border-blue-800 dark:bg-blue-900/20">
              <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-blue-500" />
              <p className="text-xs text-blue-600 dark:text-blue-400">منتظر تأیید از بله...</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
