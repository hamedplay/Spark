export type MfaPolicy = 'disabled' | 'optional' | 'required';

export interface SecuritySettings {
  settings_version: number;
  username_login: boolean;
  email_login: boolean;
  phone_login: boolean;
  mfa_policy: MfaPolicy;
  registration_enabled: boolean;
  registration_requires_admin_approval: boolean;
  require_profile_completion: boolean;
  allow_totp_mfa: boolean;
  allow_bale_mfa: boolean;
  allow_email_mfa: boolean;
  allow_recovery_codes: boolean;
  session_idle_timeout_minutes: number;
  session_absolute_lifetime_minutes: number;
  max_active_sessions: number;
  lock_threshold: number;
  lock_duration_minutes: number;
  recovery_enabled: boolean;
  config_schema_version: number;
  updated_at: string;
  custom_mfa_enabled: boolean;
  custom_mfa_required: boolean;
  custom_mfa_allowed_factors: string[];
  custom_mfa_challenge_ttl_seconds: number;
  custom_mfa_max_resends: number;
  custom_mfa_max_attempts: number;
  custom_mfa_grant_lifetime_minutes: number;
}

export interface SecurityImpact {
  active_users: number;
  users_with_verified_totp: number;
  users_without_verified_totp: number;
  security_admins: number;
  security_admins_without_verified_totp: number;
}

export interface SecurityHistoryEntry {
  version: number;
  changed_at: string;
  change_reason: string | null;
  changed_by: string | null;
  mfa_policy: MfaPolicy;
  allow_totp_mfa: boolean;
  username_login: boolean;
  email_login: boolean;
  phone_login: boolean;
}

export interface SecurityConsoleState {
  ok: boolean;
  settings: SecuritySettings;
  impact: SecurityImpact;
  recent_history: SecurityHistoryEntry[];
  error?: string;
}

export type SecurityErrorCode =
  | 'VERSION_CONFLICT'
  | 'STEPUP_REQUIRED'
  | 'NO_LOGIN_METHOD_ENABLED'
  | 'MFA_REQUIRED_WITHOUT_FACTOR'
  | 'INVALID_SESSION_POLICY'
  | 'PHONE_LOGIN_NOT_READY'
  | 'NO_EFFECTIVE_CHANGE'
  | 'FORBIDDEN'
  | 'SESSION_EXPIRED'
  | 'INVALID_TYPE'
  | 'OUT_OF_RANGE'
  | 'UNKNOWN_KEY'
  | 'UNAUTHORIZED'
  | 'SESSION_INVALID'
  | 'SECURITY_ADMIN_REQUIRED'
  | 'SETTINGS_NOT_FOUND'
  | 'UNKNOWN_SECURITY_ERROR';

export interface SecuritySettingsPatch {
  username_login?: boolean;
  email_login?: boolean;
  phone_login?: boolean;
  mfa_policy?: MfaPolicy;
  registration_enabled?: boolean;
  registration_requires_admin_approval?: boolean;
  require_profile_completion?: boolean;
  allow_totp_mfa?: boolean;
  session_idle_timeout_minutes?: number;
  session_absolute_lifetime_minutes?: number;
  max_active_sessions?: number;
  lock_threshold?: number;
  lock_duration_minutes?: number;
  recovery_enabled?: boolean;
  custom_mfa_enabled?: boolean;
  custom_mfa_required?: boolean;
  custom_mfa_allowed_factors?: string[];
  custom_mfa_challenge_ttl_seconds?: number;
  custom_mfa_max_resends?: number;
  custom_mfa_max_attempts?: number;
  custom_mfa_grant_lifetime_minutes?: number;
}

export const SECURITY_ERROR_MESSAGES: Record<string, string> = {
  VERSION_CONFLICT: 'نسخه تنظیمات تغییر کرده است. اطلاعات جدید بارگذاری شد؛ لطفاً تغییرات خود را بازبینی کنید.',
  STEPUP_REQUIRED: 'برای ذخیره تنظیمات، احراز هویت دومرحله‌ای (TOTP) لازم است.',
  NO_LOGIN_METHOD_ENABLED: 'حداقل یک روش ورود باید فعال باشد.',
  MFA_REQUIRED_WITHOUT_FACTOR: 'فعال‌سازی MFA الزامی بدون روش TOTP مجاز نیست.',
  INVALID_SESSION_POLICY: 'تنظیمات Session نامعتبر است.',
  PHONE_LOGIN_NOT_READY: 'ورود با تلفن هنوز آماده نیست.',
  NO_EFFECTIVE_CHANGE: 'تغییری برای ذخیره وجود ندارد.',
  FORBIDDEN: 'دسترسی به تنظیمات امنیتی فقط برای مدیر امنیت فعال است.',
  SESSION_EXPIRED: 'نشست شما منقضی شده است. لطفاً دوباره وارد شوید.',
  INVALID_TYPE: 'نوع یکی از فیلدها نامعتبر است.',
  OUT_OF_RANGE: 'مقدار یکی از فیلدها خارج از محدوده مجاز است.',
  UNKNOWN_KEY: 'کلید ناشناخته در Patch.',
  UNAUTHORIZED: 'احراز هویت نشده‌اید. لطفاً وارد شوید.',
  SESSION_INVALID: 'نشست شما نامعتبر است. لطفاً دوباره وارد شوید.',
  SECURITY_ADMIN_REQUIRED: 'دسترسی به تنظیمات امنیتی فقط برای مدیر امنیت فعال است.',
  SETTINGS_NOT_FOUND: 'تنظیمات امنیتی یافت نشد.',
  UNKNOWN_SECURITY_ERROR: 'خطای ناشناخته رخ داد.',
};

export function mapSecurityError(code: string | undefined | null): SecurityErrorCode {
  if (!code) return 'UNKNOWN_SECURITY_ERROR';
  const known: SecurityErrorCode[] = [
    'VERSION_CONFLICT', 'STEPUP_REQUIRED', 'NO_LOGIN_METHOD_ENABLED',
    'MFA_REQUIRED_WITHOUT_FACTOR', 'INVALID_SESSION_POLICY', 'PHONE_LOGIN_NOT_READY',
    'NO_EFFECTIVE_CHANGE', 'FORBIDDEN', 'SESSION_EXPIRED', 'INVALID_TYPE',
    'OUT_OF_RANGE', 'UNKNOWN_KEY',
    'UNAUTHORIZED', 'SESSION_INVALID', 'SECURITY_ADMIN_REQUIRED', 'SETTINGS_NOT_FOUND',
  ];
  return (known as string[]).includes(code) ? (code as SecurityErrorCode) : 'UNKNOWN_SECURITY_ERROR';
}
