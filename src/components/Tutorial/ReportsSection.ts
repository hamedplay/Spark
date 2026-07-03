import {
  ChartBar as BarChart3, ChartPie as PieChart,
  TrendingUp, TrendingDown, Download, RefreshCw,
  Calendar, Clock, Users, CircleCheck as CheckCircle2,
  CircleAlert as AlertTriangle, Target, Activity,
  MapPin, UserCheck, Timer, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import type { GuideSection } from './types';

export const ReportsSection: GuideSection = {
  id: 'reports',
  title: 'گزارشات',
  icon: BarChart3,
  color: 'rose',
  gradient: 'from-rose-500 to-red-600',
  overview: 'داشبورد تحلیلی سازمانی — KPIهای کلیدی، نمودار ستونی ماهانه، توزیع دایره‌ای اولویت‌ها، نرخ تأیید و خروجی Excel با انتخاب ستون‌های دلخواه.',
  icons: [
    { icon: BarChart3, name: 'نمودار ستونی', desc: 'روند ماهانه جلسات و وظایف — قابل انتخاب بازه زمانی', color: 'text-rose-600' },
    { icon: PieChart, name: 'نمودار دایره‌ای', desc: 'توزیع اولویت‌های جلسات: بالا، متوسط، پایین', color: 'text-purple-600' },
    { icon: TrendingUp, name: 'روند صعودی', desc: 'شاخص رشد نسبت به دوره قبل — فلش سبز', color: 'text-green-600' },
    { icon: TrendingDown, name: 'روند نزولی', desc: 'شاخص کاهش نسبت به دوره قبل — فلش قرمز', color: 'text-red-600' },
    { icon: Target, name: 'نرخ تأیید', desc: 'درصد جلسات تأیید‌شده از کل — نمودار دایره‌ای پیشرفت', color: 'text-blue-600' },
    { icon: Activity, name: 'نرخ تکمیل', desc: 'درصد وظایف تکمیل‌شده از کل اقدامات', color: 'text-teal-600' },
    { icon: Calendar, name: 'فیلتر زمانی', desc: 'بازه: ۱ ماه / ۳ ماه / ۶ ماه / ۱۲ ماه', color: 'text-teal-600' },
    { icon: RefreshCw, name: 'بارگذاری مجدد', desc: 'به‌روزرسانی آمار — بعد از تغییر بازه زمانی', color: 'text-slate-600' },
    { icon: Download, name: 'خروجی Excel', desc: 'صادر کردن گزارش به xlsx با ستون‌های قابل انتخاب', color: 'text-emerald-600' },
    { icon: Clock, name: 'جلسات باز', desc: 'KPI تعداد جلسات در جریان — با زمان انتظار', color: 'text-yellow-600' },
    { icon: CheckCircle2, name: 'جلسات تکمیل', desc: 'KPI جلسات برگزارشده و بسته‌شده', color: 'text-green-600' },
    { icon: AlertTriangle, name: 'در انتظار تأیید', desc: 'KPI جلساتی که هنوز تأیید ادمین ندارند', color: 'text-red-600' },
    { icon: Users, name: 'مشارکت', desc: 'آمار شرکت‌کنندگان و نرخ قبول/رد', color: 'text-blue-600' },
    { icon: UserCheck, name: 'تأیید ادمین', desc: 'نرخ تأیید/رد جلسات توسط ادمین', color: 'text-indigo-600' },
    { icon: MapPin, name: 'مکان‌های جلسه', desc: 'بیشترین محل‌های برگزاری در بازه انتخاب‌شده', color: 'text-rose-600' },
    { icon: Timer, name: 'میانگین مدت', desc: 'میانگین مدت زمان جلسات در بازه انتخابی', color: 'text-amber-600' },
    { icon: ArrowUpRight, name: 'روند مثبت', desc: 'افزایش نسبت به دوره مقایسه‌شده', color: 'text-green-500' },
    { icon: ArrowDownRight, name: 'روند منفی', desc: 'کاهش نسبت به دوره مقایسه‌شده', color: 'text-red-500' },
  ],
  steps: [
    {
      title: 'داشبورد گزارش',
      items: [
        'KPIهای بالا: کل جلسات، باز، تکمیل و در انتظار تأیید',
        'هر KPI شاخص روند (فلش سبز/قرمز) نسبت به دوره قبل نشان می‌دهد',
        'نمودار ستونی: روند ماهانه جلسات و وظایف',
        'نمودار دایره‌ای: توزیع اولویت‌های جلسات',
        'نرخ تأیید: درصد در نمودار دایره‌ای پیشرفت',
      ],
    },
    {
      title: 'فیلتر و خروجی',
      items: [
        'بازه زمانی را از دکمه‌های بالا انتخاب کنید: ۱/۳/۶/۱۲ ماه',
        'روی «بارگذاری مجدد» کلیک کنید تا آمار به‌روز شود',
        'دکمه «خروجی Excel» برای دانلود گزارش',
        'در پنجره Excel ستون‌های مورد نیاز را تیک بزنید',
        'فایل xlsx با تاریخ شمسی و فرمت فارسی دانلود می‌شود',
      ],
    },
  ],
  tips: [
    'بازه ۱۲ ماه دید کلی سالانه می‌دهد — مناسب برای گزارش به مدیریت',
    'فلش‌های روند نسبت به دوره مشابه قبلی محاسبه می‌شوند',
    'خروجی Excel شامل تمام فیلدهای جلسات با تاریخ‌های شمسی است',
    'نمودار دایره‌ای توزیع اولویت‌ها — اگر بیشتر «بالا» است نیاز به بازنگری دارید',
  ],
  sparkQuestions: [
    'برو به صفحه گزارشات',
    'چند تا جلسه این ماه داشتم؟',
    'چند تا جلسه تا حالا گذاشتم؟',
  ],
};
