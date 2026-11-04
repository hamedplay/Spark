import { LayoutDashboard, ListTodo, CalendarDays, Clock3, Activity, Zap, Target, TrendingUp, UsersRound, ShieldCheck } from 'lucide-react';
import type { GuideSection } from './types';

export const ManagementDashboardSection: GuideSection = {
  id: 'management-dashboard',
  title: 'داشبورد مدیریتی',
  icon: LayoutDashboard,
  color: 'indigo',
  gradient: 'from-indigo-600 to-blue-700',
  overview: 'داشبورد عملکرد اقدامات، جلسات و مصوبات خود و افراد زیرمجموعه در چارت سازمانی؛ نمایش صفحه بر اساس مجوز «داشبورد مدیریتی» و مستقل از نقش ادمین کنترل می‌شود.',
  icons: [
    { icon: ListTodo, name: 'کل اقدامات', desc: 'فهرست همه اقدامات زیرمجموعه', color: 'text-blue-600' },
    { icon: CalendarDays, name: 'اقدامات امروز', desc: 'موارد دارای سررسید امروز', color: 'text-purple-600' },
    { icon: Activity, name: 'در حال انجام', desc: 'اقدامات در جریان', color: 'text-cyan-600' },
    { icon: Clock3, name: 'عقب‌مانده', desc: 'اقدامات گذشته از سررسید', color: 'text-rose-600' },
    { icon: Zap, name: 'فوری', desc: 'اقدامات باز با اولویت بالا', color: 'text-amber-600' },
    { icon: Target, name: 'مصوبات', desc: 'نمایش گزارش و جزئیات مصوبات', color: 'text-green-600' },
    { icon: UsersRound, name: 'عملکرد واحدها', desc: 'مقایسه پیشرفت مصوبات واحدهای سازمانی', color: 'text-indigo-600' },
    { icon: TrendingUp, name: 'روند اقدامات', desc: 'روند ماهانه و توزیع وضعیت اقدامات', color: 'text-teal-600' },
    { icon: ShieldCheck, name: 'محدوده سازمانی', desc: 'آمار بر اساس حوزه قابل مشاهده در چارت سازمانی', color: 'text-slate-600' },
  ],
  steps: [
    { title: 'ورود و بررسی شاخص‌ها', items: [
      'با مجوز مناسب از منوی اصلی وارد «داشبورد مدیریتی» شوید',
      'شاخص‌های کل، امروز، در حال انجام، تکمیل‌شده، عقب‌مانده و فوری را مرور کنید',
      'روی هر کارت شاخص بزنید تا فهرست اقدامات همان وضعیت در فضای کاری مدیریتی باز شود',
    ] },
    { title: 'پیگیری مصوبات و واحدها', items: [
      'در بخش مصوبات، وضعیت کلی را مشاهده کنید',
      'روی واحد موردنظر در «عملکرد واحدها» کلیک کنید تا گزارش مصوبات آن واحد باز شود',
      'از گزارش، مصوبه مدنظر را انتخاب کنید تا جزئیات آن نمایش یابد',
    ] },
    { title: 'هشدارها و تحلیل روند', items: [
      'در «هشدارهای مهلت»، موارد معوق و دارای سررسید تا ۱۰ روز آینده را بررسی کنید',
      'نمودار روند تکمیل و توزیع وضعیت اقدامات را برای تحلیل عملکرد بخوانید',
      'برای بررسی مستقیم اقدام فوری یا معوق، از فهرست «اقدامات مهم» وارد جزئیات شوید',
    ] },
  ],
  tips: [
    'ندیدن این صفحه می‌تواند ناشی از سطح دسترسی کاربر باشد',
    'آمار این داشبورد متعلق به محدوده سازمانی مجاز است و لزوماً معادل کل سازمان نیست',
    'تغییر وضعیت اقدام باید از مسیرهای عملیاتی مجاز انجام شود',
  ],
  sparkQuestions: [],
};
