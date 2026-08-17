import type { SecurityAdminErrorCode } from '../types/securityAdministration';

const ERROR_MESSAGES: Record<SecurityAdminErrorCode, string> = {
  UNAUTHORIZED: 'احراز هویت نشده‌اید. لطفاً وارد شوید.',
  SESSION_REQUIRED: 'نشست مورد نیاز است.',
  SESSION_INVALID: 'نشست شما نامعتبر است. لطفاً دوباره وارد شوید.',
  SESSION_EXPIRED: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.',
  SECURITY_ADMIN_REQUIRED: 'دسترسی فقط برای مدیر امنیت فعال است.',
  FORBIDDEN: 'دسترسی مجاز نیست.',
  TARGET_REQUIRED: 'کاربر هدف مشخص نشده است.',
  TARGET_NOT_FOUND: 'کاربر هدف یافت نشد.',
  TARGET_NOT_ELIGIBLE: 'کاربر هدف واجد شرایط نیست.',
  TARGET_TOTP_REQUIRED: 'کاربر هدف باید TOTP تأییدشده داشته باشد.',
  NEW_VALUE_REQUIRED: 'مقدار جدید مشخص نشده است.',
  EXPECTED_VERSION_REQUIRED: 'نسخه مورد انتظار مشخص نشده است.',
  CANNOT_CHANGE_OWN_SECURITY_ADMIN: 'نمی‌توانید نقش امنیتی خود را تغییر دهید.',
  CANNOT_REMOVE_LAST_SECURITY_ADMIN: 'آخرین مدیر امنیت فعال را نمی‌توان حذف کرد.',
  VERSION_CONFLICT: 'نسخه تغییر کرده است. لطفاً دوباره بررسی کنید.',
  NO_EFFECTIVE_CHANGE: 'تغییری اعمال نشد — وضعیت از قبل همین است.',
  STEPUP_REQUIRED: 'تأیید احراز هویت دومرحله‌ای لازم است.',
  CHANGE_REASON_REQUIRED: 'دلیل تغییر الزامی است.',
  CHANGE_REASON_TOO_SHORT: 'دلیل تغییر باید حداقل ۱۰ کاراکتر باشد.',
  CHANGE_REASON_TOO_LONG: 'دلیل تغییر نباید بیش از ۵۰۰ کاراکتر باشد.',
  INVALID_LIMIT: 'محدوده تعداد نامعتبر است.',
  INVALID_OFFSET: 'محدوده شروع نامعتبر است.',
  INVALID_CURSOR: 'مکان‌نمای صفحه‌بندی نامعتبر است.',
  INVALID_CATEGORY: 'دسته رویداد نامعتبر است.',
  INVALID_SEVERITY: 'سطح اهمیت نامعتبر است.',
  INVALID_RESULT: 'نتیجه رویداد نامعتبر است.',
  INVALID_DATE_RANGE: 'بازه تاریخ نامعتبر است.',
  SEARCH_TOO_LONG: 'متن جستجو بیش از حد مجاز است.',
  UNKNOWN_SECURITY_ADMIN_ERROR: 'خطای ناشناخته رخ داد.',
};

const KNOWN_CODES: SecurityAdminErrorCode[] = [
  'UNAUTHORIZED', 'SESSION_REQUIRED', 'SESSION_INVALID', 'SESSION_EXPIRED',
  'SECURITY_ADMIN_REQUIRED', 'FORBIDDEN', 'TARGET_REQUIRED', 'TARGET_NOT_FOUND',
  'TARGET_NOT_ELIGIBLE', 'TARGET_TOTP_REQUIRED', 'NEW_VALUE_REQUIRED',
  'EXPECTED_VERSION_REQUIRED', 'CANNOT_CHANGE_OWN_SECURITY_ADMIN',
  'CANNOT_REMOVE_LAST_SECURITY_ADMIN', 'VERSION_CONFLICT', 'NO_EFFECTIVE_CHANGE',
  'STEPUP_REQUIRED', 'CHANGE_REASON_REQUIRED', 'CHANGE_REASON_TOO_SHORT',
  'CHANGE_REASON_TOO_LONG', 'INVALID_LIMIT', 'INVALID_OFFSET', 'INVALID_CURSOR',
  'INVALID_CATEGORY', 'INVALID_SEVERITY', 'INVALID_RESULT', 'INVALID_DATE_RANGE',
  'SEARCH_TOO_LONG', 'UNKNOWN_SECURITY_ADMIN_ERROR',
];

export function mapSecurityAdminError(code: string | undefined | null): SecurityAdminErrorCode {
  if (code && KNOWN_CODES.includes(code as SecurityAdminErrorCode)) {
    return code as SecurityAdminErrorCode;
  }
  return 'UNKNOWN_SECURITY_ADMIN_ERROR';
}

export function getSecurityAdminErrorMessage(code: SecurityAdminErrorCode): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN_SECURITY_ADMIN_ERROR;
}
