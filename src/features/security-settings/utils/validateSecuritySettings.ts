import type { SecuritySettings, SecuritySettingsPatch, SecurityErrorCode } from '../types/securitySettings';

export interface ValidationResult {
  ok: boolean;
  error?: SecurityErrorCode;
  message?: string;
}

export function validateSecuritySettings(
  draft: SecuritySettings,
  patch: SecuritySettingsPatch
): ValidationResult {
  // Check at least one login method enabled — based on final draft state
  if (
    !draft.username_login &&
    !draft.email_login &&
    !draft.phone_login
  ) {
    return { ok: false, error: 'NO_LOGIN_METHOD_ENABLED', message: 'حداقل یک روش ورود باید فعال باشد.' };
  }

  // mfa_policy = required only if allow_totp_mfa = true
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
  const validCustomFactors = ['totp', 'sms', 'bale', 'email', 'recovery'];

  if (customMfaRequired && !customMfaEnabled) {
    return { ok: false, error: 'MFA_REQUIRED_WITHOUT_FACTOR', message: 'احراز هویت سفارشی اجباری بدون فعال‌سازی مجاز نیست.' };
  }
  if (customMfaRequired && customMfaFactors.length === 0) {
    return { ok: false, error: 'MFA_REQUIRED_WITHOUT_FACTOR', message: 'برای اجباری‌کردن احراز هویت سفارشی حداقل یک عامل لازم است.' };
  }
  if (customMfaFactors.some((factor) => !validCustomFactors.includes(factor))) {
    return { ok: false, error: 'OUT_OF_RANGE', message: 'عامل احراز هویت سفارشی نامعتبر است.' };
  }

  // idle <= absolute
  const effectiveIdle = patch.session_idle_timeout_minutes ?? draft.session_idle_timeout_minutes;
  const effectiveAbsolute = patch.session_absolute_lifetime_minutes ?? draft.session_absolute_lifetime_minutes;
  if (effectiveIdle > effectiveAbsolute) {
    return {
      ok: false,
      error: 'INVALID_SESSION_POLICY',
      message: 'زمان بیکاری نشست نمی‌تواند بیشتر از طول کل نشست باشد.',
    };
  }

  // Numeric ranges
  if (patch.session_idle_timeout_minutes !== undefined) {
    if (patch.session_idle_timeout_minutes < 1 || patch.session_idle_timeout_minutes > 10080) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'زمان بیکاری نشست باید بین ۱ تا ۱۰۰۸۰ دقیقه باشد.' };
    }
  }
  if (patch.session_absolute_lifetime_minutes !== undefined) {
    if (patch.session_absolute_lifetime_minutes < 1 || patch.session_absolute_lifetime_minutes > 43200) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'طول کل نشست باید بین ۱ تا ۴۳۲۰۰ دقیقه باشد.' };
    }
  }
  if (patch.max_active_sessions !== undefined) {
    if (patch.max_active_sessions < 1 || patch.max_active_sessions > 100) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر نشست‌های فعال باید بین ۱ تا ۱۰۰ باشد.' };
    }
  }
  if (patch.lock_threshold !== undefined) {
    if (patch.lock_threshold < 1 || patch.lock_threshold > 50) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'آستانه قفل باید بین ۱ تا ۵۰ باشد.' };
    }
  }
  if (patch.custom_mfa_challenge_ttl_seconds !== undefined) {
    if (patch.custom_mfa_challenge_ttl_seconds < 30 || patch.custom_mfa_challenge_ttl_seconds > 3600) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'مهلت کد باید بین ۳۰ تا ۳۶۰۰ ثانیه باشد.' };
    }
  }
  if (patch.custom_mfa_max_resends !== undefined) {
    if (patch.custom_mfa_max_resends < 0 || patch.custom_mfa_max_resends > 10) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر ارسال مجدد باید بین ۰ تا ۱۰ باشد.' };
    }
  }
  if (patch.custom_mfa_max_attempts !== undefined) {
    if (patch.custom_mfa_max_attempts < 1 || patch.custom_mfa_max_attempts > 20) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'حداکثر تلاش باید بین ۱ تا ۲۰ باشد.' };
    }
  }
  if (patch.custom_mfa_grant_lifetime_minutes !== undefined) {
    if (patch.custom_mfa_grant_lifetime_minutes < 1 || patch.custom_mfa_grant_lifetime_minutes > 1440) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'عمر مجوز باید بین ۱ تا ۱۴۴۰ دقیقه باشد.' };
    }
  }
  if (patch.lock_duration_minutes !== undefined) {
    if (patch.lock_duration_minutes < 1 || patch.lock_duration_minutes > 1440) {
      return { ok: false, error: 'OUT_OF_RANGE', message: 'مدت قفل باید بین ۱ تا ۱۴۴۰ دقیقه باشد.' };
    }
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
  if (trimmed.length === 0) {
    return { ok: false, error: 'NO_EFFECTIVE_CHANGE', message: 'دلیل تغییر نمی‌تواند خالی باشد.' };
  }
  return { ok: true };
}
