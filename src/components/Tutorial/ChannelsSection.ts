import { Hash, Lock, Globe, Users, Settings, Pin, SquareCheck as CheckSquare, Star, BellOff, Search, Plus, GitFork, ArrowRight, Smile, Reply, CreditCard as Edit2, Trash2, ClipboardList, MessageSquare } from 'lucide-react';
import type { GuideSection } from './types';

export const ChannelsSection: GuideSection = {
  id: 'channels',
  title: 'کانال‌ها و گروه‌ها',
  icon: Hash,
  color: 'purple',
  gradient: 'from-violet-500 to-purple-700',
  overview: 'فضاهای تیمی برای همکاری گروهی — کانال‌های موضوعی و گروه‌های کاری با پشتیبانی از پیام، وظایف تیمی، اعضا، پیام‌های پین‌شده و جستجوی پیشرفته.',
  icons: [
    { icon: Plus, name: 'کانال/گروه جدید', desc: 'ایجاد کانال (ادمین) یا گروه (با مجوز) — دو تب جداگانه', color: 'text-purple-600' },
    { icon: Hash, name: 'کانال', desc: 'فضای موضوعی سازمانی با دسترسی کنترل‌شده', color: 'text-purple-600' },
    { icon: MessageSquare, name: 'گروه', desc: 'گروه کاری با دسترسی‌های متفاوت از کانال', color: 'text-violet-600' },
    { icon: Lock, name: 'خصوصی', desc: 'فقط اعضای دعوت‌شده می‌توانند وارد شوند', color: 'text-red-600' },
    { icon: Globe, name: 'عمومی', desc: 'همه کاربران سازمان می‌توانند عضو شوند', color: 'text-green-600' },
    { icon: Search, name: 'جستجو', desc: 'جستجوی متن در تاریخچه پیام‌های کانال', color: 'text-gray-600' },
    { icon: GitFork, name: 'وظایف گروهی', desc: 'پنل مدیریت کارهای تیمی — با badge تعداد', color: 'text-emerald-600' },
    { icon: Users, name: 'اعضا', desc: 'مدیریت اعضا — دعوت، حذف و تغییر نقش', color: 'text-blue-600' },
    { icon: Settings, name: 'تنظیمات', desc: 'ویرایش نام، آیکن و رنگ کانال — فقط ادمین', color: 'text-slate-600' },
    { icon: Pin, name: 'پیام پین‌شده', desc: 'پیام‌های مهم — پین عمومی ادمین + پین خصوصی شخصی', color: 'text-amber-600' },
    { icon: Star, name: 'ستاره‌گذاری', desc: 'ستاره‌دار کردن پیام مهم در کانال', color: 'text-yellow-600' },
    { icon: BellOff, name: 'بی‌صدا', desc: 'غیرفعال کردن اعلان‌های کانال', color: 'text-gray-600' },
    { icon: Smile, name: 'ریکشن', desc: 'افزودن ایموجی واکنش به پیام‌های کانال', color: 'text-yellow-500' },
    { icon: Reply, name: 'پاسخ', desc: 'پاسخ ارجاع‌دار به پیام خاص در کانال', color: 'text-sky-600' },
    { icon: Edit2, name: 'ویرایش پیام', desc: 'ویرایش پیام ارسال‌شده — فقط پیام‌های خود', color: 'text-amber-600' },
    { icon: Trash2, name: 'حذف پیام', desc: 'حذف پیام — ادمین می‌تواند همه پیام‌ها را حذف کند', color: 'text-red-500' },
    { icon: ClipboardList, name: 'ثبت وظیفه', desc: 'تبدیل پیام به وظیفه گروهی با منشن کاربران', color: 'text-emerald-600' },
    { icon: ArrowRight, name: 'چت مستقیم', desc: 'باز کردن چت خصوصی با فرستنده پیام', color: 'text-teal-600' },
    { icon: CheckSquare, name: 'وظایف تیمی', desc: 'پنل WorkTopics — ایجاد، وضعیت و آرشیو وظایف', color: 'text-emerald-600' },
  ],
  steps: [
    {
      title: 'ایجاد کانال یا گروه',
      items: [
        'دکمه «+» در بالای لیست → انتخاب نوع (کانال یا گروه)',
        'نام، توضیح و نوع دسترسی (عمومی/خصوصی) را تنظیم کنید',
        'رنگ و آیکن کانال را انتخاب کنید',
        'اعضای اولیه را دعوت کنید — می‌توانند بعداً اضافه شوند',
        'برای کانال نیاز به مجوز ادمین دارید',
      ],
    },
    {
      title: 'وظایف گروهی (WorkTopics)',
      items: [
        'آیکن GitFork در header کانال — پنل وظایف تیمی باز می‌شود',
        'ایجاد وظیفه: تایپ در پیام + منشن کاربران مسئول',
        'تاریخ سررسید شمسی برای هر وظیفه قابل تنظیم است',
        'وضعیت: در انتظار / در حال انجام / تکمیل / آرشیو',
        'عضو می‌تواند وظیفه را به خود اختصاص دهد',
        'وظایف دیرکرده با رنگ قرمز نمایش داده می‌شوند',
      ],
    },
    {
      title: 'مدیریت پیام‌های کانال',
      items: [
        'ادمین‌ها می‌توانند همه پیام‌ها را ویرایش یا حذف کنند',
        'پین عمومی: ادمین — برای همه اعضا قابل مشاهده',
        'پین خصوصی: هر کاربر — فقط برای خودش',
        'ستاره‌ها در پنل «ستاره‌ها» در header کانال',
      ],
    },
  ],
  tips: [
    'کانال‌های ستاره‌دار در بالای لیست نمایش می‌یابند',
    'با منشن کردن کاربران در پیام و ثبت وظیفه، کار تیمی ساده‌تر می‌شود',
    'ادمین کانال می‌تواند پیام‌های همه اعضا را ویرایش یا حذف کند',
    'جستجو در کانال تاریخچه کامل پیام‌ها را پوشش می‌دهد',
  ],
  sparkQuestions: [
    'برو به صفحه کانال‌ها',
    'چطور یک کانال جدید بسازم؟',
  ],
};
