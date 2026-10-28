import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

type Policy = Record<'invite_in_app' | 'invite_sms' | 'change_in_app' | 'change_sms' | 'reminder_in_app' | 'reminder_sms' | 'external_reminder_sms', boolean>;
type Runtime = { worker_configured: boolean; cron_active: boolean; scheduler: { dispatch_status: string; last_tick_at: string | null; last_error: string | null } | null; queue: Record<string,number> };
const labels: Record<keyof Policy,string> = {
  invite_in_app: 'دعوت خلاصه سری: اعلان داخلی', invite_sms: 'دعوت خلاصه سری: پیامک',
  change_in_app: 'تغییر مهم و لغو: اعلان داخلی', change_sms: 'تغییر مهم و لغو: پیامک',
  reminder_in_app: 'یادآوری هر نوبت: اعلان داخلی و Push', reminder_sms: 'یادآوری هر نوبت: پیامک کاربران سازمان',
  external_reminder_sms: 'یادآوری هر نوبت: پیامک افراد خارج سازمان',
};
export function RecurringMeetingPolicy() {
  const [policy,setPolicy] = useState<Policy|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [runtime,setRuntime] = useState<Runtime|null>(null);
  const [runtimeError,setRuntimeError] = useState(false);
  useEffect(() => { let active=true; void (async()=>{
    const [result,health]=await Promise.all([
      (supabase as any).rpc('get_recurring_notification_policy'),
      (supabase as any).rpc('get_recurring_notification_runtime_status'),
    ]);
    if (!active) return;
    if (result.error) setError('دریافت سیاست جلسات تکراری ممکن نشد؛ دسترسی مدیر لازم است.');
    else setPolicy(result.data);
    if(health.error) setRuntimeError(true); else setRuntime(health.data);
  })(); return ()=>{active=false;}; },[]);
  async function save() {
    setBusy(true);
    try {
      const {error}=await (supabase as any).rpc('set_recurring_notification_policy',{p_policy:policy});
      if(error) throw error;
      toast.success('سیاست اطلاع‌رسانی جلسات تکراری ذخیره شد');
    } catch { toast.error('ذخیره سیاست اطلاع‌رسانی ناموفق بود'); }
    finally {setBusy(false);}
  }
  async function configureDelivery() {
    setBusy(true);
    try {
      const {data,error}=await (supabase as any).rpc('configure_recurring_notification_delivery',{p_origin:window.location.origin});
      if(error) throw error;
      setRuntime(data); setRuntimeError(false);
      toast.success('ارسال خودکار برای آدرس فعلی سامانه راه‌اندازی شد؛ نتیجه ارسال را در گزارش پیامک بررسی کنید');
    } catch { toast.error('راه‌اندازی ارسال ممکن نشد؛ اتصال HTTPS، دسترسی مدیر و نصب Migration جدید را بررسی کنید'); }
    finally {setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700" dir="rtl">
    <h4 className="font-bold dark:text-white">اطلاع‌رسانی جلسات تکراری</h4>
    <p className="text-sm text-gray-500">دعوت اولیه یک پیام برای کل سری است. فاصله یادآوری از تنظیم هر جلسه خوانده می‌شود. پیامک افراد خارج سازمان به فعال‌بودن پیامک در خود جلسه نیز وابسته است.</p>
    <p className="text-sm text-gray-500">این سیاست برای سری‌هایی است که با نسخه جدید ساخته شده‌اند؛ نوبت‌های قدیمی بدون پیوند سری، خودکار به هم متصل نمی‌شوند.</p>
    {runtimeError ? <p role="status" className="text-sm text-amber-700 dark:text-amber-300">وضعیت اجرای صف در دسترس نیست؛ آماده‌بودن پردازشگر پیامک تأیید نشده است.</p> : runtime && <div role="status" className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-700 dark:bg-gray-800 dark:text-gray-200">
      {!runtime.worker_configured ? <p className="text-red-600 dark:text-red-400">ارسال خودکار راه‌اندازی نشده است. پس از به‌روزرسانی سرویس پیامک سرور، از دکمه زیر استفاده کنید.</p>
        : !runtime.cron_active ? <p className="text-red-600 dark:text-red-400">زمان‌بند جلسات تکراری غیرفعال است؛ ارسال خودکار انجام نمی‌شود.</p>
        : <p>پیکربندی زمان‌بند موجود است؛ تأیید تحویل پیامک از گزارش ارسال بررسی می‌شود.</p>}
      <p>در انتظار پردازش: {runtime.queue.pending ?? 0} · در حال پردازش: {runtime.queue.processing ?? 0} · نتیجه نامشخص: {runtime.queue.uncertain ?? 0} · ناموفق: {runtime.queue.failed ?? 0}</p>
      {(runtime.queue.uncertain ?? 0)>0 && <p>موارد با نتیجه نامشخص خودکار دوباره ارسال نمی‌شوند؛ ابتدا رسید سرویس‌دهنده بررسی شود.</p>}
      {runtime.scheduler?.last_tick_at && <p>آخرین اجرای زمان‌بند: {new Date(runtime.scheduler.last_tick_at).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'})}</p>}
    </div>}
    {policy && <div className="space-y-2 text-sm">
      <p className="text-gray-500">راه‌اندازی، آدرس همین سامانه را ثبت می‌کند و پردازش پیامک‌های در انتظار را فعال می‌کند. پس از جابه‌جایی سرور نیز از همین گزینه استفاده کنید؛ موارد با نتیجه نامشخص دوباره ارسال نمی‌شوند.</p>
      <button type="button" disabled={busy} onClick={configureDelivery} className="rounded-lg border border-violet-600 px-4 py-2 text-violet-700 dark:text-violet-300 disabled:opacity-50">راه‌اندازی ارسال خودکار در این سامانه</button>
    </div>}
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : !policy ? <p>در حال دریافت تنظیمات…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">{(Object.keys(labels) as (keyof Policy)[]).map(key=><label key={key} className="flex items-center gap-2 text-sm dark:text-gray-200"><input type="checkbox" checked={policy[key]} disabled={busy} onChange={e=>setPolicy({...policy,[key]:e.target.checked})}/>{labels[key]}</label>)}</div>
      <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy?'در حال ذخیره…':'ذخیره سیاست جلسات تکراری'}</button>
    </>}
  </section>;
}
