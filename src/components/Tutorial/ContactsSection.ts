import {
  Phone, Plus, CreditCard as Edit2, Trash2,
  ListFilter as Filter, Download, Upload, Building2,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ContactsSection: GuideSection = {
  id: 'contacts',
  title: 'مخاطبین',
  icon: Phone,
  color: 'cyan',
  gradient: 'from-cyan-500 to-sky-600',
  overview: 'دفترچه تلفن و مخاطبین سازمانی — ذخیره اطلاعات تماس، سازمان و ایمیل به‌همراه جستجوی سریع.',
  icons: [
    { icon: Plus, name: 'مخاطب جدید', desc: 'افزودن مخاطب تلفنی یا ایمیل جدید', color: 'text-cyan-600' },
    { icon: Edit2, name: 'ویرایش', desc: 'تغییر اطلاعات مخاطب', color: 'text-amber-600' },
    { icon: Trash2, name: 'حذف', desc: 'حذف مخاطب از دفترچه', color: 'text-red-600' },
    { icon: Filter, name: 'جستجو', desc: 'جستجو بر اساس نام، شماره یا موضوع', color: 'text-blue-600' },
    { icon: Download, name: 'خروجی Excel', desc: 'صادر کردن لیست مخاطبین به فایل Excel', color: 'text-green-600' },
    { icon: Upload, name: 'ورودی Excel', desc: 'وارد کردن مخاطبین از فایل Excel', color: 'text-orange-600' },
    { icon: Building2, name: 'سازمان', desc: 'نام شرکت یا سازمان مخاطب', color: 'text-slate-600' },
  ],
  steps: [
    {
      title: 'ثبت مخاطب',
      items: [
        'روی «مخاطب جدید» کلیک کنید',
        'نام، شماره تماس و سازمان را وارد کنید',
        'برای مخاطبین ایمیل، آدرس ایمیل را هم وارد کنید',
        'اطلاعات با هنگام ایجاد جلسه به‌صورت خودکار ذخیره می‌شوند',
      ],
    },
  ],
  tips: [
    'مخاطبین قابل صادر کردن به Excel هستند',
    'اسپارک می‌تواند مخاطب جدید ثبت کند',
  ],
  sparkQuestions: [
    'چند تا مخاطب دارم؟',
    'مخاطب اضافه کن به نام احمدی شماره ۰۹۱۲۱۲۳۴۵۶۷',
    'برو به صفحه مخاطبین',
  ],
};
