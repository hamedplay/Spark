-- Phase 5E-B1: Phone OTP Login Challenge Table
-- Creates the private challenge table for OTP login with constraints and indexes.
-- No rate limit table, no RPC, no trigger, no policy, no edge function changes.

-- ============================================================================
-- 1. Challenge table
-- ============================================================================

CREATE TABLE private.phone_otp_login_challenges_v2 (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  phone_hash text NOT NULL,
  otp_hash text NOT NULL,
  ip_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL,
  expires_at timestamptz NOT NULL,
  resend_available_at timestamptz NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  claim_id uuid NULL,
  claim_expires_at timestamptz NULL,
  delivery_status text NOT NULL DEFAULT 'pending',
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT phone_otp_login_challenges_v2_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,

  CONSTRAINT phone_otp_login_challenges_v2_status_check
    CHECK (status IN ('pending', 'processing', 'consumed', 'expired', 'locked', 'superseded', 'delivery_failed')),

  CONSTRAINT phone_otp_login_challenges_v2_delivery_status_check
    CHECK (delivery_status IN ('pending', 'sent', 'failed')),

  CONSTRAINT phone_otp_login_challenges_v2_phone_hash_hex64
    CHECK (phone_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT phone_otp_login_challenges_v2_otp_hash_hex64
    CHECK (otp_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT phone_otp_login_challenges_v2_ip_hash_hex64
    CHECK (ip_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT phone_otp_login_challenges_v2_attempt_count_nonneg
    CHECK (attempt_count >= 0),

  CONSTRAINT phone_otp_login_challenges_v2_max_attempts_range
    CHECK (max_attempts >= 1 AND max_attempts <= 10),

  CONSTRAINT phone_otp_login_challenges_v2_attempt_le_max
    CHECK (attempt_count <= max_attempts),

  CONSTRAINT phone_otp_login_challenges_v2_expires_after_created
    CHECK (expires_at > created_at),

  CONSTRAINT phone_otp_login_challenges_v2_resend_after_created
    CHECK (resend_available_at >= created_at),

  CONSTRAINT phone_otp_login_challenges_v2_claim_expires_after_created
    CHECK (claim_expires_at IS NULL OR claim_expires_at > created_at),

  CONSTRAINT phone_otp_login_challenges_v2_processing_requires_claim
    CHECK (
      status <> 'processing'
      OR (claim_id IS NOT NULL AND claim_expires_at IS NOT NULL)
    ),

  CONSTRAINT phone_otp_login_challenges_v2_non_processing_no_claim_required
    CHECK (
      status = 'processing'
      OR claim_id IS NULL
      OR claim_id IS NOT NULL
    ),

  CONSTRAINT phone_otp_login_challenges_v2_consumed_requires_consumed_at
    CHECK (
      status <> 'consumed'
      OR consumed_at IS NOT NULL
    )
);

-- ============================================================================
-- 2. Indexes
-- ============================================================================

CREATE INDEX phone_otp_login_challenges_v2_phone_hash_status_created_idx
  ON private.phone_otp_login_challenges_v2
  (phone_hash, status, created_at DESC);

CREATE INDEX phone_otp_login_challenges_v2_user_id_status_created_idx
  ON private.phone_otp_login_challenges_v2
  (user_id, status, created_at DESC);

CREATE INDEX phone_otp_login_challenges_v2_status_expires_idx
  ON private.phone_otp_login_challenges_v2
  (status, expires_at);

CREATE INDEX phone_otp_login_challenges_v2_claim_id_idx
  ON private.phone_otp_login_challenges_v2
  (claim_id)
  WHERE claim_id IS NOT NULL;

-- ============================================================================
-- 3. Security: RLS + revoke
-- ============================================================================

ALTER TABLE private.phone_otp_login_challenges_v2
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
  ON private.phone_otp_login_challenges_v2
  FROM PUBLIC, anon, authenticated;
