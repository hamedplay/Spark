import {
  MessageCircle, Send, Paperclip, Smile, Mic, Reply, Forward,
  Pin, Tag, Bell, CircleAlert as AlertCircle, PhoneCall, Video, Trash2,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ChatSection: GuideSection = {
  id: 'chat',
  title: 'چت سازمانی',
  icon: MessageCircle,
  color: 'green',
  gradient: 'from-green-500 to-emerald-700',
  overview: 'سیستم پیام‌رسانی داخلی سازمان با پشتیبانی از پیام‌های متنی، فایل، تصویر، تماس صوتی و تصویری.',
  icons: [
    { icon: Send, name: 'ارسال پیام', desc: 'ارسال متن پیام با Enter یا دکمه ارسال', color: 'text-green-600' },
    { icon: Paperclip, name: 'پیوست فایل', desc: 'ارسال فایل، تصویر، اسناد', color: 'text-blue-600' },
    { icon: Smile, name: 'ایموجی', desc: 'افزودن شکلک به پیام', color: 'text-yellow-600' },
    { icon: Mic, name: 'پیام صوتی', desc: 'ضبط و ارسال پیام صوتی', color: 'text-red-600' },
    { icon: Reply, name: 'پاسخ', desc: 'پاسخ به پیام خاص (رفرنس)', color: 'text-sky-600' },
    { icon: Forward, name: 'فوروارد', desc: 'ارسال پیام به مخاطب دیگر', color: 'text-teal-600' },
    { icon: Pin, name: 'پین کردن', desc: 'پین پیام مهم برای دسترسی سریع', color: 'text-amber-600' },
    { icon: Tag, name: 'برچسب', desc: 'افزودن تگ به پیام برای دسته‌بندی', color: 'text-purple-600' },
    { icon: Bell, name: 'یادآور', desc: 'تنظیم یادآور برای پیام مهم', color: 'text-orange-600' },
    { icon: AlertCircle, name: 'اورژانسی', desc: 'علامت‌گذاری پیام به عنوان فوری یا مهم', color: 'text-red-600' },
    { icon: PhoneCall, name: 'تماس صوتی', desc: 'شروع تماس صوتی مستقیم', color: 'text-green-600' },
    { icon: Video, name: 'تماس تصویری', desc: 'شروع ویدیو کال با کاربر', color: 'text-blue-600' },
    { icon: Trash2, name: 'حذف پیام', desc: 'حذف پیام (فقط برای خودتان یا برای همه)', color: 'text-red-500' },
  ],
  steps: [
    {
      title: 'شروع مکالمه',
      items: [
        'سایدبار چپ → گفتگوی جدید (آیکن +)',
        'نام کاربر مورد نظر را جستجو کنید',
        'روی نام کلیک کنید — مکالمه باز می‌شود',
        'تایپ کنید و Enter بزنید یا روی آیکن ارسال کلیک کنید',
      ],
    },
    {
      title: 'مدیریت پیام‌ها',
      items: [
        'هولد / راست‌کلیک روی پیام: منوی عملیات باز می‌شود',
        'ریکشن با ایموجی: کلیک روی 🙂 در منوی پیام',
        'وضعیت: ✓ ارسال شده، ✓✓ تحویل داده شده، ✓✓ (آبی) خوانده شده',
        'فایل‌ها و تصاویر در پنل اطلاعات مکالمه موجودند',
      ],
    },
  ],
  tips: [
    'پیام‌های اورژانسی با رنگ قرمز و پیام‌های مهم با رنگ نارنجی نمایش داده می‌شوند',
    'اسپارک می‌تواند برای شما پیام ارسال کند',
    'گفتگوهای حذف‌شده فقط برای شما پاک می‌شوند',
  ],
  sparkQuestions: [
    'پیام بده به زهرا با موضوع پیگیری پروژه',
    'تماس صوتی با علی بگیر',
    'برو به صفحه چت',
  ],
};
