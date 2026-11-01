export interface CenterEvent {
  event_key: string;
  id: string;
  created_at: string;
  source: 'application' | 'security';
  event_type: string;
  category: string;
  severity: string;
  result: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  ip_address: string | null;
  ip_hash: string | null;
  session_id: string | null;
  request_id: string | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
}
export interface EventCursor { time: string; key: string }
export interface EventPage { events: CenterEvent[]; has_more: boolean; next_cursor: EventCursor | null }
export const severityLabels: Record<string, string> = { info: 'اطلاع', success: 'موفق', warning: 'هشدار', error: 'خطا', critical: 'بحرانی' };
export const resultLabels: Record<string, string> = { success: 'انجام شد', failure: 'ناموفق', error: 'خطا', denied: 'دسترسی رد شد' };
export function isAttentionEvent(event: Pick<CenterEvent, 'severity' | 'result'>) {
  return ['warning', 'error', 'critical'].includes(event.severity) || ['denied', 'failure', 'error'].includes(event.result ?? '');
}
export function changedFields(event: Pick<CenterEvent, 'before_state' | 'after_state'>) {
  const before = event.before_state ?? {};
  const after = event.after_state ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, before: before[key] ?? null, after: after[key] ?? null }));
}
export function exportEvents(events: CenterEvent[]) {
  // JSON avoids spreadsheet formula execution and preserves structured evidence.
  return JSON.stringify({ exported_at: new Date().toISOString(), scope: 'displayed_events', events }, null, 2);
}
const eventTitles: Record<string, string> = {
  'access.denied': 'تلاش برای دسترسی بدون مجوز',
  'profiles.insert': 'ایجاد حساب و وضعیت دسترسی اولیه',
  'profiles.update': 'تغییر وضعیت امنیتی یا دسترسی حساب',
  'profiles.delete': 'حذف پروفایل کاربر',
  'user_groups.insert': 'ایجاد گروه کاربری',
  'user_groups.update': 'تغییر مشخصات یا مجوزهای گروه',
  'user_groups.delete': 'حذف گروه کاربری',
  'user_group_members.insert': 'افزودن کاربر به گروه',
  'user_group_members.update': 'تغییر عضویت کاربر در گروه',
  'user_group_members.delete': 'حذف کاربر از گروه',
  security_settings_changed: 'تغییر تنظیمات امنیتی',
  user_group_permissions_updated: 'تغییر مجوزهای گروه',
  account_unlocked_by_security_admin: 'بازکردن قفل حساب توسط مدیر امنیت',
  mfa_method_disabled: 'غیرفعال‌کردن روش احراز هویت دومرحله‌ای',
  mfa_method_selected: 'انتخاب روش احراز هویت دومرحله‌ای',
  mfa_stepup_grant_issued: 'تأیید احراز هویت برای عملیات حساس',
  admin_user_delete_requested: 'درخواست حذف کاربر توسط مدیر',
  admin_user_deleted: 'حذف کاربر توسط مدیر',
  maintenance_mode_changed: 'تغییر حالت تعمیرات سایت',
  registration_otp_invalid: 'کد تأیید ثبت‌نام نامعتبر',
  registration_completed: 'تکمیل ثبت‌نام',
  password_recovery_otp_requested: 'درخواست کد بازیابی رمز عبور',
  recovery_finalization_succeeded: 'تکمیل بازیابی حساب',
};
export const eventTitle = (type: string) => eventTitles[type] ?? type;
