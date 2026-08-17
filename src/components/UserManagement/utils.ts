import moment from 'moment-jalaali';
import { Pencil, KeyRound, UserX, UserCheck, ShieldCheck, Crown, Phone, Link2, Activity, History, MapPin } from 'lucide-react';
import type { AdminProfile, Panel } from './types';

export const JALALI_MONTHS_ADMIN = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

export function getJMDays(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return moment.jIsLeapYear(jy) ? 30 : 29;
}

export function isoToJ(iso: string | null | undefined) {
  if (!iso) return { jy: 0, jm: 0, jd: 0 };
  try {
    const m = moment(iso, 'YYYY-MM-DD');
    if (!m.isValid()) return { jy: 0, jm: 0, jd: 0 };
    return { jy: m.jYear(), jm: m.jMonth() + 1, jd: m.jDate() };
  } catch {
    return { jy: 0, jm: 0, jd: 0 };
  }
}

export function jToIso(jy: number, jm: number, jd: number): string {
  if (!jy || !jm || !jd) return '';
  try {
    const d = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD');
    return d.isValid() ? d.format('YYYY-MM-DD') : '';
  } catch { return ''; }
}

export const inp = 'w-full min-w-0 pr-10 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm';
export const inpDis = inp + ' bg-gray-50 dark:bg-gray-600 text-gray-500 cursor-not-allowed';

// Only editable profile fields belong in the bulk-import/export template.
// Protected role/lifecycle fields are intentionally managed through dedicated admin flows.
export const EXCEL_COLUMNS = [
  { key: 'full_name',    label: 'نام و نام خانوادگی' },
  { key: 'email',        label: 'ایمیل' },
  { key: 'username',     label: 'نام کاربری' },
  { key: 'phone',        label: 'شماره موبایل' },
  { key: 'national_id',  label: 'کد ملی' },
  { key: 'employee_id',  label: 'کد پرسنلی' },
  { key: 'gender',       label: 'جنسیت (male/female)' },
  { key: 'birth_date',   label: 'تاریخ تولد' },
  { key: 'city',         label: 'شهر' },
  { key: 'organization', label: 'سازمان' },
  { key: 'position',     label: 'سمت' },
  { key: 'department',   label: 'واحد' },
  { key: 'hire_date',    label: 'تاریخ استخدام' },
  { key: 'location',     label: 'موقعیت مکانی' },
  { key: 'bio',          label: 'درباره کاربر' },
];

export const emptyNew: AdminProfile = {
  user_id: '', full_name: '', email: '', username: '', phone: '', organization: '', position: '',
  department: '', employee_id: '', hire_date: '', birth_date: '', gender: '', city: '',
  location: '', bio: '', national_id: '', avatar_url: '',
  is_admin: false, is_security_admin: false, security_role_version: 1,
  is_active: true, is_hidden: false, created_at: null,
};

export function menuItems(p: AdminProfile) {
  return [
    { icon: Pencil, label: 'ویرایش اطلاعات', panel: 'edit' as Panel, color: 'text-blue-500' },
    { icon: Crown, label: 'مدیریت سطح دسترسی', panel: 'roles' as Panel, color: 'text-purple-500' },
    { icon: KeyRound, label: 'تغییر رمز عبور', panel: 'password' as Panel, color: 'text-amber-500' },
    { icon: p.is_active !== false ? UserX : UserCheck, label: p.is_active !== false ? 'غیرفعال کردن' : 'فعال کردن', panel: 'deactivate' as Panel, color: p.is_active !== false ? 'text-red-500' : 'text-green-500' },
    { icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-teal-500' },
    { icon: Phone, label: 'همگام‌سازی شماره', panel: 'phonesync' as Panel, color: 'text-teal-500' },
    { icon: Link2, label: 'ارتباطات دستی', panel: 'relations' as Panel, color: 'text-blue-500' },
    { icon: Activity, label: 'فعالیت‌های کاربر', panel: 'activity' as Panel, color: 'text-blue-500' },
    { icon: History, label: 'تاریخچه ورودها', panel: 'logins' as Panel, color: 'text-gray-500' },
    { icon: MapPin, label: 'آدرس‌های مراجعه شده', panel: 'urls' as Panel, color: 'text-orange-500' },
  ];
}
