import {
  ChartBar as FileBarChart2, ChartPie as PieChart,
  TrendingUp, Table, ListFilter as Filter, Download, RefreshCw,
} from 'lucide-react';
import type { GuideSection } from './types';

const BarChart2 = FileBarChart2;

export const ReportsSection: GuideSection = {
  id: 'reports',
  title: 'گزارشات',
  icon: FileBarChart2,
  color: 'rose',
  gradient: 'from-rose-500 to-red-600',
  overview: 'داشبورد تحلیلی — نمودارهای آماری جلسات، اقدامات و فعالیت‌های سازمانی با قابلیت خروجی Excel.',
  icons: [
    { icon: BarChart2, name: 'نمودار ستونی', desc: 'نمودار روند جلسات در ماه‌های گذشته', color: 'text-rose-600' },
    { icon: PieChart, name: 'نمودار دایره‌ای', desc: 'توزیع اولویت‌ها و وضعیت‌ها', color: 'text-purple-600' },
    { icon: TrendingUp, name: 'روند', desc: 'تحلیل روند رشد یا کاهش جلسات', color: 'text-green-600' },
    { icon: Table, name: 'جدول داده', desc: 'آخرین جلسات و اقدامات در قالب جدول', color: 'text-blue-600' },
    { icon: Filter, name: 'فیلتر زمانی', desc: 'فیلتر: ماه جاری، ۳ ماه، ۶ ماه، سال', color: 'text-teal-600' },
    { icon: Download, name: 'خروجی Excel', desc: 'صادر کردن گزارش به فایل xlsx', color: 'text-emerald-600' },
    { icon: RefreshCw, name: 'بارگذاری مجدد', desc: 'به‌روزرسانی داده‌های گزارش', color: 'text-slate-600' },
  ],
  steps: [
    {
      title: 'داشبورد گزارش',
      items: [
        'KPIها: تعداد کل جلسات، اقدامات و نرخ تکمیل',
        'نمودار ماهانه: روند جلسات ۶ ماه گذشته',
        'توزیع اولویت: درصد جلسات بالا، متوسط، پایین',
        'جدول آخرین جلسات برای بررسی سریع',
        'انتخاب بازه زمانی دلخواه',
      ],
    },
  ],
  tips: [
    'گزارش را به فرمت Excel دانلود کنید برای ارائه به مدیریت',
    'فیلتر سال جاری کامل‌ترین دیدگاه را می‌دهد',
  ],
  sparkQuestions: [
    'برو به صفحه گزارشات',
    'چند تا جلسه این ماه داشتم؟',
    'چند تا جلسه تا حالا گذاشتم؟',
  ],
};
