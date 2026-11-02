import type { CenterEvent } from './eventCenterModel';

const eventTitles: Record<string, string> = {
  login: 'ورود به سامانه', logout: 'خروج از سامانه',
  'auth.login': 'ورود کاربر (احراز هویت)', 'auth.logout': 'خروج کاربر (احراز هویت)',
  'auth.user_signedup': 'ثبت‌نام حساب کاربری', 'auth.user_deleted': 'حذف حساب کاربری',
  'auth.user_modified': 'ویرایش حساب کاربری', 'auth.user_updated_password': 'تغییر رمز عبور',
  'auth.user_invited': 'ارسال دعوت ایجاد حساب', 'auth.invite_accepted': 'پذیرش دعوت ایجاد حساب',
  'auth.user_recovery_requested': 'درخواست بازیابی حساب',
  'auth.user_reauthenticate_requested': 'درخواست احراز هویت دوباره',
  'auth.user_confirmation_requested': 'درخواست تأیید ایمیل یا تلفن',
  'auth.user_repeated_signup': 'تلاش برای ثبت‌نام تکراری',
  'auth.generate_recovery_codes': 'ایجاد کدهای بازیابی احراز هویت',
  'auth.factor_in_progress': 'شروع فعال‌سازی عامل دومرحله‌ای',
  'auth.factor_unenrolled': 'لغو فعال‌سازی عامل دومرحله‌ای',
  'auth.factor_deleted': 'حذف عامل دومرحله‌ای', 'auth.factor_updated': 'ویرایش عامل دومرحله‌ای',
  'auth.challenge_created': 'ایجاد درخواست تأیید دومرحله‌ای',
  'auth.verification_attempted': 'تلاش برای تأیید احراز هویت',
  'auth.recovery_codes_deleted': 'حذف کدهای بازیابی', 'auth.mfa_code_login': 'ورود با کد دومرحله‌ای',
  'auth.identity_unlinked': 'قطع اتصال روش شناسایی حساب',
  remove_from_personal_calendar: 'حذف جلسه از تقویم شخصی',
  INFORMEE_ADD_PARTICIPANT: 'افزودن شرکت‌کننده توسط مطلع جلسه',
  meeting_created: 'ایجاد جلسه', meeting_updated: 'ویرایش جلسه', meeting_deleted: 'حذف جلسه',
  meeting_cancelled: 'لغو جلسه', meeting_scheduled: 'زمان‌بندی جلسه',
  task_created: 'ایجاد اقدام', task_updated: 'ویرایش اقدام', task_deleted: 'حذف اقدام',
  task_pending: 'در انتظار انجام اقدام', task_completed: 'تکمیل اقدام', task_action_added: 'ثبت پیگیری اقدام',
  status_changed: 'تغییر وضعیت حضور کاربر', password_changed: 'تغییر رمز عبور',
  config_updated: 'تغییر پیکربندی سامانه', minutes_logo_uploaded: 'بارگذاری لوگوی صورت‌جلسات',
  minutes_logo_deleted: 'حذف لوگوی صورت‌جلسات', spark_enabled: 'فعال‌سازی دستیار اسپارک', spark_disabled: 'غیرفعال‌سازی دستیار اسپارک',
  'access.denied': 'تلاش برای دسترسی بدون مجوز',
  'profiles.insert': 'ایجاد حساب و وضعیت دسترسی اولیه', 'profiles.update': 'تغییر وضعیت امنیتی یا دسترسی حساب',
  'profiles.delete': 'حذف پروفایل کاربر', 'user_groups.insert': 'ایجاد گروه کاربری',
  'user_groups.update': 'تغییر مشخصات یا مجوزهای گروه', 'user_groups.delete': 'حذف گروه کاربری',
  'user_group_members.insert': 'افزودن کاربر به گروه', 'user_group_members.update': 'تغییر عضویت کاربر در گروه',
  'user_group_members.delete': 'حذف کاربر از گروه', security_settings_changed: 'تغییر تنظیمات امنیتی',
  user_group_permissions_updated: 'تغییر مجوزهای گروه', account_unlocked_by_security_admin: 'بازکردن قفل حساب توسط مدیر امنیت',
  mfa_method_disabled: 'غیرفعال‌کردن روش احراز هویت دومرحله‌ای', mfa_method_selected: 'انتخاب روش احراز هویت دومرحله‌ای',
  mfa_stepup_grant_issued: 'تأیید احراز هویت برای عملیات حساس', admin_user_delete_requested: 'درخواست حذف کاربر توسط مدیر',
  admin_user_deleted: 'حذف کاربر توسط مدیر', maintenance_mode_changed: 'تغییر حالت تعمیرات سایت',
  registration_otp_invalid: 'کد تأیید ثبت‌نام نامعتبر', registration_completed: 'تکمیل ثبت‌نام',
  password_recovery_otp_requested: 'درخواست کد بازیابی رمز عبور', recovery_finalization_succeeded: 'تکمیل بازیابی حساب',
  phone_identity_dry_run_requested: 'درخواست بررسی آزمایشی سازگاری شماره‌های کاربران',
  phone_identity_execute_requested: 'درخواست اصلاح سازگاری شماره‌های کاربران',
  orphan_auth_user_deleted: 'حذف حساب احراز هویت بدون پروفایل',
  registration_otp_requested: 'درخواست کد تأیید ثبت‌نام',
};
const categories: Record<string, string> = {
  auth: 'ورود، خروج و احراز هویت', access: 'دسترسی و مجوزها', mfa: 'احراز هویت دومرحله‌ای',
  recovery: 'بازیابی حساب', account_lock: 'قفل حساب', session: 'نشست‌ها', settings_change: 'تغییر تنظیمات امنیتی',
  meetings: 'جلسات', calendar: 'تقویم', tasks: 'اقدامات', system_config: 'پیکربندی سامانه',
  profile: 'پروفایل کاربر', users: 'کاربران', spark: 'دستیار اسپارک', application: 'فعالیت برنامه',
};
const fields: Record<string, string> = {
  source: 'منبع ثبت', details: 'شرح رخداد', entity_name: 'نام موجودیت', entity_id: 'شناسهٔ موجودیت',
  url: 'آدرس صفحه', referrer: 'صفحهٔ ارجاع‌دهنده', user_agent: 'مرورگر و سیستم‌عامل',
  meeting_id: 'شناسهٔ جلسه', added_by_name: 'نام فرد افزودن‌کننده', added_by_user_id: 'شناسهٔ فرد افزودن‌کننده',
  added_participant_name: 'نام شرکت‌کنندهٔ افزوده‌شده', added_participant_user_id: 'شناسهٔ شرکت‌کنندهٔ افزوده‌شده',
  mode: 'نوع اجرا', provider_id: 'شناسهٔ سرویس‌دهنده', provider_pack_id: 'شناسهٔ بستهٔ سرویس‌دهنده',
  provider_message_ids: 'شناسه‌های پیام سرویس‌دهنده', recovery_route: 'مسیر بازیابی حساب',
  claim_id: 'شناسهٔ پردازش', new_epoch: 'نسخهٔ جدید اعتبار نشست‌ها', challenge_id: 'شناسهٔ درخواست تأیید',
  attempt_count: 'تعداد تلاش‌های ثبت‌شده', last_seen_at: 'زمان آخرین تلاش', resource: 'مسیر درخواست',
  table: 'موجودیت ثبت‌شده', actor_context: 'نوع عامل', auth_action: 'عملیات احراز هویت',
  auth_provider: 'ارائه‌دهندهٔ احراز هویت', verification_scope: 'دامنهٔ تأیید',
  is_admin: 'دسترسی مدیر سامانه', is_security_admin: 'دسترسی مدیر امنیت', is_active: 'فعال‌بودن حساب',
  account_status: 'وضعیت حساب', can_broadcast: 'مجوز ارسال همگانی', is_hidden: 'پنهان‌بودن کاربر',
  mfa_enrollment_required: 'الزام فعال‌سازی دومرحله‌ای', mfa_method: 'روش دومرحله‌ای', locked_until: 'قفل تا زمان',
  name: 'نام', display_name: 'نام نمایشی', is_system: 'سیستمی‌بودن گروه', is_public: 'عمومی‌بودن گروه',
  permissions: 'مجوزها', group_id: 'شناسهٔ گروه', user_id: 'شناسهٔ کاربر', added_by: 'افزوده‌شده توسط',
};
const values: Record<string, Record<string, string>> = {
  source: { notify_user: 'مطلع جلسه', database_trigger: 'ثبت خودکار دیتابیس', edge_authorization: 'کنترل دسترسی سرور', auth_service: 'سرویس احراز هویت' },
  recovery_route: { unified: 'بازیابی یکپارچهٔ حساب' },
  mfa_method: { totp: 'رمز یک‌بارمصرف نرم‌افزاری', sms: 'پیامک', none: 'بدون روش دومرحله‌ای' },
  mode: { dry_run: 'بررسی آزمایشی (بدون تغییر داده)', execute: 'اجرای تغییرات' },
  entity_name: { meeting_participant: 'شرکت‌کنندهٔ جلسه' },
  actor_context: { service_or_database: 'سرویس یا عملیات دیتابیس', user_session: 'نشست کاربر' },
  table: { profiles: 'پروفایل کاربران', user_groups: 'گروه‌های کاربری', user_group_members: 'عضویت کاربران در گروه‌ها' },
  verification_scope: { identity_service: 'احراز هویت در سرویس ورود؛ بدون تأیید دسترسی کامل Spark' },
  auth_provider: { email: 'ایمیل', phone: 'تلفن', google: 'گوگل', apple: 'اپل', azure: 'مایکروسافت', saml: 'ورود یکپارچه' },
  account_status: { ACTIVE: 'فعال', RETIRED: 'بازنشسته', DISABLED: 'غیرفعال', PENDING: 'در انتظار تأیید' },
  resource: { 'admin-users': 'مدیریت کاربران', 'admin-delete-user': 'حذف کاربر', 'admin-retire-user': 'بازنشستگی کاربر', 'backup-data': 'تهیهٔ پشتیبان', 'restore-backup': 'بازیابی پشتیبان' },
};
function translated(map: Record<string, string>, key: string): string {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : key;
}
export const eventTitle = (type: string) => translated(eventTitles, type);
export const categoryTitle = (category: string) => translated(categories, category);
export const fieldTitle = (field: string) => translated(fields, field);
export const eventSourceTitle = (event: Pick<CenterEvent, 'source' | 'metadata'>) =>
  event.source === 'application' ? 'گزارش فعالیت برنامه' : event.metadata?.source === 'auth_service' ? 'سرویس احراز هویت' : 'امنیتی / سرور';
export function eventResultTitle(event: Pick<CenterEvent, 'source' | 'metadata' | 'result'>): string {
  if (event.result === 'success' && event.source === 'security' && event.metadata?.source === 'auth_service') return 'موفق در سرویس احراز هویت';
  return translated({ success: 'انجام شد', failure: 'ناموفق', error: 'خطا', denied: 'دسترسی رد شد' }, event.result ?? '') || 'نتیجه در منبع ثبت نشده';
}
export function formatEventValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return 'ثبت نشده';
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('fa-IR') : String(value);
  if (typeof value === 'string') {
    if (key === 'auth_action') return eventTitle(`auth.${value}`);
    const dictionary = Object.prototype.hasOwnProperty.call(values, key) ? values[key] : undefined;
    if (dictionary) return translated(dictionary, value);
    if (key === 'details' && value === 'Meeting removed from the current user personal calendar only') return 'جلسه فقط از تقویم شخصی کاربر حذف شده است.';
    if (['last_seen_at', 'locked_until'].includes(key) && !Number.isNaN(Date.parse(value))) return new Date(value).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran' });
    return value;
  }
  if (Array.isArray(value)) return value.map(item => formatEventValue(key, item)).join('، ');
  return JSON.stringify(value, null, 2);
}
function detailObject(metadata: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof metadata.details !== 'string' || metadata.details.length > 20000) return null;
  try {
    const value = JSON.parse(metadata.details);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
export function metadataRows(event: Pick<CenterEvent, 'metadata'>): Array<{ key: string; label: string; value: string }> {
  const metadata = event.metadata ?? {};
  const rows: Array<{ key: string; label: string; value: string }> = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || value === undefined || value === '') continue;
    const details = key === 'details' ? detailObject(metadata) : null;
    if (details) {
      for (const [detailKey, detailValue] of Object.entries(details)) {
        rows.push({ key: `details.${detailKey}`, label: fieldTitle(detailKey), value: formatEventValue(detailKey, detailValue) });
      }
    } else rows.push({ key, label: fieldTitle(key), value: formatEventValue(key, value) });
  }
  return rows;
}
export function eventSummary(event: Pick<CenterEvent, 'event_type' | 'metadata'>): string {
  const details = detailObject(event.metadata ?? {});
  if (event.event_type === 'INFORMEE_ADD_PARTICIPANT' && details && typeof details.added_by_name === 'string' && typeof details.added_participant_name === 'string') {
    return `${details.added_by_name}، ${details.added_participant_name} را به شرکت‌کنندگان جلسه افزود.`;
  }
  const text = event.metadata?.details;
  return typeof text === 'string' && !details ? formatEventValue('details', text) : '';
}
