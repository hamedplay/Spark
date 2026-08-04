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
  // Check at least one login method enabled
  if (
    patch.username_login === false &&
    patch.email_login === false &&
    patch.phone_login === false
  ) {
    // Also check the resulting state
    const resultUsername = patch.username_login ?? draft.username_login;
    const resultEmail = patch.email_login ?? draft.email_login;
    const resultPhone = patch.phone_login ?? draft.phone_login;
    if (!resultUsername && !resultEmail && !resultPhone) {
      return { ok: false, error: 'NO_LOGIN_METHOD_ENABLED', message: 'حداقل یک روش ورود باید فعال باشد.' };
    }
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
