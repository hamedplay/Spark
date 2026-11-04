import { Video, ShieldAlert, Settings } from 'lucide-react';
import type { GuideSection } from './types';

// Video conferencing remains release-disabled in src/config/featureFlags.ts.
export const VideoSection: GuideSection = {
  id: 'video',
  title: 'ویدیو کنفرانس (غیرفعال)',
  icon: Video,
  color: 'slate',
  gradient: 'from-slate-500 to-slate-700',
  overview: 'قابلیت ویدیوکنفرانس در نسخه فعلی برای کاربران نهایی منتشر و فعال نشده است. امکانات ساخت اتاق، پیوستن و مدیریت جلسه آنلاین اکنون قابل استفاده نیستند.',
  icons: [
    { icon: ShieldAlert, name: 'وضعیت انتشار', desc: 'ورود و ساخت اتاق برای کاربران نهایی غیرفعال است', color: 'text-amber-600' },
    { icon: Settings, name: 'تنظیمات زیرساخت', desc: 'برای آماده‌سازی و آزمایش فنی توسط نقش‌های مجاز باقی مانده است', color: 'text-slate-600' },
  ],
  steps: [
    {
      title: 'وضعیت فعلی',
      items: [
        'در نسخه فعلی، ورود به ویدیوکنفرانس برای کاربران نهایی فعال نیست',
        'مشاهده تنظیمات مرتبط در بخش پیکربندی به معنای امکان برگزاری جلسه آنلاین نیست',
        'تا فعال‌سازی رسمی، از روش مورد تأیید سازمان برای جلسات آنلاین استفاده کنید',
      ],
    },
  ],
  tips: ['راهنمای کنترل‌های اتاق پس از انتشار رسمی قابلیت باید بر اساس امکانات فعال به‌روزرسانی شود'],
  sparkQuestions: [],
};
