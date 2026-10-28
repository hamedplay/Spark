import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

// The server reads durable jobs; recipients, text and delivery identities are
// never supplied by the browser. Failures leave jobs for the background timer.
export async function dispatchRecurringMeetingDelivery(seriesId: string): Promise<void> {
  try {
    for (let batch = 0; batch < 4; batch++) {
      const { data, error } = await supabase.functions.invoke('send-sms', { body: { mode: 'recurring_delivery', seriesId } });
      if (error || data?.recording_failed || data?.failed || data?.uncertain) {
        toast.error('تغییر جلسه ذخیره شد؛ ارسال بعضی پیام‌ها تأیید نشد. گزارش ارسال را بررسی کنید.');
        return;
      }
      if (!data?.more) return;
    }
    toast('ارسال باقی پیام‌ها از صف سرور ادامه پیدا می‌کند.');
  } catch {
    toast.error('تغییر جلسه ذخیره شد؛ ارسال فوری ممکن نشد و پیام‌ها در صف سرور باقی ماندند.');
  }
}
