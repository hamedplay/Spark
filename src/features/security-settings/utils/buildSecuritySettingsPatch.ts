import type { SecuritySettings, SecuritySettingsPatch } from '../types/securitySettings';

const PATCHABLE_KEYS: (keyof SecuritySettingsPatch)[] = [
  'username_login',
  'email_login',
  'phone_login',
  'mfa_policy',
  'registration_enabled',
  'registration_requires_admin_approval',
  'require_profile_completion',
  'allow_totp_mfa',
  'session_idle_timeout_minutes',
  'session_absolute_lifetime_minutes',
  'max_active_sessions',
  'lock_threshold',
  'lock_duration_minutes',
  'recovery_enabled',
];

export function buildSecuritySettingsPatch(
  serverState: SecuritySettings,
  draftState: SecuritySettings
): SecuritySettingsPatch {
  const patch: SecuritySettingsPatch = {};

  for (const key of PATCHABLE_KEYS) {
    const serverVal = serverState[key];
    const draftVal = draftState[key];

    if (serverVal !== draftVal) {
      // Only include fields that actually changed
      (patch as Record<string, unknown>)[key] = draftVal;
    }
  }

  return patch;
}

export function isPatchEmpty(patch: SecuritySettingsPatch): boolean {
  return Object.keys(patch).length === 0;
}
