import type { CenterEvent } from './eventCenterModel';
import { eventClientContext } from './eventClientContext';

export function EventConnectionDetails({ event }: { event: CenterEvent }) {
  const context = eventClientContext(event);
  return <section className="space-y-3" aria-label="اطلاعات اتصال و دستگاه">
    <h5 className="font-semibold">اتصال و دستگاهِ این رخداد</h5>
    {[context.current, context.session].map((item, index) => item && <div key={index} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
      {index === 1 && <h6 className="mb-3 text-sm font-semibold">اطلاعات نشست مرتبط (ممکن است با زمان این رخداد متفاوت باشد)</h6>}
      <dl className="grid gap-3 sm:grid-cols-2">
        {Object.entries({ 'IP ثبت‌شده': item.ip, 'منبع IP': item.ipSource, 'بستر دستگاه': item.platform, 'نوع دستگاه': item.device,
          'سیستم‌عامل': item.os, 'مرورگر و نسخه': item.browser, 'منبع مشخصات دستگاه': item.provenance,
          ...(index === 1 && context.session?.observedAt ? { 'زمان ثبت اطلاعات نشست': new Date(context.session.observedAt).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' }) } : {}),
        }).map(([label, value]) => <div key={label} className="min-w-0 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt><dd dir="auto" className="mt-1 break-words text-sm">{value || 'ثبت نشده'}</dd>
        </div>)}
      </dl>
      {item.notes.map(note => <p key={note} className="mt-2 text-xs text-gray-500 dark:text-gray-400">{note}</p>)}
      {item.userAgent && <details className="mt-3 text-xs"><summary className="cursor-pointer">مشخصات خام مرورگر (User-Agent)</summary><p dir="ltr" className="mt-2 break-all font-mono leading-6">{item.userAgent}</p></details>}
    </div>)}
    <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">مشخصات دستگاه از اطلاعات اعلام‌شدهٔ مرورگر خوانده می‌شود و قابل تغییر است؛ مدل دقیق دستگاه همیشه قابل تشخیص نیست. IP ممکن است مربوط به VPN یا شبکهٔ مشترک باشد و اعتبار آن به تنظیم صحیح پراکسی بستگی دارد.</p>
  </section>;
}
