import {
  Phone, Plus, CreditCard as Edit2, Trash2,
  Search, Download, Upload, Building2,
  Mail, Save, Share2, Users, CircleCheck as Check,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ContactsSection: GuideSection = {
  id: 'contacts',
  title: 'مخاطبین',
  icon: Phone,
  color: 'cyan',
  gradient: 'from-cyan-500 to-sky-600',
  overview: 'دفترچه تلفن و مخاطبین سازمانی — ثبت مخاطبین تک‌تک یا دسته‌جمعی، ایمپورت/اکسپورت CSV، جستجوی سریع، اشتراک‌گذاری با همکاران و تماس مستقیم از درون برنامه.',
  icons: [
    { icon: Plus, name: 'مخاطب جدید', desc: 'افزودن مخاطب تک‌نفره — نام، تلفن، سازمان، ایمیل', color: 'text-cyan-600' },
    { icon: Users, name: 'افزودن دسته‌جمعی', desc: 'ورود چند مخاطب به‌صورت همزمان در یک فرم', color: 'text-blue-600' },
    { icon: Upload, name: 'ایمپورت CSV', desc: 'وارد کردن مخاطبین از فایل CSV — با انتخاب ستون‌ها', color: 'text-orange-600' },
    { icon: Download, name: 'اکسپورت CSV', desc: 'صادر کردن کل لیست مخاطبین به فایل CSV', color: 'text-green-600' },
    { icon: Edit2, name: 'ویرایش', desc: 'تغییر اطلاعات مخاطب موجود — نیاز به مجوز', color: 'text-amber-600' },
    { icon: Save, name: 'ذخیره', desc: 'ذخیره تغییرات ویرایش مخاطب', color: 'text-green-600' },
    { icon: Trash2, name: 'حذف', desc: 'حذف مخاطب با تأیید — نیاز به مجوز', color: 'text-red-600' },
    { icon: Share2, name: 'اشتراک‌گذاری', desc: 'ارسال اطلاعات مخاطب به همکار', color: 'text-teal-600' },
    { icon: Search, name: 'جستجو', desc: 'جستجو بر اساس نام، تلفن، ایمیل یا شرکت', color: 'text-gray-600' },
    { icon: Phone, name: 'تماس مستقیم', desc: 'کلیک روی شماره — تماس tel: مستقیم از مرورگر', color: 'text-green-600' },
    { icon: Mail, name: 'ارسال ایمیل', desc: 'کلیک روی ایمیل — باز کردن کلاینت ایمیل', color: 'text-blue-600' },
    { icon: Building2, name: 'سازمان', desc: 'نام شرکت یا سازمان مخاطب', color: 'text-slate-600' },
    { icon: Check, name: 'تأیید عملیات', desc: 'تأیید ذخیره یا ایمپورت با علامت سبز', color: 'text-emerald-600' },
  ],
  steps: [
    {
      title: 'ثبت مخاطب',
      items: [
        'روی «مخاطب جدید» کلیک کنید',
        'نام، شماره تلفن، ایمیل و سازمان را وارد کنید',
        'روی «ذخیره» کلیک کنید',
        'برای ثبت دسته‌جمعی: «افزودن دسته‌جمعی» → چند ردیف پر کنید',
      ],
    },
    {
      title: 'ایمپورت و اکسپورت',
      items: [
        'اکسپورت: دکمه دانلود → فایل CSV با همه مخاطبین',
        'ایمپورت: دکمه آپلود → فایل CSV را انتخاب کنید',
        'در صفحه ایمپورت ستون‌های نام، تلفن، ایمیل و شرکت را تطبیق دهید',
        'تأیید کنید — مخاطبین به لیست افزوده می‌شوند',
      ],
    },
  ],
  tips: [
    'جستجو نام، شماره، ایمیل و نام شرکت را همزمان پوشش می‌دهد',
    'شماره تلفن و ایمیل مخاطبین قابل کلیک هستند',
    'اسپارک می‌تواند مخاطب جدید ثبت کند',
    'اشتراک‌گذاری اطلاعات مخاطب با همکار از منوی هر مخاطب امکان‌پذیر است',
  ],
  sparkQuestions: [
    'چند تا مخاطب دارم؟',
    'مخاطب اضافه کن به نام احمدی شماره ۰۹۱۲۱۲۳۴۵۶۷',
    'برو به صفحه مخاطبین',
  ],
};
