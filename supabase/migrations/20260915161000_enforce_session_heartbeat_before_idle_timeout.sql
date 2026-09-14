-- Keep the configured heartbeat cadence strictly below the idle timeout so an
-- active client always has a chance to refresh its session before idle expiry.
-- This is enforced at the table boundary as defense in depth, including writes
-- that bypass the normal security-settings RPC.

ALTER TABLE public.auth_security_settings
  DROP CONSTRAINT IF EXISTS auth_security_settings_heartbeat_before_idle_check;

ALTER TABLE public.auth_security_settings
  ADD CONSTRAINT auth_security_settings_heartbeat_before_idle_check
  CHECK (
    session_heartbeat_interval_seconds < session_idle_timeout_minutes * 60
  );
