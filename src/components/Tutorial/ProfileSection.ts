import {
  CircleUser as UserCircle, User, Building2, Globe, Activity,
  Mail, Phone, Camera, Save, Briefcase, Hash, Users,
  CreditCard, ChevronDown, ChevronUp, Crown,
  Link2, MessageCircle, AtSign, Unlink, RefreshCw,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ProfileSection: GuideSection = {
  id: 'profile',
  title: 'پروفایل',
  icon: UserCircle,
  color: 'slate',
  gradient: 'from-slate-500 to-gray-600',
  overview: 'مدیریت اطلاعات شخصی، سازمانی و حساب‌های متصل — پیوند تلگرام و بله برای اطلاع‌رسانی، آپلود تصویر، تکمیل اطلاعات سازمانی و نمایش وضعیت حضور.',
  icons: [
    { icon: Camera, name: 'آپلود تصویر', desc: 'کلیک روی آواتار — انتخاب فایل JPG/PNG/WEBP', color: 'text-blue-600' },
    { icon: Save, name: 'ذخیره پروفایل', desc: 'ذخیره تمام تغییرات — دکمه سبز در بالا', color: 'text-green-600' },
    { icon: User, name: 'اطلاعات شخصی', desc: 'نام، کد ملی، تاریخ تولد و جنسیت — بخش باز/بسته‌شونده', color: 'text-teal-600' },
    { icon: Mail, name: 'ایمیل', desc: 'ایمیل ورود — فقط‌خواندنی (مدیریت‌شده توسط ادمین)', color: 'text-blue-500' },
    { icon: Phone, name: 'موبایل', desc: 'شماره موبایل برای تماس و پیامک', color: 'text-green-600' },
    { icon: Briefcase, name: 'سمت سازمانی', desc: 'عنوان شغلی — قابل ویرایش توسط خود یا ادمین', color: 'text-amber-600' },
    { icon: Building2, name: 'اطلاعات سازمانی', desc: 'سازمان، واحد و کد پرسنلی — بخش باز/بسته‌شونده', color: 'text-slate-600' },
    { icon: Hash, name: 'کد پرسنلی', desc: 'شناسه یکتا در سازمان', color: 'text-gray-600' },
    { icon: Users, name: 'واحد سازمانی', desc: 'بخش یا واحد محل کار', color: 'text-blue-600' },
    { icon: Globe, name: 'اطلاعات اجتماعی', desc: 'وب‌سایت و شبکه‌های اجتماعی — بخش باز/بسته‌شونده', color: 'text-sky-600' },
    { icon: Activity, name: 'وضعیت حضور', desc: 'آنلاین / مشغول / دور از دستگاه / مزاحم نشوید', color: 'text-green-600' },
    { icon: Crown, name: 'سطح مجوز', desc: 'نمایش نقش کاربر: ادمین / کاربر / مدیر', color: 'text-yellow-600' },
    { icon: CreditCard, name: 'تاریخ‌های مهم', desc: 'تاریخ تولد و تاریخ استخدام با تقویم شمسی', color: 'text-purple-600' },
    { icon: MessageCircle, name: 'اتصال بله', desc: 'پیوند حساب بله برای دریافت اعلان‌های جلسه', color: 'text-teal-600' },
    { icon: AtSign, name: 'اتصال تلگرام', desc: 'پیوند حساب تلگرام برای دریافت نوتیفیکیشن', color: 'text-blue-600' },
    { icon: Link2, name: 'اتصال پیام‌رسان', desc: 'پیوند از طریق deep-link — polling خودکار تأیید', color: 'text-sky-600' },
    { icon: Unlink, name: 'قطع اتصال', desc: 'حذف پیوند پیام‌رسان متصل‌شده', color: 'text-red-600' },
    { icon: RefreshCw, name: 'رفرش', desc: 'بارگذاری مجدد تنظیمات اسپارک از پروفایل', color: 'text-slate-500' },
    { icon: ChevronDown, name: 'باز کردن بخش', desc: 'نمایش محتوای بخش‌های جمع‌شده', color: 'text-gray-500' },
    { icon: ChevronUp, name: 'جمع کردن بخش', desc: 'پنهان کردن محتوای بخش برای فضای بیشتر', color: 'text-gray-500' },
  ],
  steps: [
    {
      title: 'تکمیل پروفایل',
      items: [
        'از منوی اصلی روی آیکن کاربر → «پروفایل»',
        'روی آواتار کلیک کنید تا تصویر آپلود کنید',
        'بخش «اطلاعات شخصی» را باز کنید و پر کنید',
        'بخش «اطلاعات سازمانی» را تکمیل کنید',
        'روی «ذخیره» کلیک کنید',
      ],
    },
    {
      title: 'اتصال پیام‌رسان',
      items: [
        'بخش «شبکه‌های اجتماعی» را باز کنید',
        'روی «اتصال بله» یا «اتصال تلگرام» کلیک کنید',
        'لینک deep-link نمایش می‌یابد — روی آن کلیک کنید',
        'در پیام‌رسان Start/ارسال بزنید',
        'سیستم به‌صورت خودکار polling می‌کند تا تأیید شود',
        'پس از اتصال، اعلان‌های جلسه به پیام‌رسان ارسال می‌شوند',
      ],
    },
  ],
  tips: [
    'پروفایل کامل باعث می‌شود همکاران شما را در جستجو بهتر پیدا کنند',
    'پس از اتصال بله/تلگرام، اعلان جلسات جدید به‌صورت خودکار ارسال می‌شود',
    'ایمیل فقط‌خواندنی است — برای تغییر با ادمین تماس بگیرید',
    'وضعیت حضور در چت و لیست کاربران سازمان نمایش داده می‌شود',
    'بخش‌های اطلاعات قابل باز و بسته شدن هستند برای راحتی ویرایش',
  ],
  sparkQuestions: [
    'برو به صفحه پروفایل',
  ],
};
