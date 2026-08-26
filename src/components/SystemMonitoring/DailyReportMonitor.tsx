import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  RefreshCw,
  FlaskConical,
  Send,
  Loader as Loader2,
  CircleCheck as CheckCircle,
  CircleAlert as AlertCircle,
  Clock,
  MessageSquare,
  CalendarDays,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

type SchedulerInfo = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
} | null;

type CronRun = {
  runid: number;
  jobid: number;
  status: string;
  return_message: string | null;
  start_time: string;
  end_time: string | null;
};

type ReportRun = {
  id: string;
  report_date: string;
  timezone: string;
  scheduled_time: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  recipient_count: number | null;
  meeting_count: number | null;
  error_text: string | null;
  trigger_type: string;
  run_key: string;
  start_delay_seconds?: number | null;
};

type SmsLog = {
  id: string;
  created_at: string;
  target_phone: string | null;
  status: string;
  error_text: string | null;
  provider_name: string | null;
  provider_message_id: string | null;
  delivery_status: string | null;
  delivery_code: string | null;
  delivery_checked_at: string | null;
  event_type: string | null;
  pack_id: string | null;
};

type Diagnostics = {
  database_clock?: { now_utc: string; now_tehran: string; timezone: string };
  config?: { is_enabled: boolean; send_time: string; send_days: number[] } | null;
  heartbeat?: {
    last_seen_at: string; last_tehran_date: string; last_tehran_time: string;
    configured_time: string | null; source: string; age_seconds: number;
  } | null;
  scheduler: SchedulerInfo;
  cron_runs: CronRun[];
  report_runs: ReportRun[];
  sms_logs: SmsLog[];
};

type TestResult = {
  dryRun?: any;
  sms?: any;
  error?: string;
};

const inputClass = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm';

const statusLabel: Record<string, string> = {
  completed: 'تکمیل‌شده',
  running: 'در حال اجرا',
  failed: 'ناموفق',
  missed: 'از دست‌رفته',
  skipped_day: 'روز غیرفعال',
  skipped_no_recipients: 'بدون گیرنده',
  sent: 'ارسال‌شده',
  pending: 'در انتظار',
  skipped: 'رد‌شده',
  succeeded: 'موفق',
};

const reasonLabel = (value: string | null | undefined) => {
  if (!value) return '—';
  const map: Record<string, string> = {
    no_config: 'تنظیمات ارسال یافت نشد',
    disabled: 'ارسال جلسات مدیریتی غیرفعال است',
    skipped_day: 'امروز در روزهای ارسال انتخاب نشده است',
    skipped_not_time: 'هنوز زمان ارسال نرسیده بود',
    missed: 'Scheduler بعد از بازه مجاز اجرا شده است',
    already_processed: 'اجرای امروز قبلاً پردازش شده است',
    skipped_no_recipients: 'هیچ دریافت‌کننده‌ای تنظیم نشده است',
    meetings_query_error: 'خطا در خواندن جلسات',
    inbox_query_error: 'خطا در خواندن کارتابل جلسات',
  };
  return map[value] || value;
};

const formatDateTime = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('fa-IR')} ${d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
};

const maskPhone = (phone: string | null) => {
  if (!phone) return '—';
  const d = phone.replace(/\D/g, '');
  if (d.length < 7) return phone;
  return `${d.slice(0, 3)}****${d.slice(-4)}`;
};

export function DailyReportMonitor() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [testPhone, setTestPhone] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: result, error } = await supabase.rpc('get_daily_report_scheduler_diagnostics', {
      p_run_limit: 25,
      p_sms_limit: 50,
    });
    if (error) {
      toast.error(`خطا در دریافت وضعیت ارسال جلسات: ${error.message}`);
      setData(null);
    } else {
      setData(result as Diagnostics);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const latestScheduledRun = useMemo(
    () => data?.report_runs?.find(r => r.trigger_type === 'scheduled') || null,
    [data],
  );
  const latestCronRun = data?.cron_runs?.[0] || null;
  const latestSms = data?.sms_logs?.[0] || null;

  const heartbeatAge = data?.heartbeat?.age_seconds ?? null;
  const schedulerHealthy = heartbeatAge !== null && heartbeatAge >= -30 && heartbeatAge <= 90;
  const reportHealthy = latestScheduledRun?.status === 'completed';
  const runDelay = latestScheduledRun?.start_delay_seconds ?? null;

  const runTest = async () => {
    const raw = testPhone.trim();
    if (!/^(?:\+98|0098|98|0)?9\d{9}$/.test(raw.replace(/[\s-]/g, ''))) {
      toast.error('شماره موبایل معتبر وارد کنید');
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('نشست کاربری معتبر نیست');

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      // Step 1: exercise the real daily-report generation path without sending to configured recipients.
      const dryRes = await fetch(`${supabaseUrl}/functions/v1/send-daily-meetings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({ force: true, dry_run: true }),
      });
      const dryJson = await dryRes.json().catch(() => ({}));
      if (!dryRes.ok || !dryJson.ok) {
        const reason = dryJson.error || reasonLabel(dryJson.reason) || `HTTP ${dryRes.status}`;
        throw new Error(`تولید گزارش ناموفق بود: ${reason}`);
      }

      // Step 2: send one real SMS through the same default provider used by daily reports.
      const message = [
        'تست ارسال جلسات مدیریتی Spark',
        'مسیر تولید گزارش: موفق',
        `تاریخ گزارش: ${dryJson.jalali_date || dryJson.tehran_date || '—'}`,
        `گیرندگان محاسبه‌شده: ${dryJson.deduplicated_recipient_count ?? dryJson.sent_recipients ?? 0}`,
        `جلسات محاسبه‌شده: ${dryJson.total_meetings ?? 0}`,
      ].join('\n');

      const smsRes = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({ mode: 'send', mobiles: [raw], message }),
      });
      const smsJson = await smsRes.json().catch(() => ({}));
      setTestResult({ dryRun: dryJson, sms: smsJson });

      if (!smsRes.ok || !smsJson.ok) {
        toast.error(`تولید گزارش موفق بود، ولی SMS ناموفق بود: ${smsJson.error || `HTTP ${smsRes.status}`}`);
      } else {
        toast.success(`تست کامل موفق بود — شناسه ارسال: ${smsJson.returnIds?.[0] || smsJson.packId || 'ثبت شد'}`);
      }
    } catch (e: any) {
      setTestResult({ error: e?.message || 'خطای نامشخص' });
      toast.error(e?.message || 'خطا در تست ارسال');
    } finally {
      setTesting(false);
      await load();
    }
  };

  if (loading && !data) {
    return <div className="py-20 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-500" />
            مانیتور ارسال جلسات مدیریتی
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">وضعیت Scheduler، اجرای گزارش و نتیجه ارسال پیامک</p>
        </div>
        <button onClick={load} disabled={loading}
          className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2"><Clock className="w-4 h-4 text-blue-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-200">Scheduler واقعی</span></div>
          <p className={`text-sm font-bold ${schedulerHealthy ? 'text-green-600' : 'text-red-600'}`}>{schedulerHealthy ? 'فعال — Heartbeat سالم' : 'Heartbeat قطع / قدیمی'}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">systemd · تیک دقیق هر دقیقه · Asia/Tehran</p>
          <p className="text-xs text-gray-400 mt-1">ساعت ارسال: <span className="font-mono">{data?.config?.send_time || data?.heartbeat?.configured_time || '—'}</span></p>
          <p className="text-xs text-gray-400 mt-1">ساعت DB تهران: <span className="font-mono">{data?.database_clock?.now_tehran || '—'}</span></p>
          <p className="text-xs text-gray-400 mt-1">آخرین Heartbeat: {heartbeatAge === null ? 'ثبت نشده' : `${heartbeatAge} ثانیه قبل`}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2"><CalendarDays className="w-4 h-4 text-teal-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-200">آخرین اجرای زمان‌بندی‌شده</span></div>
          <p className={`text-sm font-bold ${reportHealthy ? 'text-green-600' : latestScheduledRun ? 'text-amber-600' : 'text-gray-400'}`}>{latestScheduledRun ? (statusLabel[latestScheduledRun.status] || latestScheduledRun.status) : 'هنوز اجرا نشده'}</p>
          <p className="text-xs text-gray-400 mt-1">شروع واقعی: {formatDateTime(latestScheduledRun?.started_at)}</p>
          <p className={`text-xs mt-1 ${runDelay !== null && Math.abs(runDelay) <= 30 ? 'text-green-600' : 'text-amber-600'}`}>
            انحراف از ساعت تنظیم‌شده: {runDelay === null ? '—' : `${runDelay >= 0 ? '+' : ''}${runDelay} ثانیه`}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-2"><MessageSquare className="w-4 h-4 text-green-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-200">آخرین SMS گزارش</span></div>
          <p className={`text-sm font-bold ${latestSms?.status === 'sent' ? 'text-green-600' : latestSms?.status === 'failed' ? 'text-red-600' : 'text-gray-400'}`}>{latestSms ? (statusLabel[latestSms.status] || latestSms.status) : 'رکوردی نیست'}</p>
          <p className="text-xs text-gray-400 mt-1">{formatDateTime(latestSms?.created_at)}</p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-blue-100 dark:border-blue-900/40 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-blue-500" />
          <div>
            <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">تست کامل ارسال</h4>
            <p className="text-xs text-gray-400">ابتدا تولید گزارش Dry Run می‌شود، سپس یک SMS واقعی فقط به شماره زیر ارسال می‌شود.</p>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="مثلاً 09123456789" dir="ltr" className={inputClass} />
          <button onClick={runTest} disabled={testing}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium disabled:opacity-50">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            ارسال تست
          </button>
        </div>
        {testResult && (
          <div className={`rounded-xl p-3 text-xs ${testResult.error || (testResult.sms && !testResult.sms.ok) ? 'bg-red-50 dark:bg-red-900/15 text-red-700 dark:text-red-300' : 'bg-green-50 dark:bg-green-900/15 text-green-700 dark:text-green-300'}`}>
            {testResult.error ? (
              <div className="flex items-start gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{testResult.error}</span></div>
            ) : (
              <div className="space-y-1">
                <div className="flex items-center gap-2"><CheckCircle className="w-4 h-4" /><span>تولید گزارش: موفق — {testResult.dryRun?.total_meetings ?? 0} جلسه</span></div>
                <div className="flex items-center gap-2">
                  {testResult.sms?.ok ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <span>ارسال SMS: {testResult.sms?.ok ? 'موفق' : `ناموفق — ${testResult.sms?.error || 'خطای نامشخص'}`}</span>
                </div>
                {testResult.sms?.returnIds?.[0] && <p className="mr-6" dir="ltr">Message ID: {testResult.sms.returnIds[0]}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">تاریخچه اجرای گزارش</h4>
          <p className="text-xs text-gray-400 mt-1">اگر این بخش برای یک روز رکورد نداشته باشد، تابع گزارش در آن روز اصلاً اجرا نشده است.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 dark:bg-gray-700/40 text-gray-500">
              <tr><th className="p-3 text-right">زمان اجرا</th><th className="p-3 text-right">نوع</th><th className="p-3 text-right">وضعیت</th><th className="p-3 text-right">گیرنده / جلسه</th><th className="p-3 text-right">علت / خطا</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {(data?.report_runs || []).map(run => (
                <tr key={run.id} className="text-gray-700 dark:text-gray-300">
                  <td className="p-3 whitespace-nowrap">{formatDateTime(run.started_at)}</td>
                  <td className="p-3">{run.trigger_type === 'scheduled' ? 'خودکار' : 'دستی'}</td>
                  <td className="p-3 font-medium">{statusLabel[run.status] || run.status}</td>
                  <td className="p-3">{run.recipient_count ?? '—'} / {run.meeting_count ?? '—'}</td>
                  <td className="p-3 max-w-md break-words">{reasonLabel(run.error_text) || '—'}</td>
                </tr>
              ))}
              {!data?.report_runs?.length && <tr><td colSpan={5} className="p-8 text-center text-gray-400">هیچ اجرای ثبت‌شده‌ای وجود ندارد.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700"><h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">اجرای Scheduler</h4></div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-y-auto">
            {(data?.cron_runs || []).map(run => (
              <div key={run.runid} className="p-3 text-xs">
                <div className="flex justify-between gap-2"><span className="text-gray-700 dark:text-gray-300">{formatDateTime(run.start_time)}</span><span className={run.status === 'succeeded' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{statusLabel[run.status] || run.status}</span></div>
                {run.return_message && <p className="mt-1 text-gray-400 break-words" dir="ltr">{run.return_message}</p>}
              </div>
            ))}
            {!data?.cron_runs?.length && <p className="p-8 text-center text-xs text-gray-400">هنوز اجرای Cron ثبت نشده است.</p>}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700"><h4 className="text-sm font-bold text-gray-800 dark:text-gray-100">SMSهای جلسات مدیریتی</h4></div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-80 overflow-y-auto">
            {(data?.sms_logs || []).map(log => (
              <div key={log.id} className="p-3 text-xs space-y-1">
                <div className="flex justify-between gap-2"><span className="text-gray-700 dark:text-gray-300">{maskPhone(log.target_phone)} · {log.provider_name || 'Provider نامشخص'}</span><span className={log.status === 'sent' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{statusLabel[log.status] || log.status}</span></div>
                <p className="text-gray-400">{formatDateTime(log.created_at)} · تحویل: {log.delivery_status || '—'}</p>
                {log.provider_message_id && <p className="text-gray-400" dir="ltr">ID: {log.provider_message_id}</p>}
                {log.error_text && <p className="text-red-500 break-words">{log.error_text}</p>}
              </div>
            ))}
            {!data?.sms_logs?.length && <p className="p-8 text-center text-xs text-gray-400">هنوز SMS مرتبط با گزارش روزانه ثبت نشده است.</p>}
          </div>
        </div>
      </div>

      {latestCronRun && latestCronRun.status !== 'succeeded' && (
        <div className="rounded-xl bg-red-50 dark:bg-red-900/15 text-red-700 dark:text-red-300 p-3 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>آخرین اجرای Scheduler ناموفق بوده است: {latestCronRun.return_message || latestCronRun.status}</span>
        </div>
      )}
    </div>
  );
}
