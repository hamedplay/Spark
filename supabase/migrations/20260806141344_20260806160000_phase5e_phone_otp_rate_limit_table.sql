-- Phase 5E-B2: Phone OTP Login Rate Limit Table
-- Creates the private rate limit table for OTP login attempts.
-- No RPC, no trigger, no policy, no edge function changes.

CREATE TABLE private.phone_otp_login_rate_limit_v2 (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  purpose text NOT NULL,
  phone_hash text NOT NULL,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT phone_otp_login_rate_limit_v2_purpose_check
    CHECK (purpose IN ('phone_otp_login_request', 'phone_otp_login_verify')),

  CONSTRAINT phone_otp_login_rate_limit_v2_phone_hash_hex64
    CHECK (phone_hash ~ '^[0-9a-f]{64}$'),

  CONSTRAINT phone_otp_login_rate_limit_v2_ip_hash_hex64
    CHECK (ip_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX phone_otp_login_rate_limit_v2_purpose_phone_created_idx
  ON private.phone_otp_login_rate_limit_v2
  (purpose, phone_hash, created_at DESC);

CREATE INDEX phone_otp_login_rate_limit_v2_purpose_ip_created_idx
  ON private.phone_otp_login_rate_limit_v2
  (purpose, ip_hash, created_at DESC);

ALTER TABLE private.phone_otp_login_rate_limit_v2
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL
  ON private.phone_otp_login_rate_limit_v2
  FROM PUBLIC, anon, authenticated;

REVOKE ALL
  ON SEQUENCE private.phone_otp_login_rate_limit_v2_id_seq
  FROM PUBLIC, anon, authenticated;
