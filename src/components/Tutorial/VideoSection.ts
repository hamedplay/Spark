import {
  Video, Plus, Mic, MicOff, VideoOff, LayoutGrid, MonitorPlay,
  UserPlus, LogIn, Copy, Send, Search, RefreshCw,
  Globe, Lock, Shield, LogOut, Circle as XCircle,
  Users, Clock, ChevronRight,
} from 'lucide-react';
import type { GuideSection } from './types';

export const VideoSection: GuideSection = {
  id: 'video',
  title: 'ویدیو کنفرانس',
  icon: Video,
  color: 'indigo',
  gradient: 'from-sky-500 to-blue-700',
  overview: 'سیستم ویدیو کنفرانس داخلی — ایجاد یا پیوستن به اتاق، کنترل میکروفون/دوربین، دعوت اعضا، اشتراک لینک و مدیریت جلسه. بدون نیاز به نرم‌افزار جانبی — مستقیم در مرورگر.',
  icons: [
    { icon: Plus, name: 'اتاق جدید', desc: 'ایجاد اتاق کنفرانس جدید با نام دلخواه', color: 'text-blue-600' },
    { icon: LogIn, name: 'پیوستن با کد', desc: 'ورود به اتاق موجود با وارد کردن کد اتاق', color: 'text-green-600' },
    { icon: Video, name: 'ورود به اتاق', desc: 'دکمه «ورود» — پس از تنظیم میکروفون و دوربین', color: 'text-teal-600' },
    { icon: Mic, name: 'میکروفون روشن', desc: 'ضبط و ارسال صدا — قابل toggle در هر زمان', color: 'text-green-600' },
    { icon: MicOff, name: 'میکروفون خاموش', desc: 'قطع صدا — بدون اطلاع به سایرین', color: 'text-red-600' },
    { icon: Video, name: 'دوربین روشن', desc: 'ارسال تصویر دوربین به اتاق', color: 'text-blue-600' },
    { icon: VideoOff, name: 'دوربین خاموش', desc: 'قطع تصویر — آواتار به جای دوربین نمایش می‌یابد', color: 'text-red-600' },
    { icon: LayoutGrid, name: 'نمای گالری', desc: 'همه شرکت‌کنندگان با اندازه مساوی در شبکه', color: 'text-teal-600' },
    { icon: MonitorPlay, name: 'نمای اسپیکر', desc: 'بزرگ‌نمایی خودکار گوینده فعال — مناسب ارائه', color: 'text-purple-600' },
    { icon: UserPlus, name: 'دعوت اعضا', desc: 'جستجو و ارسال دعوت‌نامه به کاربران سازمان', color: 'text-teal-600' },
    { icon: Send, name: 'ارسال دعوت', desc: 'ارسال نوتیفیکیشن دعوت به کاربران انتخاب‌شده', color: 'text-sky-600' },
    { icon: Copy, name: 'کپی کد اتاق', desc: 'کپی کد کوتاه برای اشتراک‌گذاری', color: 'text-slate-600' },
    { icon: Globe, name: 'لینک عمومی', desc: 'لینک کامل ورود — قابل کپی و ارسال', color: 'text-green-600' },
    { icon: Lock, name: 'اتاق قفل', desc: 'اتاقی که ورود جدید ممنوع است', color: 'text-red-600' },
    { icon: Shield, name: 'تأیید میزبان', desc: 'فعال کردن اتاق انتظار — ورود نیاز به تأیید دارد', color: 'text-amber-600' },
    { icon: Search, name: 'جستجو برای دعوت', desc: 'جستجوی کاربران سازمان برای ارسال دعوت', color: 'text-gray-600' },
    { icon: RefreshCw, name: 'بارگذاری مجدد', desc: 'به‌روزرسانی لیست اتاق‌های فعال', color: 'text-slate-500' },
    { icon: Users, name: 'شرکت‌کنندگان', desc: 'تعداد نفرات حاضر در اتاق', color: 'text-blue-500' },
    { icon: Clock, name: 'مدت جلسه', desc: 'تایمر نمایش مدت زمان جلسه', color: 'text-teal-600' },
    { icon: LogOut, name: 'خروج', desc: 'خروج از اتاق — جلسه برای سایرین ادامه می‌یابد', color: 'text-amber-600' },
    { icon: XCircle, name: 'پایان جلسه', desc: 'بستن اتاق برای همه — فقط میزبان', color: 'text-red-600' },
    { icon: ChevronRight, name: 'ورود سریع', desc: 'دکمه «ورود» روی کارت اتاق در لیست', color: 'text-teal-600' },
  ],
  steps: [
    {
      title: 'برگزاری جلسه جدید',
      items: [
        'روی «اتاق جدید» کلیک کنید و نام اتاق را وارد کنید',
        'تنظیمات قبل از ورود: میکروفون و دوربین را چک کنید',
        'در صورت نیاز «تأیید میزبان» را فعال کنید',
        'روی «ورود» کلیک کنید — اتاق فعال می‌شود',
        'کد اتاق یا لینک را کپی کنید و برای دیگران ارسال کنید',
        'با آیکن دعوت، کاربران سازمان را دعوت کنید',
      ],
    },
    {
      title: 'پیوستن به اتاق',
      items: [
        'در لیست اتاق‌های فعال روی «ورود» کلیک کنید',
        'یا «پیوستن با کد» → کد اتاق را وارد کنید',
        'اگر اتاق انتظار دارد: منتظر تأیید میزبان بمانید',
        'اگر ممنوعیت (Ban) دارید، پیام دلیل نمایش می‌یابد',
      ],
    },
    {
      title: 'کنترل‌های درون اتاق',
      items: [
        'Mic و Camera در نوار پایین قابل toggle هستند',
        'نمای گالری: همه اعضا با اندازه مساوی',
        'نمای اسپیکر: گوینده فعال بزرگ می‌شود',
        'برای خروج: «خروج» — اتاق برای سایرین باز می‌ماند',
        'برای پایان کامل: «پایان جلسه» — فقط میزبان',
      ],
    },
  ],
  tips: [
    'کد اتاق را کپی کنید — کاربران خارج از سازمان هم با لینک می‌توانند وارد شوند',
    'اتاق انتظار (Shield) برای کنترل ورود مهمانان مفید است',
    'لیست اتاق‌های فعال به‌صورت real-time به‌روز می‌شود',
    'با «بارگذاری مجدد» آخرین وضعیت اتاق‌ها را ببینید',
  ],
  sparkQuestions: [
    'برو به صفحه ویدیو کنفرانس',
    'تماس تصویری با علی بگیر',
  ],
};
