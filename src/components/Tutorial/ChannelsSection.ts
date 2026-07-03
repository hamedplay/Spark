import {
  Hash, Lock, Globe, Users, Settings, Pin,
  SquareCheck as CheckSquare, Star, BellOff, Newspaper,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ChannelsSection: GuideSection = {
  id: 'channels',
  title: 'کانال‌ها',
  icon: Hash,
  color: 'purple',
  gradient: 'from-violet-500 to-purple-700',
  overview: 'کانال‌های سازمانی — فضاهای تیمی برای همکاری گروهی، اشتراک‌گذاری محتوا و مدیریت کارهای تیمی.',
  icons: [
    { icon: Hash, name: 'کانال', desc: 'هر کانال یک فضای تیمی با موضوع مشخص', color: 'text-purple-600' },
    { icon: Lock, name: 'کانال خصوصی', desc: 'کانال با دسترسی محدود — فقط اعضای دعوت‌شده', color: 'text-red-600' },
    { icon: Globe, name: 'کانال عمومی', desc: 'کانال باز — همه کاربران می‌توانند عضو شوند', color: 'text-green-600' },
    { icon: Users, name: 'اعضا', desc: 'مدیریت اعضای کانال — دعوت یا حذف', color: 'text-blue-600' },
    { icon: Settings, name: 'تنظیمات', desc: 'تغییر نام، آیکن و رنگ کانال', color: 'text-slate-600' },
    { icon: Pin, name: 'پیام پین‌شده', desc: 'پیام‌های مهم که در بالای کانال نمایش داده می‌شوند', color: 'text-amber-600' },
    { icon: CheckSquare, name: 'کارهای تیمی', desc: 'مدیریت وظایف گروهی در کانال', color: 'text-emerald-600' },
    { icon: Star, name: 'ستاره', desc: 'کانال‌های مورد علاقه را ستاره‌دار کنید', color: 'text-yellow-600' },
    { icon: BellOff, name: 'بی‌صدا', desc: 'غیرفعال کردن اعلان‌های کانال', color: 'text-gray-600' },
    { icon: Newspaper, name: 'موضوعات کاری', desc: 'پنل اخبار و موضوعات مرتبط با کانال', color: 'text-sky-600' },
  ],
  steps: [
    {
      title: 'ایجاد کانال',
      items: [
        'سایدبار → «کانال جدید»',
        'نام، توضیح و نوع کانال (عمومی/خصوصی) را انتخاب کنید',
        'اعضای اولیه را دعوت کنید',
        'رنگ و آیکن کانال را تنظیم کنید',
      ],
    },
    {
      title: 'کارهای تیمی در کانال',
      items: [
        'پنل «کارهای تیمی» در سایدبار کانال',
        'ایجاد کار، تعیین مسئول و تاریخ سررسید (ددلاین)',
        'وضعیت کارها: در انتظار / در حال انجام / تکمیل',
        'اعضا می‌توانند کارها را به خود اختصاص دهند',
        'کارهای دیرکرده با رنگ قرمز در پنل کانال نمایش داده می‌شوند',
      ],
    },
  ],
  tips: [
    'از # برای اشاره به کانال‌ها در پیام‌ها استفاده کنید',
    'کانال‌های ستاره‌دار در بالای لیست نمایش می‌یابند',
    'مدیر کانال می‌تواند پیام‌ها را ویرایش یا حذف کند',
  ],
  sparkQuestions: [
    'برو به صفحه کانال‌ها',
    'چطور یک کانال جدید بسازم؟',
  ],
};
