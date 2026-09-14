import type { SecuritySettings, SecuritySettingsPatch, SecurityErrorCode } from '../types/securitySettings';

export interface ValidationResult {
  ok: boolean;
  error?: SecurityErrorCode;
  message?: string;
}

function inIntegerRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

function validProgressiveLockSchedule(schedule: string[]): boolean {
  return Array.isArray(schedule)
    && schedule.length >= 1
    && schedule.length <= 12
    && schedule.every((entry) => /^\d+$/.test(entry) && inIntegerRange(Number(entry), 1, 43200));
}

export function validateSecuritySettings(
  draft: SecuritySettings,
  patch: SecuritySettingsPatch
): ValidationResult {
  if (!draft.username_login && !draft.email_login && !draft.phone_login) {
    return { ok: false, error: 'NO_LOGIN_METHOD_ENABLED', message: 'حداقل یک روش ورود باید فعال باشد.' };
  }

  const effectiveMfaPolicy = patch.mfa_policy ?? draft.mfa_policy;
  const effectiveAllowTotp = patch.allow_totp_mfa ?? draft.allow_totp_mfa;
  if (effectiveMfaPolicy === 'required' && !effectiveAllowTotp) {
    return {
      ok: false,
      error: 'MFA_REQUIRED_WITHOUT_FACTOR',
      message: 'سیاست "الزامی" فقط زمانی قابل انتخاب است که TOTP فعال باشد.',
    };
  }

  const customMfaEnabled = patch.custom_mfa_enabled ?? draft.custom_mfa_enabled;
  const customMfaRequired = patch.custom_mfa_required ?? draft.custom_mfa_required;
  const customMfaFactors = patch.custom_mfa_allowed_factors ?? draft.custom_mfa_allowed_factors ?? [];

  if (customMfaRequired) {
    return {
      ok: false,
      error: 'CUSTOM_MFA_REQUIRED_UNSUPPORTED',
      message: 'اجبار مستقل MFA سفارشی پشتیبانی نمی‌شود؛ اجبار MFA را از سیاست سراسری MFA مدیریت کنید.',
    };
  }
  if (customMfaFactors.some((factor) => factor !== 'sms')) {
    return {
      ok: false,
      error: 'CUSTOM_MFA_FACTOR_UNSUPPORTED',
      message: 'در زیرساخت MFA سفارشی فعلی فقط عامل پیامکی پشتیبانی می‌شود.',
    };
  }
  if (customMfaEnabled && (customMfaFactors.length !== 1 || customMfaFactors[0] !== 'sms')) {
    return {
      ok: false,
      error: 'SMS_MFA_FACTOR_REQUIRED',
      message: 'فعال‌سازی MFA پیامکی باید همراه با عامل پیامک انجام شود.',
    };
  }

  const effectiveIdle = patch.session_idle_timeout_minutes ?? draft.session_idle_timeout_minutes;
  const effectiveAbsolute = patch.session_absolute_lifetime_minutes ?? draft.session_absolute_lifetime_minutes;
  if (effectiveIdle > effectiveAbsolute) {
    return {
      ok: false,
      error: 'INVALID_SESSION_POLICY',
      message: 'زمان بیکاری نشست نمی‌تواند بیشتر از طول کل نشست باشد.',
    };
  }

  if (patch.session_idle_timeout_minutes !== undefined && !inIntegerRange(patch.session_idle_timeout_minutes, 1, 10080)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'زمان بیکاری نشست باید بین ۱ تا ۱۰۰۸۰ دقیقه باشد.' };
  }
  if (patch.session_absolute_lifetime_minutes !== undefined && !inIntegerRange(patch.session_absolute_lifetime_minutes, 1, 43200)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'طول کل نشست باید بین ۱ تا ۴۳۲۰۰ دقیقه باشد.' };
  }
  if (patch.max_active_sessions !== undefined && !inIntegerRange(patch.max_active_sessions, 1, 100)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر نشست‌های فعال باید بین ۱ تا ۱۰۰ باشد.' };
  }
  if (patch.session_heartbeat_interval_seconds !== undefined && !inIntegerRange(patch.session_heartbeat_interval_seconds, 30, 3600)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'فاصله Heartbeat نشست باید بین ۳۰ تا ۳۶۰۰ ثانیه باشد.' };
  }
  if (patch.lock_threshold !== undefined && !inIntegerRange(patch.lock_threshold, 1, 50)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'آستانه قفل باید بین ۱ تا ۵۰ باشد.' };
  }
  if (patch.lock_duration_minutes !== undefined && !inIntegerRange(patch.lock_duration_minutes, 1, 1440)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'مدت قفل باید بین ۱ تا ۱۴۴۰ دقیقه باشد.' };
  }

  const effectiveSchedule = patch.progressive_lock_schedule ?? draft.progressive_lock_schedule;
  const progressiveEnabled = patch.progressive_lock_enabled ?? draft.progressive_lock_enabled;
  if ((progressiveEnabled || patch.progressive_lock_schedule !== undefined) && !validProgressiveLockSchedule(effectiveSchedule)) {
    return {
      ok: false,
      error: 'OUT_OF_RANGE',
      message: 'برنامه قفل تصاعدی باید شامل ۱ تا ۱۲ مقدار دقیقه صحیح بین ۱ تا ۴۳۲۰۰ باشد.',
    };
  }

  if (patch.recovery_otp_ttl_seconds !== undefined && !inIntegerRange(patch.recovery_otp_ttl_seconds, 60, 3600)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'عمر OTP بازیابی باید بین ۶۰ تا ۳۶۰۰ ثانیه باشد.' };
  }
  if (patch.recovery_max_attempts !== undefined && !inIntegerRange(patch.recovery_max_attempts, 1, 20)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر تلاش بازیابی باید بین ۱ تا ۲۰ باشد.' };
  }
  if (patch.recovery_reset_token_ttl_seconds !== undefined && !inIntegerRange(patch.recovery_reset_token_ttl_seconds, 60, 1800)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'عمر توکن تغییر رمز باید بین ۶۰ تا ۱۸۰۰ ثانیه باشد.' };
  }

  if (patch.custom_mfa_challenge_ttl_seconds !== undefined && !inIntegerRange(patch.custom_mfa_challenge_ttl_seconds, 30, 3600)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'مهلت کد باید بین ۳۰ تا ۳۶۰۰ ثانیه باشد.' };
  }
  if (patch.custom_mfa_max_resends !== undefined && !inIntegerRange(patch.custom_mfa_max_resends, 0, 10)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر ارسال مجدد باید بین ۰ تا ۱۰ باشد.' };
  }
  if (patch.custom_mfa_max_attempts !== undefined && !inIntegerRange(patch.custom_mfa_max_attempts, 1, 20)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر تلاش باید بین ۱ تا ۲۰ باشد.' };
  }
  if (patch.custom_mfa_grant_lifetime_minutes !== undefined && !inIntegerRange(patch.custom_mfa_grant_lifetime_minutes, 1, 1440)) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'عمر مجوز باید بین ۱ تا ۱۴۴۰ دقیقه باشد.' };
  }

  return { ok: true };
}

export function validateChangeReason(reason: string): ValidationResult {
  const trimmed = reason.trim();
  if (trimmed.length < 10) {
    return { ok: false, error: 'NO_EFFECTIVE_CHANGE', message: 'دلیل تغییر حداقل ۱۰ کاراکتر لازم است.' };
  }
  if (trimmed.length > 500) {
    return { ok: false, error: 'NO_EFFECTIVE_CHANGE', message: 'دلیل تغییر حداکثر ۵۰۰ کاراکتر مجاز است.' };
  }
  return { ok: true };
}
