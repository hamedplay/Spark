-- Align recovery settings with the canonical unified-recovery runtime.
-- Unified recovery cannot be enabled unless recovery itself is enabled.
-- Recovery codes are intentionally unsupported by the current canonical MFA runtime.

ALTER TABLE public.auth_security_settings
  DROP CONSTRAINT IF EXISTS auth_security_settings_unified_recovery_requires_recovery_check;

ALTER TABLE public.auth_security_settings
  ADD CONSTRAINT auth_security_settings_unified_recovery_requires_recovery_check
  CHECK (NOT unified_recovery_enabled OR recovery_enabled);

ALTER TABLE public.auth_security_settings
  DROP CONSTRAINT IF EXISTS auth_security_settings_recovery_codes_runtime_check;

ALTER TABLE public.auth_security_settings
  ADD CONSTRAINT auth_security_settings_recovery_codes_runtime_check
  CHECK (allow_recovery_codes IS FALSE);
