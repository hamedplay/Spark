import { useState, useEffect, useRef } from 'react';
import { Loader as Loader2, MessageCircle, AtSign, Unlink, RefreshCw, Link2, CircleCheck as CheckCircle2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

export function TelegramConnectSection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  const checkConnection = async (): Promise<boolean> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;
    const { data } = await supabase
      .from('profiles')
      .select('telegram_chat_id')
      .eq('user_id', user.id)
      .maybeSingle();
    return !!(data as any)?.telegram_chat_id;
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
      if (pollCountRef.current > 40) { stopPolling(); return; }
      const isConnected = await checkConnection();
      if (isConnected) {
        stopPolling();
        setConnected(true);
        setConnecting(false);
        toast.success('اتصال به تلگرام با موفقیت انجام شد!');
      }
    }, 3000);
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('احراز هویت لازم است');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/telegram-link-generate`,
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
      toast.error(err.message || 'خطا در اتصال به تلگرام');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('احراز هویت لازم است');
      const { error } = await supabase
        .from('profiles')
        .update({ telegram_chat_id: null })
        .eq('user_id', user.id);
      if (error) throw error;
      setConnected(false);
      toast.success('اتصال تلگرام قطع شد');
    } catch (err: any) {
      toast.error(err.message || 'خطا در قطع اتصال');
    } finally {
      setDisconnecting(false);
    }
  };

  if (connected === null) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/10 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        <div>
          <p className="font-semibold text-blue-800 dark:text-blue-200 text-sm">تلگرام</p>
          <p className="text-xs text-blue-600 dark:text-blue-400">برای دریافت اعلان‌های جلسه در تلگرام</p>
        </div>
      </div>

      {connected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-blue-100 dark:bg-blue-900/30 rounded-xl">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-sm text-blue-700 dark:text-blue-300 font-medium flex-1">
              به تلگرام متصل هستید
            </span>
            <CheckCircle2 className="w-4 h-4 text-blue-500 flex-shrink-0" />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            اعلان‌های جلسه به طور خودکار در تلگرام برای شما ارسال می‌شوند.
          </p>
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl text-sm transition disabled:opacity-60"
          >
            {disconnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlink className="w-4 h-4" />}
            قطع اتصال
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm"
          >
            {connecting
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> در انتظار اتصال...</>
              : <><Link2 className="w-4 h-4" /> اتصال به تلگرام</>
            }
          </button>
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed text-center">
            روی دکمه بزنید، بات تلگرام باز می‌شود، فقط دکمه «Start» را بزنید.
          </p>
          {connecting && (
            <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500 flex-shrink-0" />
              <p className="text-xs text-blue-600 dark:text-blue-400">
                پس از زدن «Start» در تلگرام، اتصال به صورت خودکار تأیید می‌شود...
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
