const EVENT_TYPE_LABELS: Record<string, string> = {
  security_admin_role_changed: 'تغییر نقش مدیر امنیت',
  mfa_stepup_grant_issued: 'صدور تأیید دومرحله‌ای',
  security_admin_role_stepup_required: 'نیاز به تأیید دومرحله‌ای',
  auth_settings_change: 'تغییر تنظیمات احراز هویت',
};

const ERROR_CODE_LABELS: Record<string, string> = {
  UNAUTHORIZED: 'احراز هویت نشده',
  SESSION_REQUIRED: 'نشست مورد نیاز',
  SESSION_INVALID: 'نشست نامعتبر',
  SESSION_EXPIRED: 'نشست منقضی',
  SECURITY_ADMIN_REQUIRED: 'نیاز به مدیر امنیت',
  FORBIDDEN: 'ممنوع',
  TARGET_REQUIRED: 'هدف مورد نیاز',
  TARGET_NOT_FOUND: 'هدف یافت نشد',
  TARGET_NOT_ELIGIBLE: 'هدف واجد شرایط نیست',
  TARGET_TOTP_REQUIRED: 'هدف فاقد TOTP',
  CANNOT_CHANGE_OWN_SECURITY_ADMIN: 'تغییر نقش خود ممنوع',
  CANNOT_REMOVE_LAST_SECURITY_ADMIN: 'حذف آخرین مدیر ممنوع',
  VERSION_CONFLICT: 'تعارض نسخه',
  NO_EFFECTIVE_CHANGE: 'بدون تغییر موثر',
  STEPUP_REQUIRED: 'نیاز به تأیید دومرحله‌ای',
};

const CATEGORY_LABELS: Record<string, string> = {
  auth: 'احراز هویت',
  mfa: 'احراز دومرحله‌ای',
  recovery: 'بازیابی',
  session: 'نشست',
  access: 'دسترسی',
  account_lock: 'قفل حساب',
  settings_change: 'تغییر تنظیمات',
};

const SEVERITY_LABELS: Record<string, string> = {
  info: 'اطلاع',
  warning: 'هشدار',
  error: 'خطا',
  critical: 'بحرانی',
};

const RESULT_LABELS: Record<string, string> = {
  success: 'موفق',
  failure: 'ناموفق',
  denied: 'رد شد',
  error: 'خطا',
};

export function labelEventType(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? `کد ناشناخته: ${eventType}`;
}

export function labelErrorCode(code: string | null): string {
  if (!code) return '';
  return ERROR_CODE_LABELS[code] ?? `کد ناشناخته: ${code}`;
}

export function labelCategory(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

export function labelSeverity(severity: string): string {
  return SEVERITY_LABELS[severity] ?? severity;
}

export function labelResult(result: string | null): string {
  if (!result) return '';
  return RESULT_LABELS[result] ?? result;
}
