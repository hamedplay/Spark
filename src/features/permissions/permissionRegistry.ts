export interface PermissionItem {
  key: string;
  label: string;
  description: string;
  category: string;
  parentModule?: string;
  isSensitive: boolean;
}

export interface PermissionGroup {
  label: string;
  color: string;
  moduleKey?: string;
  items: PermissionItem[];
}

export const PERMISSION_REGISTRY: PermissionGroup[] = [
  {
    label: 'ماژول‌های اصلی',
    color: 'text-blue-500',
    items: [
      { key: 'management_dashboard', label: 'داشبورد مدیریتی', description: 'مشاهده نمای تجمیعی مدیریتی تسک‌ها، جلسات، مصوبات و عملکرد واحدها بدون اعطای دسترسی Admin', category: 'ماژول‌های اصلی', isSensitive: true },
      { key: 'meetings', label: 'جلسات و برنامه‌ریزی', description: 'دسترسی به بخش جلسات', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'calendar', label: 'تقویم', description: 'دسترسی به تقویم سازمانی', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'chat', label: 'چت سازمانی', description: 'دسترسی به چت', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'channels', label: 'کانال‌ها و گروه‌ها', description: 'دسترسی به کانال‌ها و گروه‌های سازمانی', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'video_conference', label: 'ویدیو کنفرانس', description: 'دسترسی به تماس تصویری', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'tasks', label: 'اقدامات و وظایف', description: 'دسترسی به وظایف', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'notes', label: 'یادداشت‌ها', description: 'دسترسی به یادداشت‌ها', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'contacts', label: 'مخاطبین', description: 'دسترسی به مخاطبین', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'reports', label: 'گزارشات تحلیلی', description: 'دسترسی به گزارشات', category: 'ماژول‌های اصلی', isSensitive: false },
      { key: 'admin_panel', label: 'پنل مدیریت', description: 'دسترسی به پیکربندی سیستم', category: 'ماژول‌های اصلی', isSensitive: true },
    ],
  },
  {
    label: 'مدیریت زیرمجموعه سازمانی',
    color: 'text-violet-600',
    items: [
      { key: 'management_decisions.view', label: 'مشاهده مصوبات زیرمجموعه', description: 'مشاهده فهرست، جزئیات و تاریخچه کامل مصوبات فقط در محدوده واحد سازمانی و زیرواحدهای مجاز', category: 'مدیریت زیرمجموعه سازمانی', isSensitive: true },
      { key: 'management_decisions.manage', label: 'مدیریت مصوبات زیرمجموعه', description: 'ثبت بروزرسانی مدیریتی وضعیت، پیشرفت و گزارش روی مصوبات داخل محدوده سازمانی مجاز؛ متن رسمی مصوبه تغییر نمی‌کند', category: 'مدیریت زیرمجموعه سازمانی', isSensitive: true },
      { key: 'management_tasks.view', label: 'مشاهده اقدامات زیرمجموعه', description: 'مشاهده فهرست، جزئیات، گردش کار، چک‌لیست و وابستگی اقدامات کاربران داخل محدوده سازمانی مجاز', category: 'مدیریت زیرمجموعه سازمانی', isSensitive: true },
      { key: 'management_tasks.manage', label: 'مدیریت اقدامات زیرمجموعه', description: 'مدیریت وضعیت، پیشرفت، اولویت، موعد و مسئول اقدام فقط در محدوده سازمانی مجاز', category: 'مدیریت زیرمجموعه سازمانی', isSensitive: true },
    ],
  },
  {
    label: 'صورت‌جلسات و مصوبات',
    color: 'text-teal-600',
    moduleKey: 'minutes_view',
    items: [
      { key: 'minutes_view', label: 'مشاهده صورت‌جلسات و مصوبات', description: 'مشاهده هاب، داشبورد، فهرست و جزئیات اسناد مجاز', category: 'صورت‌جلسات و مصوبات', isSensitive: false },
      { key: 'minutes_create', label: 'ایجاد صورت‌جلسه', description: 'ایجاد صورت‌جلسه برای جلسه‌ای که کاربر مجاز به ثبت آن است', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: false },
      { key: 'minutes_edit', label: 'ویرایش صورت‌جلسه', description: 'ویرایش پیش‌نویس یا سند قابل اصلاح در محدوده مجاز', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: false },
      { key: 'minutes_approve', label: 'تأیید و درخواست اصلاح', description: 'ورود به کارتابل و انجام اقدام روی revisionی که کاربر approver آن است', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: true },
      { key: 'minutes_publish', label: 'تأیید نهایی و انتشار', description: 'انتشار سند با حفظ نقش دبیر، رئیس و وضعیت صحیح', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: true },
      { key: 'minutes_reports', label: 'گزارش‌های صورت‌جلسات و مصوبات', description: 'مشاهده و خروجی گزارش‌ها فقط در محدوده رکوردهای مجاز', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: true },
      { key: 'minutes_config', label: 'پیکربندی قالب صورت‌جلسه', description: 'مدیریت تنظیمات section=minutes و لوگوی اختصاصی', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: true },
      { key: 'minutes_decisions.track', label: 'پیگیری مصوبات', description: 'پیگیری مصوبات در محدوده واحد یا مسئولیت مجاز', category: 'صورت‌جلسات و مصوبات', parentModule: 'minutes_view', isSensitive: false },
    ],
  },
  {
    label: 'جلسات — عملیات',
    color: 'text-cyan-600',
    moduleKey: 'meetings',
    items: [
      { key: 'meetings_create', label: 'ایجاد جلسه', description: 'اجازه ایجاد جلسه جدید', category: 'جلسات — عملیات', parentModule: 'meetings', isSensitive: false },
      { key: 'meetings_edit', label: 'ویرایش جلسه', description: 'اجازه ویرایش جلسات', category: 'جلسات — عملیات', parentModule: 'meetings', isSensitive: false },
      { key: 'meetings_delete', label: 'حذف جلسه', description: 'اجازه حذف جلسات', category: 'جلسات — عملیات', parentModule: 'meetings', isSensitive: true },
      { key: 'meetings_approve', label: 'تایید جلسه', description: 'اجازه تغییر وضعیت جلسه', category: 'جلسات — عملیات', parentModule: 'meetings', isSensitive: false },
    ],
  },
  {
    label: 'اقدامات — عملیات',
    color: 'text-green-600',
    moduleKey: 'tasks',
    items: [
      { key: 'tasks_create', label: 'ایجاد اقدام', description: 'اجازه ثبت اقدام جدید', category: 'اقدامات — عملیات', parentModule: 'tasks', isSensitive: false },
      { key: 'tasks_edit', label: 'ویرایش اقدام', description: 'اجازه ویرایش اقدامات', category: 'اقدامات — عملیات', parentModule: 'tasks', isSensitive: false },
      { key: 'tasks_delete', label: 'حذف اقدام', description: 'اجازه حذف اقدامات', category: 'اقدامات — عملیات', parentModule: 'tasks', isSensitive: true },
    ],
  },
  {
    label: 'یادداشت‌ها — عملیات',
    color: 'text-amber-600',
    moduleKey: 'notes',
    items: [
      { key: 'notes_create', label: 'ایجاد یادداشت', description: 'اجازه ثبت یادداشت جدید', category: 'یادداشت‌ها — عملیات', parentModule: 'notes', isSensitive: false },
      { key: 'notes_edit', label: 'ویرایش یادداشت', description: 'اجازه ویرایش یادداشت‌ها', category: 'یادداشت‌ها — عملیات', parentModule: 'notes', isSensitive: false },
      { key: 'notes_delete', label: 'حذف یادداشت', description: 'اجازه حذف یادداشت‌ها', category: 'یادداشت‌ها — عملیات', parentModule: 'notes', isSensitive: true },
    ],
  },
  {
    label: 'مخاطبین — عملیات',
    color: 'text-orange-600',
    moduleKey: 'contacts',
    items: [
      { key: 'contacts_create', label: 'ایجاد مخاطب', description: 'اجازه افزودن مخاطب', category: 'مخاطبین — عملیات', parentModule: 'contacts', isSensitive: false },
      { key: 'contacts_edit', label: 'ویرایش مخاطب', description: 'اجازه ویرایش مخاطبین', category: 'مخاطبین — عملیات', parentModule: 'contacts', isSensitive: false },
      { key: 'contacts_delete', label: 'حذف مخاطب', description: 'اجازه حذف مخاطبین', category: 'مخاطبین — عملیات', parentModule: 'contacts', isSensitive: true },
    ],
  },
  {
    label: 'تقویم — عملیات',
    color: 'text-teal-600',
    moduleKey: 'calendar',
    items: [
      { key: 'calendar_create_event', label: 'ایجاد رویداد', description: 'اجازه ایجاد رویداد در تقویم', category: 'تقویم — عملیات', parentModule: 'calendar', isSensitive: false },
      { key: 'calendar_edit_event', label: 'ویرایش رویداد', description: 'اجازه ویرایش رویدادها', category: 'تقویم — عملیات', parentModule: 'calendar', isSensitive: false },
      { key: 'calendar_delete_event', label: 'حذف رویداد', description: 'اجازه حذف رویدادها', category: 'تقویم — عملیات', parentModule: 'calendar', isSensitive: true },
      { key: 'calendar_hide_offhours', label: 'پنهان کردن ساعات غیرکاری', description: 'امکان پنهان/نمایش ساعات خارج از وقت کاری در تقویم', category: 'تقویم — عملیات', parentModule: 'calendar', isSensitive: false },
    ],
  },
  {
    label: 'چت — امکانات پیشرفته',
    color: 'text-rose-600',
    moduleKey: 'chat',
    items: [
      { key: 'chat_send_urgent', label: 'ارسال پیام اورژانسی', description: 'اجازه ارسال پیام نوع اورژانسی', category: 'چت — امکانات پیشرفته', parentModule: 'chat', isSensitive: true },
      { key: 'chat_send_confidential', label: 'ارسال پیام محرمانه', description: 'اجازه ارسال پیام محرمانه', category: 'چت — امکانات پیشرفته', parentModule: 'chat', isSensitive: true },
      { key: 'chat_delete_messages', label: 'حذف پیام‌ها', description: 'اجازه حذف پیام برای همه', category: 'چت — امکانات پیشرفته', parentModule: 'chat', isSensitive: true },
    ],
  },
  {
    label: 'کانال‌ها — عملیات',
    color: 'text-teal-600',
    moduleKey: 'channels',
    items: [
      { key: 'channels_create', label: 'ایجاد کانال', description: 'اجازه ایجاد کانال جدید', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: false },
      { key: 'channels_create_group', label: 'ایجاد گروه', description: 'اجازه ایجاد گروه جدید', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: false },
      { key: 'channels_pin_messages', label: 'پین کردن پیام', description: 'اجازه پین کردن پیام در کانال/گروه', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: false },
      { key: 'channels_delete_messages', label: 'حذف پیام', description: 'اجازه حذف پیام در کانال/گروه', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: true },
      { key: 'channels_manage_members', label: 'مدیریت اعضا', description: 'اجازه افزودن و حذف اعضای کانال/گروه', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: true },
      { key: 'channels_send_urgent', label: 'ارسال پیام اورژانسی', description: 'اجازه ارسال پیام اورژانسی در کانال', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: true },
      { key: 'channels_send_confidential', label: 'ارسال پیام محرمانه', description: 'اجازه ارسال پیام محرمانه در کانال', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: true },
      { key: 'channels_group_tasks', label: 'ایجاد اقدام گروهی', description: 'اجازه ایجاد اقدامات گروهی', category: 'کانال‌ها — عملیات', parentModule: 'channels', isSensitive: false },
    ],
  },
  {
    label: 'گزارشات — عملیات',
    color: 'text-gray-600',
    moduleKey: 'reports',
    items: [
      { key: 'reports_export', label: 'خروجی گزارش', description: 'اجازه دانلود و خروجی گرفتن', category: 'گزارشات — عملیات', parentModule: 'reports', isSensitive: false },
    ],
  },
  {
    label: 'پیکربندی سیستم — دسترسی',
    color: 'text-red-600',
    items: [
      { key: 'config_view', label: 'ورود به پیکربندی', description: 'مشاهده آیکون و ورود به پرتال پیکربندی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_platform', label: 'تنظیمات پلتفرم (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی؛ زیرصفحه‌ها به صورت مستقل کنترل می‌شوند', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_platform.general', label: 'پیکربندی / تنظیمات پلتفرم / تنظیمات کلی', description: 'دسترسی به تنظیمات کلی سامانه', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_platform.appearance', label: 'پیکربندی / تنظیمات پلتفرم / ظاهر و برندینگ', description: 'دسترسی به ظاهر، برندینگ و دارایی‌های پرتال', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_platform.regional', label: 'پیکربندی / تنظیمات پلتفرم / تنظیمات منطقه‌ای', description: 'دسترسی به تنظیمات منطقه‌ای و روزهای کاری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_platform.ui_settings', label: 'پیکربندی / تنظیمات پلتفرم / تنظیمات محیطی', description: 'دسترسی به تنظیمات رابط کاربری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_platform', isSensitive: true },
      { key: 'config_users', label: 'کاربران (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی؛ زیرصفحه‌ها به صورت مستقل کنترل می‌شوند', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_users.users_list', label: 'پیکربندی / کاربران / فهرست کاربران', description: 'مشاهده فهرست و اطلاعات مدیریتی کاربران', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.users_list.permissions', label: 'پیکربندی / کاربران / فهرست کاربران / حقوق دسترسی', description: 'مدیریت عضویت گروهی و حقوق دسترسی کاربران', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users.users_list', isSensitive: true },
      { key: 'config_users.users_online', label: 'پیکربندی / کاربران / کاربران آنلاین', description: 'مشاهده کاربران آنلاین', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.user_groups', label: 'پیکربندی / کاربران / گروه‌های کاربری', description: 'مشاهده گروه‌های کاربری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.user_groups.permissions', label: 'پیکربندی / کاربران / گروه‌های کاربری / حقوق دسترسی', description: 'ویرایش ماتریس حقوق دسترسی گروه‌های کاربری', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users.user_groups', isSensitive: true },
      { key: 'config_users.group_events', label: 'پیکربندی / کاربران / رخدادها', description: 'مشاهده رخدادهای گروه‌ها', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.org_structure', label: 'پیکربندی / کاربران / ساختار سازمانی', description: 'دسترسی به ساختار سازمانی', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users', isSensitive: true },
      { key: 'config_users.org_structure.permissions', label: 'پیکربندی / کاربران / ساختار سازمانی / سطح دسترسی', description: 'مدیریت دسترسی سطح سازمانی و سمت‌ها', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_users.org_structure', isSensitive: true },
      { key: 'config_access', label: 'حقوق دسترسی (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_access.security', label: 'پیکربندی / حقوق دسترسی / امنیت و دسترسی', description: 'دسترسی به تنظیمات امنیتی و احراز هویت', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_access', isSensitive: true },
      { key: 'config_access.server', label: 'پیکربندی / حقوق دسترسی / دسترسی سرور', description: 'دسترسی به تنظیمات سرور', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_access', isSensitive: true },
      { key: 'config_backup', label: 'پیکربندی / حقوق دسترسی / پشتیبان‌گیری', description: 'دسترسی به پشتیبان‌گیری و بازگردانی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_audit', label: 'رخدادها (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_audit.audit_log', label: 'پیکربندی / رویدادها / گزارش رخدادها', description: 'مشاهده گزارش رخدادهای مدیریتی و امنیتی', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_audit', isSensitive: true },
      { key: 'config_notifications', label: 'اعلان‌ها و پیامک (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_notifications.notifications', label: 'پیکربندی / اعلان‌ها و پیامک / اعلان‌ها', description: 'مدیریت قواعد، قالب‌ها و گزارش اعلان‌ها', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.sms', label: 'پیکربندی / اعلان‌ها و پیامک / پیامک', description: 'مدیریت ارائه‌دهنده، قالب و قواعد پیامک', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.social_notifications', label: 'پیکربندی / اعلان‌ها و پیامک / شبکه‌های اجتماعی', description: 'مدیریت کانال‌های اعلان اجتماعی', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.email', label: 'پیکربندی / اعلان‌ها و پیامک / پست الکترونیک', description: 'مدیریت تنظیمات پست الکترونیک', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_notifications.daily_report', label: 'پیکربندی / اعلان‌ها و پیامک / ارسال جلسات مدیریتی', description: 'مدیریت تنظیمات گزارش روزانه جلسات', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_notifications', isSensitive: true },
      { key: 'config_modules', label: 'مدیریت موجودیت‌ها (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_modules.video_conference', label: 'پیکربندی / مدیریت موجودیت‌ها / ویدیو کنفرانس', description: 'مدیریت تنظیمات ویدیو کنفرانس', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_modules.calendar', label: 'پیکربندی / مدیریت موجودیت‌ها / تقویم و مناسبت‌ها', description: 'مدیریت تنظیمات و مناسبت‌های تقویم', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_modules.minutes_config', label: 'پیکربندی / مدیریت موجودیت‌ها / صورت‌جلسات و مصوبات', description: 'مدیریت پیکربندی صورت‌جلسات و مصوبات', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_modules.monitoring', label: 'پیکربندی / مدیریت موجودیت‌ها / مانیتورینگ سیستم', description: 'دسترسی به مانیتورینگ سیستم', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_modules', isSensitive: true },
      { key: 'config_spark', label: 'دستیار اسپارک (قدیمی)', description: 'کلید سازگاری برای دسترسی‌های قبلی', category: 'پیکربندی سیستم — دسترسی', isSensitive: true },
      { key: 'config_spark.spark_config', label: 'پیکربندی / دستیار اسپارک / پیکربندی اسپارک', description: 'مدیریت تنظیمات دستیار اسپارک', category: 'پیکربندی سیستم — دسترسی', parentModule: 'config_spark', isSensitive: true },
    ],
  },
];

export const ALL_PERMISSION_ITEMS: PermissionItem[] = PERMISSION_REGISTRY.flatMap(g => g.items);

export const PERMISSION_LABELS: Record<string, string> = Object.fromEntries(
  ALL_PERMISSION_ITEMS.map(item => [item.key, item.label])
);

export function getPermissionLabel(key: string): string {
  return PERMISSION_LABELS[key] || key;
}

export function getPermissionItem(key: string): PermissionItem | undefined {
  return ALL_PERMISSION_ITEMS.find(item => item.key === key);
}

export const MINUTES_PERMISSION_KEYS = [
  'minutes_view',
  'minutes_create',
  'minutes_edit',
  'minutes_approve',
  'minutes_publish',
  'minutes_reports',
  'minutes_config',
  'minutes_decisions.track',
];

export const MINUTES_SUB_PERMISSIONS = [
  'minutes_create',
  'minutes_edit',
  'minutes_approve',
  'minutes_publish',
  'minutes_reports',
  'minutes_config',
  'minutes_decisions.track',
];

export const MINUTES_SENSITIVE_PERMISSIONS = [
  'minutes_approve',
  'minutes_publish',
  'minutes_reports',
  'minutes_config',
];