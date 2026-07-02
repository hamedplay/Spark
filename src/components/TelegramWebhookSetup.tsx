import { useState, useEffect, useCallback } from 'react';
import { Bot, Check, RefreshCw, Loader as Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';

interface WebhookSetupProps {
  webhookUrl: string;
}

async function callTelegramProxy(method: string, params?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('احراز هویت لازم است');
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/messenger-proxy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ channel: 'telegram', method, params: params ?? {} }),
    },
  );
  return res.json();
}

export function TelegramWebhookSetup({ webhookUrl }: WebhookSetupProps) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<'pending' | 'success' | 'error'>('pending');
  const [webhookInfo, setWebhookInfo] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const checkWebhookStatus = useCallback(async () => {
    if (!webhookUrl) return;
    try {
      setLoading(true);
      setErrorMessage('');
      const data = await callTelegramProxy('getWebhookInfo');
      if (data.ok && data.result) {
        setWebhookInfo(data.result);
        if (data.result.url === webhookUrl && !data.result.last_error_date) {
          setStatus('success');
        } else {
          setStatus('pending');
          if (data.result?.last_error_message) {
            setErrorMessage(data.result.last_error_message);
          }
        }
      } else {
        setStatus('error');
        setErrorMessage(data.description || 'خطا در بررسی وضعیت وب‌هوک');
      }
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'خطا در بررسی وضعیت وب‌هوک');
    } finally {
      setLoading(false);
    }
  }, [webhookUrl]);

  useEffect(() => {
    checkWebhookStatus();
  }, [checkWebhookStatus]);

  const setupWebhook = async () => {
    if (!webhookUrl) {
      toast.error('لطفاً Webhook URL را وارد و ذخیره کنید');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const botData = await callTelegramProxy('getMe');
      if (!botData.ok) {
        throw new Error(botData.description || 'توکن تلگرام نامعتبر است');
      }

      await callTelegramProxy('deleteWebhook', { drop_pending_updates: true });

      const webhookData = await callTelegramProxy('setWebhook', {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      });
      if (!webhookData.ok && webhookData.result !== true) {
        throw new Error(webhookData.description || 'خطا در تنظیم webhook');
      }

      await checkWebhookStatus();
      toast.success('Webhook با موفقیت تنظیم شد');
    } catch (error: any) {
      setStatus('error');
      setErrorMessage(error.message || 'خطا در تنظیم webhook');
      toast.error(error.message || 'خطا در تنظیم webhook');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold dark:text-white">تنظیم Webhook تلگرام</h3>
        <button
          onClick={checkWebhookStatus}
          disabled={loading}
          className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
          title="بررسی مجدد وضعیت"
        >
          <RefreshCw className={`w-5 h-5 text-gray-500 dark:text-gray-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className={`w-3 h-3 rounded-full ${
            status === 'success' ? 'bg-green-500' :
            status === 'error' ? 'bg-red-500' :
            'bg-yellow-500'
          }`} />
          <span className="text-sm font-medium dark:text-gray-300">
            {status === 'success' ? 'Webhook فعال است' :
             status === 'error' ? 'خطا در Webhook' :
             'Webhook تنظیم نشده است'}
          </span>
        </div>

        {errorMessage && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-lg">
            <p className="font-medium">خطای دریافت شده:</p>
            <p>{errorMessage}</p>
          </div>
        )}

        {webhookInfo && (
          <div className="text-sm space-y-2 bg-gray-50 dark:bg-gray-700 p-4 rounded-lg">
            <p className="dark:text-gray-300">
              <span className="font-medium">آدرس فعلی: </span>
              {webhookInfo.url || 'تنظیم نشده'}
            </p>
            {webhookInfo.last_error_message && (
              <p className="text-red-600 dark:text-red-400">
                <span className="font-medium">آخرین خطا: </span>
                {webhookInfo.last_error_message}
              </p>
            )}
            <p className="dark:text-gray-300">
              <span className="font-medium">آخرین به‌روزرسانی: </span>
              {webhookInfo.last_error_date ?
                new Date(webhookInfo.last_error_date * 1000).toLocaleString('fa-IR') :
                'بدون خطا'}
            </p>
          </div>
        )}

        <button
          onClick={setupWebhook}
          disabled={loading}
          className={`w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg transition-colors ${
            status === 'success'
              ? 'bg-green-500 text-white'
              : 'bg-blue-500 hover:bg-blue-600 text-white'
          } disabled:opacity-50`}
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : status === 'success' ? (
            <>
              <Check className="w-5 h-5" />
              تنظیم مجدد Webhook
            </>
          ) : (
            <>
              <Bot className="w-5 h-5" />
              تنظیم Webhook
            </>
          )}
        </button>

        {status === 'success' && (
          <p className="text-sm text-green-600 dark:text-green-400">
            اکنون پیام‌های ارسال شده در گروه تلگرام به صورت خودکار در بخش یادداشت‌ها ذخیره خواهند شد.
          </p>
        )}
      </div>
    </div>
  );
}
