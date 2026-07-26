import { useState } from 'react';
import { Info, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';

export function SetupGuide({ channel }: { channel: 'telegram' | 'bale' }) {
  const [open, setOpen] = useState(false);

  const telegram = [
    { step: 1, title: 'ساخت بات تلگرام', desc: 'در تلگرام به @BotFather پیام بدید و دستور /newbot را بزنید. یک نام و یوزرنیم برای بات انتخاب کنید. در پایان BotFather یک توکن API مثل 123456:ABC-DEF... به شما می‌دهد.', link: 'https://t.me/BotFather', linkLabel: 'رفتن به BotFather' },
    { step: 2, title: 'دریافت Chat ID', desc: 'بات خود را به گروه یا کانال مورد نظر اضافه کنید و آن را ادمین کنید. سپس آدرس زیر را در مرورگر باز کنید (توکن را جایگزین کنید). در نتیجه به دنبال "id" در بخش "chat" بگردید.', code: 'https://api.telegram.org/bot<TOKEN>/getUpdates' },
    { step: 3, title: 'وارد کردن اطلاعات', desc: 'توکن بات و Chat ID را در فیلدهای زیر وارد کنید و وضعیت را فعال کنید. برای تست می‌توانید از دکمه "ارسال پیام آزمایشی" استفاده کنید.' },
    { step: 4, title: 'تنظیم Webhook (اختیاری)', desc: 'اگر می‌خواهید کاربران بتوانند با بات تعامل کنند، آدرس Edge Function را در فیلد Webhook URL وارد کنید.' },
  ];

  const bale = [
    { step: 1, title: 'ساخت بات بله', desc: 'در پیام‌رسان بله به @BotFather پیام بدید و دستور /newbot را بزنید. نام و یوزرنیم برای بات انتخاب کنید. توکن API دریافت‌شده را کپی کنید.' },
    { step: 2, title: 'دریافت Chat ID با getUpdates', desc: 'بات را به گروه یا کانال مورد نظر اضافه و ادمین کنید. با استفاده از دکمه «دریافت آپدیت‌ها» در زیر، آخرین پیام‌ها و Chat ID های مرتبط را مشاهده کنید.', code: 'https://tapi.bale.ai/bot<TOKEN>/getUpdates' },
    { step: 3, title: 'ثبت Webhook با setWebhook', desc: 'پس از وارد کردن Webhook URL، روی دکمه «ثبت Webhook» کلیک کنید. این عملیات متد setWebhook را روی سرور بله فراخوانی کرده و آدرس شما را به عنوان endpoint ثبت می‌کند.' },
    { step: 4, title: 'بررسی وضعیت با getWebhookInfo', desc: 'پس از ثبت، با دکمه «وضعیت Webhook» می‌توانید اطلاعات کامل webhook فعال (آدرس، تعداد آپدیت در صف، آخرین خطا) را مشاهده کنید.' },
  ];

  const steps = channel === 'telegram' ? telegram : bale;
  const color = channel === 'telegram' ? 'blue' : 'teal';

  return (
    <div className={`border rounded-2xl overflow-hidden bg-${color}-50 dark:bg-${color}-900/10 border-${color}-200 dark:border-${color}-800`}>
      <button onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-${color}-100/50 dark:hover:bg-${color}-900/20 transition-colors`}>
        <div className="flex items-center gap-2">
          <Info className={`w-4 h-4 text-${color}-600 dark:text-${color}-400 flex-shrink-0`} />
          <span className={`text-sm font-medium text-${color}-700 dark:text-${color}-300`}>
            راهنمای راه‌اندازی {channel === 'telegram' ? 'تلگرام' : 'بله'}
          </span>
        </div>
        {open ? <ChevronUp className={`w-4 h-4 text-${color}-500`} /> : <ChevronDown className={`w-4 h-4 text-${color}-500`} />}
      </button>
      {open && (
        <div className={`px-4 pb-5 pt-2 space-y-4 border-t border-${color}-200 dark:border-${color}-800`}>
          {steps.map(s => (
            <div key={s.step} className="flex gap-3">
              <div className={`w-6 h-6 rounded-full bg-${color}-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5`}>
                {s.step}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold text-${color}-800 dark:text-${color}-200 mb-1`}>{s.title}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{s.desc}</p>
                {'code' in s && (s as any).code && (
                  <code className="block mt-1.5 text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 px-3 py-2 rounded-lg text-gray-700 dark:text-gray-300 break-all">
                    {(s as any).code}
                  </code>
                )}
                {'link' in s && (s as any).link && (
                  <a href={(s as any).link} target="_blank" rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1 mt-1.5 text-xs text-${color}-600 dark:text-${color}-400 hover:underline font-medium`}>
                    <ExternalLink className="w-3 h-3" />
                    {(s as any).linkLabel}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
