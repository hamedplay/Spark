-- Phase 7: Unified Recovery, Progressive Lock, Session Security
-- Reuses existing auth_security_settings, profiles, session_security_grants, custom_mfa_grants

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Settings additions
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.auth_security_settings
  ADD COLUMN IF NOT EXISTS unified_recovery_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recovery_otp_ttl_seconds integer NOT NULL DEFAULT 600,
  ADD COLUMN IF NOT EXISTS recovery_max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS recovery_reset_token_ttl_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS progressive_lock_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS progressive_lock_schedule text[] NOT NULL DEFAULT ARRAY['1','6','12','24','48','72']::text[],
  ADD COLUMN IF NOT EXISTS session_management_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS session_heartbeat_interval_seconds integer NOT NULL DEFAULT 300;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Auth epoch on profiles
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_epoch integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_until timestamptz;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Unified recovery challenges (consolidates phone-only flow)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.unified_recovery_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,  -- nullable: null when identifier not found (anti-enumeration)
  identifier_type text NOT NULL CHECK (identifier_type IN ('username','email','phone')),
  identifier_hash text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('email','phone','bale')),
  channel_target_hash text,  -- HMAC of the user-provided channel target (email/phone)
  otp_hash text,
  reset_token_hash text,
  status text NOT NULL DEFAULT 'REQUESTED'
    CHECK (status IN ('REQUESTED','CODE_SENT','VERIFIED','RESET_TOKEN_ISSUED','PROCESSING','CONSUMED','EXPIRED','FAILED','LOCKED','DELIVERY_FAILED')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  reset_expires_at timestamptz,
  verified_at timestamptz,
  consumed_at timestamptz,
  processing_claim_id uuid,
  processing_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unified_recovery_identifier
  ON public.unified_recovery_challenges (identifier_hash, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_recovery_user
  ON public.unified_recovery_challenges (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_recovery_status_expires
  ON public.unified_recovery_challenges (status, expires_at);

ALTER TABLE public.unified_recovery_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unified_recovery_challenges FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.unified_recovery_challenges TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Progressive lock log
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.auth_lock_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  identifier_hash text NOT NULL,
  ip_hash text NOT NULL,
  failure_count integer NOT NULL DEFAULT 1,
  lock_level integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_lock_events_user ON public.auth_lock_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_lock_events_identifier ON public.auth_lock_events (identifier_hash, created_at DESC);

ALTER TABLE public.auth_lock_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_lock_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.auth_lock_events TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Session security tracking (server-side session state)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.session_security_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE,
  user_id uuid NOT NULL,
  auth_epoch integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  idle_expiry_at timestamptz NOT NULL,
  absolute_expiry_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text,
  device_summary text,
  ip_hash text
);

CREATE INDEX IF NOT EXISTS idx_session_security_user ON public.session_security_state (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_security_user_active ON public.session_security_state (user_id, revoked_at)
  WHERE revoked_at IS NULL;

ALTER TABLE public.session_security_state ENABLE ROW LEVEL SECURITY;

-- Users can read their own session state
CREATE POLICY "select_own_session_security" ON public.session_security_state
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
-- No direct INSERT/UPDATE/DELETE — all via SECURITY DEFINER RPCs
REVOKE ALL ON public.session_security_state FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.session_security_state TO service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Unified recovery rate limit table
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.unified_recovery_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose text NOT NULL CHECK (purpose IN ('recovery_request','recovery_verify','recovery_complete')),
  identifier_hash text,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unified_recovery_rl_ip ON public.unified_recovery_rate_limit (ip_hash, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_unified_recovery_rl_identifier ON public.unified_recovery_rate_limit (identifier_hash, purpose, created_at DESC);

ALTER TABLE public.unified_recovery_rate_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unified_recovery_rate_limit FROM anon, authenticated;
GRANT SELECT, INSERT ON public.unified_recovery_rate_limit TO service_role;
