import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

type Policy = Record<'invite_in_app' | 'invite_sms' | 'change_in_app' | 'change_sms' | 'reminder_in_app' | 'reminder_sms' | 'external_reminder_sms', boolean>;
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
  useEffect(() => { let active=true; void (async()=>{
    const result=await (supabase as any).rpc('get_recurring_notification_policy');
    if (!active) return;
    if (result.error) setError('دریافت سیاست جلسات تکراری ممکن نشد؛ دسترسی مدیر لازم است.');
    else setPolicy(result.data);
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
  return <section className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700" dir="rtl">
    <h4 className="font-bold dark:text-white">اطلاع‌رسانی جلسات تکراری</h4>
    <p className="text-sm text-gray-500">دعوت اولیه یک پیام برای کل سری است. فاصله یادآوری از تنظیم هر جلسه خوانده می‌شود. پیامک افراد خارج سازمان به فعال‌بودن پیامک در خود جلسه نیز وابسته است.</p>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : !policy ? <p>در حال دریافت تنظیمات…</p> : <>
      <div className="grid gap-3 sm:grid-cols-2">{(Object.keys(labels) as (keyof Policy)[]).map(key=><label key={key} className="flex items-center gap-2 text-sm dark:text-gray-200"><input type="checkbox" checked={policy[key]} disabled={busy} onChange={e=>setPolicy({...policy,[key]:e.target.checked})}/>{labels[key]}</label>)}</div>
      <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-violet-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy?'در حال ذخیره…':'ذخیره سیاست جلسات تکراری'}</button>
    </>}
  </section>;
}
