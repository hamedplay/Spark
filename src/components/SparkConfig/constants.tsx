import { Calendar, MessageSquare, ClipboardList, BookOpen, Users, ChartBar as BarChart2, User, Video, Bot } from 'lucide-react';

export const MODULE_META: Record<string, {
  label: string; icon: React.ElementType; color: string;
  desc: string; defaultPhrases: string[]; sampleCommand: string;
}> = {
  meetings: {
    label: 'درخواست جلسه', icon: Calendar, color: 'blue',
    desc: 'ثبت درخواست جلسه با موضوع، نماینده و شماره تماس',
    defaultPhrases: ['جلسه بزار', 'ثبت درخواست جلسه', 'درخواست جلسه', 'یک جلسه', 'میتینگ'],
    sampleCommand: 'یک جلسه بزار با موضوع بررسی قرارداد نماینده احمدی شماره 09121234567',
  },
  calendar: {
    label: 'تقویم', icon: Calendar, color: 'teal',
    desc: 'تغییر نمای تقویم (روزانه/هفتگی/لیستی) یا مشاهده جلسات امروز',
    defaultPhrases: ['تقویم', 'برو به تقویم', 'جلسات امروز', 'نمای تقویم'],
    sampleCommand: 'برو به تقویم روزانه',
  },
  chat: {
    label: 'پیام‌رسان', icon: MessageSquare, color: 'emerald',
    desc: 'ارسال پیام به کاربران سازمان با اولویت عادی، مهم یا اورژانسی',
    defaultPhrases: ['پیام بده', 'پیام بفرست', 'ارسال پیام', 'یک پیام', 'پیام بنویس'],
    sampleCommand: 'یک پیام بده به زهرا احمدی با موضوع پیگیری قرارداد با اهمیت مهم',
  },
  tasks: {
    label: 'وظایف', icon: ClipboardList, color: 'amber',
    desc: 'ایجاد وظیفه یا اقدام و انتساب آن به کاربر مشخص',
    defaultPhrases: ['اقدام ایجاد کن', 'وظیفه', 'تسک', 'یک اقدام', 'ایجاد اقدام'],
    sampleCommand: 'یک اقدام ایجاد کن با عنوان بررسی گزارش مالی برای علی رضایی',
  },
  notes: {
    label: 'یادداشت‌ها', icon: BookOpen, color: 'orange',
    desc: 'ثبت یادداشت با عنوان و محتوا',
    defaultPhrases: ['یادداشت ثبت کن', 'یادداشت بنویس', 'یادداشت جدید', 'یک یادداشت'],
    sampleCommand: 'یک یادداشت ثبت کن با عنوان بررسی پروژه با متن نکات مهم جلسه',
  },
  contacts: {
    label: 'مخاطبین', icon: Users, color: 'green',
    desc: 'افزودن مخاطب جدید با نام، شماره و شرکت',
    defaultPhrases: ['مخاطب جدید', 'ثبت مخاطب', 'شماره ذخیره کن', 'مخاطب اضافه کن'],
    sampleCommand: 'یک مخاطب جدید ثبت کن به نام حامد خالقی شماره 09123355033 شرکت رایان پارسی',
  },
  reports: {
    label: 'گزارشات', icon: BarChart2, color: 'red',
    desc: 'ناوبری به صفحه گزارشات',
    defaultPhrases: ['گزارش', 'برو به گزارش', 'نمایش گزارش'],
    sampleCommand: 'برو به صفحه گزارشات',
  },
  profile: {
    label: 'پروفایل', icon: User, color: 'gray',
    desc: 'ناوبری به صفحه پروفایل کاربر',
    defaultPhrases: ['پروفایل', 'برو به پروفایل'],
    sampleCommand: 'برو به پروفایل من',
  },
  'video-conference': {
    label: 'ویدیو کنفرانس', icon: Video, color: 'sky',
    desc: 'ناوبری به ویدیو کنفرانس یا برقراری تماس تصویری',
    defaultPhrases: ['ویدیو کنفرانس', 'تماس تصویری', 'ویدیوکال'],
    sampleCommand: 'تماس تصویری با زهرا احمدی',
  },
};

export const colorMap: Record<string, {
  bg: string; text: string; border: string; light: string;
  badgeBg: string; btnActive: string;
}> = {
  blue:    { bg: 'bg-blue-500',    text: 'text-blue-600 dark:text-blue-400',    border: 'border-blue-200 dark:border-blue-700',    light: 'bg-blue-50 dark:bg-blue-900/30',    badgeBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',    btnActive: 'bg-blue-600 hover:bg-blue-700' },
  teal:    { bg: 'bg-teal-500',    text: 'text-teal-600 dark:text-teal-400',    border: 'border-teal-200 dark:border-teal-700',    light: 'bg-teal-50 dark:bg-teal-900/30',    badgeBg: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',    btnActive: 'bg-teal-600 hover:bg-teal-700' },
  emerald: { bg: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-700', light: 'bg-emerald-50 dark:bg-emerald-900/30', badgeBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300', btnActive: 'bg-emerald-600 hover:bg-emerald-700' },
  amber:   { bg: 'bg-amber-500',   text: 'text-amber-600 dark:text-amber-400',   border: 'border-amber-200 dark:border-amber-700',   light: 'bg-amber-50 dark:bg-amber-900/30',   badgeBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',   btnActive: 'bg-amber-600 hover:bg-amber-700' },
  orange:  { bg: 'bg-orange-500',  text: 'text-orange-600 dark:text-orange-400',  border: 'border-orange-200 dark:border-orange-700',  light: 'bg-orange-50 dark:bg-orange-900/30',  badgeBg: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',  btnActive: 'bg-orange-600 hover:bg-orange-700' },
  green:   { bg: 'bg-green-500',   text: 'text-green-600 dark:text-green-400',   border: 'border-green-200 dark:border-green-700',   light: 'bg-green-50 dark:bg-green-900/30',   badgeBg: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',   btnActive: 'bg-green-600 hover:bg-green-700' },
  red:     { bg: 'bg-red-500',     text: 'text-red-600 dark:text-red-400',     border: 'border-red-200 dark:border-red-700',     light: 'bg-red-50 dark:bg-red-900/30',     badgeBg: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300',     btnActive: 'bg-red-600 hover:bg-red-700' },
  gray:    { bg: 'bg-gray-500',    text: 'text-gray-600 dark:text-gray-300',    border: 'border-gray-200 dark:border-gray-600',    light: 'bg-gray-50 dark:bg-gray-700/50',    badgeBg: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',    btnActive: 'bg-gray-600 hover:bg-gray-700' },
  sky:     { bg: 'bg-sky-500',     text: 'text-sky-600 dark:text-sky-400',     border: 'border-sky-200 dark:border-sky-700',     light: 'bg-sky-50 dark:bg-sky-900/30',     badgeBg: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',     btnActive: 'bg-sky-600 hover:bg-sky-700' },
};

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
