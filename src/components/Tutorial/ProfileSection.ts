import {
  CircleUser as UserCircle, Image as ImageIcon, User,
  Building2, Globe, Activity, Sun, Moon, Palette,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ProfileSection: GuideSection = {
  id: 'profile',
  title: 'پروفایل',
  icon: UserCircle,
  color: 'slate',
  gradient: 'from-slate-500 to-gray-600',
  overview: 'اطلاعات شخصی، سازمانی و شبکه‌های اجتماعی خود را مدیریت کنید.',
  icons: [
    { icon: ImageIcon, name: 'تصویر پروفایل', desc: 'کلیک روی دوربین برای تغییر عکس (JPG/PNG/WEBP)', color: 'text-blue-600' },
    { icon: User, name: 'اطلاعات شخصی', desc: 'نام، موبایل، کد ملی، تاریخ تولد، جنسیت', color: 'text-teal-600' },
    { icon: Building2, name: 'اطلاعات سازمانی', desc: 'سازمان، سمت، واحد، کد پرسنلی', color: 'text-slate-600' },
    { icon: Globe, name: 'شبکه اجتماعی', desc: 'وب‌سایت و لینکدین', color: 'text-sky-600' },
    { icon: Activity, name: 'وضعیت حضور', desc: 'آنلاین / مشغول / دور از دستگاه / مزاحم نشوید', color: 'text-green-600' },
    { icon: Sun, name: 'حالت روز', desc: 'تم روشن (Light Mode)', color: 'text-amber-500' },
    { icon: Moon, name: 'حالت شب', desc: 'تم تاریک (Dark Mode)', color: 'text-slate-600' },
    { icon: Palette, name: 'رنگ تم', desc: 'انتخاب رنگ اصلی رابط کاربری', color: 'text-purple-600' },
  ],
  steps: [
    {
      title: 'تکمیل پروفایل',
      items: [
        'روی آیکن کاربر در بالای صفحه → «پروفایل»',
        'اطلاعات شخصی را پر کنید',
        'تصویر پروفایل را آپلود کنید',
        'سمت و واحد سازمانی را تکمیل کنید',
        'روی «ذخیره» کلیک کنید',
      ],
    },
  ],
  tips: [
    'پروفایل کامل باعث می‌شود سایر کاربران شما را بهتر بشناسند',
    'وضعیت حضور شما در چت و لیست کاربران نمایش داده می‌شود',
    'رنگ تم و حالت تاریک در همه صفحات اعمال می‌شود',
  ],
  sparkQuestions: [
    'برو به صفحه پروفایل',
  ],
};
