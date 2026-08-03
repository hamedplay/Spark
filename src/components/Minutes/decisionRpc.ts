/**
 * Shared helper for parsing RPC results from decision-related functions.
 * All decision RPCs return `{ success: boolean, error_code?: string, ... }`.
 */

export interface RpcResult {
  success: boolean;
  error_code?: string;
  message?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export const DECISION_RPC_ERROR_MAP: Record<string, string> = {
  NOT_AUTHENTICATED:              'ابتدا وارد شوید.',
  DECISION_NOT_FOUND:            'مصوبه یافت نشد.',
  NOT_DECISION_OWNER:            'شما مسئول این مصوبه نیستید.',
  NOT_AUTHORIZED:                'دسترسی ندارید.',
  DECISION_VERSION_CONFLICT:     'این مصوبه توسط کاربر دیگری به‌روزرسانی شده است. لطفاً صفحه را بازآوری کنید.',
  INVALID_PROGRESS:              'درصد پیشرفت باید بین ۰ تا ۱۰۰ باشد.',
  INVALID_STATUS:                'وضعیت انتخابی معتبر نیست.',
  INVALID_EVENT_TYPE:            'نوع رویداد معتبر نیست.',
  INVALID_OPERATION:             'عملیات نامعتبر است.',
  COMPLETION_REQUIRES_100_PERCENT: 'برای تکمیل، پیشرفت باید ۱۰۰٪ باشد.',
  COMPLETED_DECISION_IMMUTABLE:  'مصوبه تکمیل‌شده قابل ویرایش نیست.',
  MINUTE_NOT_PUBLISHED:          'صورت‌جلسه مرتبط باید منتشر یا تأیید شده باشد.',
  DECISION_NOT_COMPLETED:        'مصوبه هنوز تکمیل نشده است.',
  INVALID_REOPEN_STATUS:         'وضعیت بازگشایی معتبر نیست.',
  USE_REOPEN_OPERATION:          'برای بازگشایی مصوبه تکمیل‌شده از عملیات «بازگشایی» استفاده کنید.',
  USE_COMPLETION_OPERATION:      'برای تکمیل مصوبه از عملیات «تکمیل» استفاده کنید.',
  OBSTACLE_NOT_FOUND:            'مانع یافت نشد.',
  OBSTACLE_ALREADY_RESOLVED:      'این مانع قبلاً رفع شده است.',
  INTERNAL_ERROR:                'خطای داخلی سرور. لطفاً دوباره امتحان کنید.',
  MINUTES_DECISION_TRACKING_NOT_ALLOWED: 'شما اجازه پیگیری مصوبات این صورت‌جلسه را ندارید.',
  MINUTE_NOT_FOUND:              'صورت‌جلسه یافت نشد.',
  MINUTE_NOT_EDITABLE:           'این صورت‌جلسه قابل ویرایش نیست.',
  MINUTES_NO_PERMISSION:         'شما اجازه ویرایش این صورت‌جلسه را ندارید.',
  DECISION_TITLE_REQUIRED:      'عنوان مصوبه الزامی است.',
  DECISION_OWNER_REQUIRED:       'انتخاب مسئول مصوبه الزامی است.',
  DECISION_DUE_BEFORE_START:     'مهلت مصوبه نمی‌تواند قبل از تاریخ شروع باشد.',
  REMINDER_MUST_BE_FUTURE:       'یادآوری باید در آینده باشد.',
  NO_REMINDER_RECIPIENT:         'گیرنده یادآوری مشخص نیست.',
  PAYLOAD_INVALID:               'اطلاعات ارسالی نامعتبر است.',
};

/** Returns true if the RPC call itself failed (network/transport error). */
export function isRpcTransportError(error: unknown): boolean {
  return error !== null && error !== undefined;
}

/** Parse an RPC result, returning a user-friendly error message or null on success. */
export function parseRpcResult(data: unknown, transportError: unknown): { ok: boolean; error?: string; updatedAt?: string } {
  if (transportError) {
    return { ok: false, error: 'خطا در ارتباط با سرور. لطفاً دوباره امتحان کنید.' };
  }
  if (!data) {
    return { ok: false, error: 'پاسخی از سرور دریافت نشد.' };
  }
  const result = data as RpcResult;
  if (!result.success) {
    const code = result.error_code ?? '';
    return { ok: false, error: DECISION_RPC_ERROR_MAP[code] ?? result.message ?? code ?? 'خطای ناشناخته' };
  }
  return { ok: true, updatedAt: result.updated_at };
}
