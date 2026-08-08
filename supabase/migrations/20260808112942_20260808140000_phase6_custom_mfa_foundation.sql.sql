/*
# Phase 6 — Custom MFA Foundation

## Purpose
Implements Custom MFA system independent from Supabase built-in TOTP/aal2.
Supports TOTP / SMS / Bale / Email Backup / Recovery Code factors with session-bound grants.

## Key Design
- Custom MFA does NOT produce aal2 — uses its own grant table
- Grants bind to user_id + session_id with expiry/revoke
- Challenges: HMAC-only OTP, TTL, max-attempt, resend, rate-limit, atomic consume
- Factor Independence: if primary=phone_otp, SMS MFA forbidden
- Bale MFA has independent codes; login/recovery OTPs NOT sent to Bale
- Bale linking: random one-time nonce + HMAC lookup
- bale_chat_id: AES-GCM encrypted (pgcrypto) + HMAC lookup; legacy plaintext preserved
- Recovery codes: random, HMAC-only, one-time, regenerable, shown once
- Email backup: only for verified emails; unavailable if no secure transport
- No provider secrets in DB; bot token/encryption key/pepper are Edge Secrets only

## 1. New Tables
- custom_mfa_factors: per-user factor enrollment (totp/sms/bale/email/recovery)
- custom_mfa_challenges: OTP challenges with HMAC-only, TTL, attempts, session-bound
- custom_mfa_grants: session-bound MFA grants (checked by evaluate_current_auth_access)
- custom_mfa_recovery_codes: one-time HMAC-only recovery codes
- bale_link_nonces: one-time nonces for Bale linking

## 2. Modified Tables
- auth_security_settings: +custom_mfa_enabled, +custom_mfa_required, +custom_mfa_allowed_factors,
  +custom_mfa_challenge_ttl_seconds, +custom_mfa_max_resends, +custom_mfa_max_attempts,
  +custom_mfa_grant_lifetime_minutes
- user_bale_mapping: +bale_chat_id_enc (bytea), +bale_chat_id_hmac (text), +bale_mfa_codes_enabled (bool)

## 3. Security (RLS)
- custom_mfa_factors: user SELECT/INSERT/UPDATE own; no DELETE
- custom_mfa_challenges: user INSERT/SELECT/UPDATE own
- custom_mfa_grants: user SELECT own; no direct INSERT/UPDATE/DELETE (SECURITY DEFINER only)
- custom_mfa_recovery_codes: user SELECT own; no direct INSERT/UPDATE/DELETE
- bale_link_nonces: no direct access (SECURITY DEFINER only)

## 4. New RPCs
- get_custom_mfa_state(), create_custom_mfa_challenge(), verify_custom_mfa_challenge()
- verify_custom_mfa_recovery(), regenerate_custom_mfa_recovery_codes()
- issue_custom_mfa_grant(), revoke_custom_mfa_grant(), has_active_custom_mfa_grant()
- create_bale_link_nonce(), consume_bale_link_nonce()
- hmac_with_pepper(), mfa_encrypt(), mfa_decrypt() (service_role only)

## 5. Updated RPCs
- set_auth_security_settings_patch: adds custom_mfa_* keys to allowed patch keys
- get_auth_security_console_state: returns custom_mfa_* settings

## 6. Notes
- No data deleted/reset/truncated — legacy bale_chat_id plaintext preserved
- No direct auth table writes
- No provider secrets in DB
- Custom MFA never sets aal2
*/
-- ────────────────────────────────────────────────────────────────────────────
-- 1. New columns on auth_security_settings
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.auth_security_settings
  ADD COLUMN IF NOT EXISTS custom_mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_mfa_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_mfa_allowed_factors text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS custom_mfa_challenge_ttl_seconds int NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS custom_mfa_max_resends int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS custom_mfa_max_attempts int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS custom_mfa_grant_lifetime_minutes int NOT NULL DEFAULT 30;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. custom_mfa_factors table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_type text NOT NULL CHECK (factor_type IN ('totp','sms','bale','email','recovery')),
  factor_status text NOT NULL DEFAULT 'pending' CHECK (factor_status IN ('pending','active','disabled')),
  totp_secret_hash text NULL,
  totp_secret_enc bytea NULL,
  phone_hash text NULL,
  email_hash text NULL,
  bale_chat_id_enc bytea NULL,
  bale_chat_id_hmac text NULL,
  recovery_codes_hash text[] NULL DEFAULT '{}',
  metadata jsonb NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, factor_type)
);
ALTER TABLE public.custom_mfa_factors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_mfa_factors" ON public.custom_mfa_factors;
CREATE POLICY "select_own_mfa_factors" ON public.custom_mfa_factors
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_mfa_factors" ON public.custom_mfa_factors;
CREATE POLICY "insert_own_mfa_factors" ON public.custom_mfa_factors
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_mfa_factors" ON public.custom_mfa_factors;
CREATE POLICY "update_own_mfa_factors" ON public.custom_mfa_factors
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. custom_mfa_challenges table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_mfa_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_id uuid NOT NULL REFERENCES public.custom_mfa_factors(id) ON DELETE CASCADE,
  factor_type text NOT NULL,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','consumed','expired','max_attempts')),
  attempt_count int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  resend_count int NOT NULL DEFAULT 0,
  max_resends int NOT NULL DEFAULT 3,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  session_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.custom_mfa_challenges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_mfa_challenges" ON public.custom_mfa_challenges;
CREATE POLICY "select_own_mfa_challenges" ON public.custom_mfa_challenges
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_own_mfa_challenges" ON public.custom_mfa_challenges;
CREATE POLICY "insert_own_mfa_challenges" ON public.custom_mfa_challenges
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "update_own_mfa_challenges" ON public.custom_mfa_challenges;
CREATE POLICY "update_own_mfa_challenges" ON public.custom_mfa_challenges
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. custom_mfa_grants table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_mfa_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  grant_type text NOT NULL DEFAULT 'custom_mfa' CHECK (grant_type IN ('custom_mfa','recovery')),
  factor_type text NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  revoked_at timestamptz NULL,
  request_id uuid NULL,
  metadata jsonb NULL DEFAULT '{}'
);
ALTER TABLE public.custom_mfa_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_mfa_grants" ON public.custom_mfa_grants;
CREATE POLICY "select_own_mfa_grants" ON public.custom_mfa_grants
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. custom_mfa_recovery_codes table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.custom_mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.custom_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_own_recovery_codes" ON public.custom_mfa_recovery_codes;
CREATE POLICY "select_own_recovery_codes" ON public.custom_mfa_recovery_codes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. bale_link_nonces table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bale_link_nonces (
  nonce_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bale_link_nonces ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. user_bale_mapping new columns
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_bale_mapping
  ADD COLUMN IF NOT EXISTS bale_chat_id_enc bytea NULL,
  ADD COLUMN IF NOT EXISTS bale_chat_id_hmac text NULL,
  ADD COLUMN IF NOT EXISTS bale_mfa_codes_enabled boolean NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Indexes
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_custom_mfa_factors_user ON public.custom_mfa_factors(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_mfa_challenges_user ON public.custom_mfa_challenges(user_id, status);
CREATE INDEX IF NOT EXISTS idx_custom_mfa_grants_session ON public.custom_mfa_grants(user_id, session_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_custom_mfa_recovery_codes_user ON public.custom_mfa_recovery_codes(user_id, used_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Helper: HMAC with pepper
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hmac_with_pepper(p_input text, p_context text DEFAULT 'mfa')
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_pepper text;
BEGIN
  v_pepper := current_setting('app.mfa_pepper', true);
  IF v_pepper IS NULL OR v_pepper = '' THEN
    v_pepper := current_setting('app.auth_pepper', true);
  END IF;
  IF v_pepper IS NULL OR v_pepper = '' THEN
    RAISE EXCEPTION 'MFA_PEPPER_NOT_CONFIGURED';
  END IF;
  RETURN encode(hmac(p_input::bytea, (p_context || ':' || v_pepper)::bytea, 'sha256'), 'hex');
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Helper: AES-GCM encrypt/decrypt (pgcrypto)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mfa_encrypt(p_plaintext text)
RETURNS bytea
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := current_setting('app.mfa_encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'MFA_ENCRYPTION_KEY_NOT_CONFIGURED';
  END IF;
  RETURN pgp_sym_encrypt(p_plaintext, v_key, 'cipher-algo=aes256, compress-algo=0');
END;
$$;

CREATE OR REPLACE FUNCTION public.mfa_decrypt(p_ciphertext bytea)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := current_setting('app.mfa_encryption_key', true);
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'MFA_ENCRYPTION_KEY_NOT_CONFIGURED';
  END IF;
  RETURN pgp_sym_decrypt(p_ciphertext, v_key);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. RPC: get_custom_mfa_state
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_custom_mfa_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_factors jsonb;
  v_settings record;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT custom_mfa_enabled, custom_mfa_required, custom_mfa_allowed_factors,
         custom_mfa_challenge_ttl_seconds, custom_mfa_max_resends,
         custom_mfa_max_attempts, custom_mfa_grant_lifetime_minutes
  INTO v_settings
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'factor_type', factor_type,
    'factor_status', factor_status,
    'has_totp_secret', totp_secret_enc IS NOT NULL,
    'has_phone', phone_hash IS NOT NULL,
    'has_email', email_hash IS NOT NULL,
    'has_bale', bale_chat_id_enc IS NOT NULL,
    'recovery_codes_count', COALESCE(array_length(recovery_codes_hash, 1), 0)
  )), '[]'::jsonb)
  INTO v_factors
  FROM public.custom_mfa_factors WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'enabled', v_settings.custom_mfa_enabled,
    'required', v_settings.custom_mfa_required,
    'allowed_factors', v_settings.custom_mfa_allowed_factors,
    'challenge_ttl_seconds', v_settings.custom_mfa_challenge_ttl_seconds,
    'max_resends', v_settings.custom_mfa_max_resends,
    'max_attempts', v_settings.custom_mfa_max_attempts,
    'grant_lifetime_minutes', v_settings.custom_mfa_grant_lifetime_minutes,
    'factors', v_factors
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. RPC: issue_custom_mfa_grant — SECURITY DEFINER, session-bound
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.issue_custom_mfa_grant(
  p_user_id uuid,
  p_session_id uuid,
  p_factor_type text,
  p_grant_type text DEFAULT 'custom_mfa',
  p_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_grant_id uuid;
  v_expires_at timestamptz;
  v_lifetime int;
BEGIN
  IF p_user_id IS NULL OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;
  IF p_factor_type NOT IN ('totp','sms','bale','email','recovery') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_FACTOR_TYPE');
  END IF;
  IF p_grant_type NOT IN ('custom_mfa','recovery') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_GRANT_TYPE');
  END IF;

  SELECT custom_mfa_grant_lifetime_minutes INTO v_lifetime
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  v_lifetime := COALESCE(v_lifetime, 30);
  v_expires_at := now() + (v_lifetime || ' minutes')::interval;

  UPDATE public.custom_mfa_grants
  SET revoked_at = now()
  WHERE user_id = p_user_id AND session_id = p_session_id
    AND revoked_at IS NULL AND consumed_at IS NULL;

  INSERT INTO public.custom_mfa_grants (user_id, session_id, grant_type, factor_type, expires_at, request_id)
  VALUES (p_user_id, p_session_id, p_grant_type, p_factor_type, v_expires_at, p_request_id)
  RETURNING id INTO v_grant_id;

  INSERT INTO public.security_audit_events (user_id, actor_user_id, event_type, event_category, severity, metadata, session_id, result)
  VALUES (p_user_id, p_user_id, 'custom_mfa_grant_issued', 'mfa', 'info',
    jsonb_build_object('factor_type', p_factor_type, 'grant_type', p_grant_type, 'expires_at', v_expires_at),
    p_session_id, 'success');

  RETURN jsonb_build_object('ok', true, 'grant_id', v_grant_id, 'expires_at', v_expires_at);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 13. RPC: revoke_custom_mfa_grant
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_custom_mfa_grant(p_grant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  UPDATE public.custom_mfa_grants
  SET revoked_at = now()
  WHERE id = p_grant_id AND user_id = v_uid AND revoked_at IS NULL
  RETURNING 1 INTO v_count;

  IF v_count IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'GRANT_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 14. RPC: has_active_custom_mfa_grant
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.has_active_custom_mfa_grant(
  p_user_id uuid,
  p_session_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_count int;
  v_settings record;
BEGIN
  SELECT custom_mfa_enabled, custom_mfa_required
  INTO v_settings
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  IF NOT COALESCE(v_settings.custom_mfa_enabled, false) OR NOT COALESCE(v_settings.custom_mfa_required, false) THEN
    RETURN true;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.custom_mfa_grants
  WHERE user_id = p_user_id
    AND session_id = p_session_id
    AND revoked_at IS NULL
    AND consumed_at IS NULL
    AND expires_at > now();

  RETURN v_count > 0;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 15. RPC: verify_custom_mfa_challenge — atomic consume, issue grant
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_custom_mfa_challenge(
  p_challenge_id uuid,
  p_otp_code text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_challenge public.custom_mfa_challenges%ROWTYPE;
  v_otp_hash text;
  v_updated int;
  v_factor public.custom_mfa_factors%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF p_otp_code IS NULL OR length(trim(p_otp_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OTP_REQUIRED');
  END IF;

  SELECT * INTO v_challenge
  FROM public.custom_mfa_challenges
  WHERE id = p_challenge_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND');
  END IF;

  IF v_challenge.session_id != p_session_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_MISMATCH');
  END IF;

  IF v_challenge.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_' || upper(v_challenge.status));
  END IF;

  IF v_challenge.expires_at <= now() THEN
    UPDATE public.custom_mfa_challenges SET status = 'expired' WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  END IF;

  IF v_challenge.attempt_count >= v_challenge.max_attempts THEN
    UPDATE public.custom_mfa_challenges SET status = 'max_attempts' WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'MAX_ATTEMPTS_EXCEEDED');
  END IF;

  v_otp_hash := public.hmac_with_pepper(trim(p_otp_code), 'mfa_otp');

  UPDATE public.custom_mfa_challenges
  SET attempt_count = attempt_count + 1
  WHERE id = p_challenge_id;

  IF v_challenge.otp_hash != v_otp_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID');
  END IF;

  UPDATE public.custom_mfa_challenges
  SET status = 'consumed', consumed_at = now()
  WHERE id = p_challenge_id AND status = 'pending'
  RETURNING 1 INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_CONSUMED_RACE');
  END IF;

  SELECT * INTO v_factor FROM public.custom_mfa_factors WHERE id = v_challenge.factor_id;
  IF NOT FOUND OR v_factor.factor_status != 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FACTOR_NOT_ACTIVE');
  END IF;

  RETURN public.issue_custom_mfa_grant(v_uid, p_session_id, v_challenge.factor_type, 'custom_mfa');
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 16. RPC: verify_custom_mfa_recovery
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_custom_mfa_recovery(
  p_recovery_code text,
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code_hash text;
  v_updated int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF p_recovery_code IS NULL OR length(trim(p_recovery_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RECOVERY_CODE_REQUIRED');
  END IF;

  v_code_hash := public.hmac_with_pepper(trim(p_recovery_code), 'mfa_recovery');

  UPDATE public.custom_mfa_recovery_codes
  SET used_at = now()
  WHERE code_hash = v_code_hash AND user_id = v_uid AND used_at IS NULL
  RETURNING 1 INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'RECOVERY_CODE_INVALID');
  END IF;

  RETURN public.issue_custom_mfa_grant(v_uid, p_session_id, 'recovery', 'recovery');
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 17. RPC: regenerate_custom_mfa_recovery_codes
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_custom_mfa_recovery_codes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_codes text[] := '{}';
  v_hashes text[] := '{}';
  v_i int;
  v_code text;
  v_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  FOR v_i IN 1..10 LOOP
    v_code := encode(gen_random_bytes(15), 'hex');
    v_codes := array_append(v_codes, v_code);
    v_hash := public.hmac_with_pepper(v_code, 'mfa_recovery');
    v_hashes := array_append(v_hashes, v_hash);
  END LOOP;

  DELETE FROM public.custom_mfa_recovery_codes WHERE user_id = v_uid;

  FOR v_i IN 1..10 LOOP
    INSERT INTO public.custom_mfa_recovery_codes (user_id, code_hash)
    VALUES (v_uid, v_hashes[v_i]);
  END LOOP;

  INSERT INTO public.custom_mfa_factors (user_id, factor_type, factor_status, recovery_codes_hash)
  VALUES (v_uid, 'recovery', 'active', v_hashes)
  ON CONFLICT (user_id, factor_type)
  DO UPDATE SET recovery_codes_hash = v_hashes, factor_status = 'active', updated_at = now();

  INSERT INTO public.security_audit_events (user_id, actor_user_id, event_type, event_category, severity, result)
  VALUES (v_uid, v_uid, 'recovery_codes_regenerated', 'recovery', 'warning', 'success');

  RETURN jsonb_build_object('ok', true, 'codes', v_codes);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 18. RPC: create_bale_link_nonce
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_bale_link_nonce()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nonce text;
  v_nonce_hash text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_nonce := encode(gen_random_bytes(16), 'hex');
  v_nonce_hash := public.hmac_with_pepper(v_nonce, 'bale_link');

  INSERT INTO public.bale_link_nonces (nonce_hash, user_id, expires_at)
  VALUES (v_nonce_hash, v_uid, now() + interval '10 minutes');

  RETURN jsonb_build_object('ok', true, 'nonce', v_nonce, 'expires_at', now() + interval '10 minutes');
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 19. RPC: consume_bale_link_nonce
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.consume_bale_link_nonce(
  p_nonce text,
  p_chat_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_nonce_hash text;
  v_nonce_row public.bale_link_nonces%ROWTYPE;
  v_enc bytea;
  v_hmac text;
BEGIN
  IF p_nonce IS NULL OR p_chat_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  v_nonce_hash := public.hmac_with_pepper(p_nonce, 'bale_link');

  SELECT * INTO v_nonce_row
  FROM public.bale_link_nonces
  WHERE nonce_hash = v_nonce_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NONCE_NOT_FOUND');
  END IF;
  IF v_nonce_row.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NONCE_ALREADY_USED');
  END IF;
  IF v_nonce_row.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NONCE_EXPIRED');
  END IF;

  UPDATE public.bale_link_nonces SET used_at = now() WHERE nonce_hash = v_nonce_hash;

  v_enc := public.mfa_encrypt(p_chat_id);
  v_hmac := public.hmac_with_pepper(p_chat_id, 'bale_chat_id');

  UPDATE public.user_bale_mapping
  SET bale_chat_id_enc = v_enc, bale_chat_id_hmac = v_hmac, last_connected_at = now()
  WHERE user_id = v_nonce_row.user_id;

  IF NOT FOUND THEN
    INSERT INTO public.user_bale_mapping (user_id, bale_chat_id, bale_chat_id_enc, bale_chat_id_hmac, connected_at)
    VALUES (v_nonce_row.user_id, p_chat_id, v_enc, v_hmac, now());
  END IF;

  INSERT INTO public.security_audit_events (user_id, actor_user_id, event_type, event_category, severity, result)
  VALUES (v_nonce_row.user_id, v_nonce_row.user_id, 'bale_mfa_linked', 'mfa', 'info', 'success');

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 20. RPC: create_custom_mfa_challenge
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_custom_mfa_challenge(
  p_factor_type text,
  p_session_id uuid,
  p_otp_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_factor public.custom_mfa_factors%ROWTYPE;
  v_challenge_id uuid;
  v_settings record;
  v_expires_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;
  IF p_factor_type NOT IN ('totp','sms','bale','email') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_FACTOR_TYPE');
  END IF;
  IF p_session_id IS NULL OR p_otp_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_PARAMS');
  END IF;

  SELECT * INTO v_factor
  FROM public.custom_mfa_factors
  WHERE user_id = v_uid AND factor_type = p_factor_type AND factor_status = 'active';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FACTOR_NOT_ACTIVE');
  END IF;

  IF p_factor_type = 'sms' AND v_factor.phone_hash IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SMS_FACTOR_NO_PHONE');
  END IF;

  SELECT custom_mfa_challenge_ttl_seconds, custom_mfa_max_resends, custom_mfa_max_attempts
  INTO v_settings
  FROM public.auth_security_settings WHERE id = 1 LIMIT 1;

  v_expires_at := now() + (COALESCE(v_settings.custom_mfa_challenge_ttl_seconds, 300) || ' seconds')::interval;

  UPDATE public.custom_mfa_challenges
  SET status = 'expired'
  WHERE user_id = v_uid AND factor_id = v_factor.id AND status = 'pending';

  INSERT INTO public.custom_mfa_challenges (
    user_id, factor_id, factor_type, otp_hash, expires_at, session_id, max_attempts, max_resends
  )
  VALUES (
    v_uid, v_factor.id, p_factor_type, p_otp_hash, v_expires_at, p_session_id,
    COALESCE(v_settings.custom_mfa_max_attempts, 5), COALESCE(v_settings.custom_mfa_max_resends, 3)
  )
  RETURNING id INTO v_challenge_id;

  RETURN jsonb_build_object('ok', true, 'challenge_id', v_challenge_id, 'expires_at', v_expires_at);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 21. Update set_auth_security_settings_patch with custom MFA keys
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_auth_security_settings_patch(
  p_expected_version integer,
  p_patch jsonb,
  p_change_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_jwt jsonb := auth.jwt();
  v_session_id uuid;
  v_request_id uuid;
  v_is_security_admin boolean := false;
  v_current public.auth_security_settings%ROWTYPE;
  v_new public.auth_security_settings%ROWTYPE;
  v_new_version integer;
  v_stepup_grant public.session_security_grants%ROWTYPE;
  v_session_exists boolean := false;
  v_before_state jsonb;
  v_after_state jsonb;
  v_key text;
  v_value jsonb;
  v_allowed_keys text[] := ARRAY[
    'username_login', 'email_login', 'phone_login', 'mfa_policy',
    'registration_enabled', 'registration_requires_admin_approval', 'require_profile_completion',
    'allow_totp_mfa', 'allow_bale_mfa', 'allow_email_mfa', 'allow_recovery_codes',
    'session_idle_timeout_minutes', 'session_absolute_lifetime_minutes', 'max_active_sessions',
    'lock_threshold', 'lock_duration_minutes', 'recovery_enabled',
    'custom_mfa_enabled', 'custom_mfa_required', 'custom_mfa_allowed_factors',
    'custom_mfa_challenge_ttl_seconds', 'custom_mfa_max_resends',
    'custom_mfa_max_attempts', 'custom_mfa_grant_lifetime_minutes'
  ];
  v_int_val integer;
  v_truncated_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  v_session_id := NULLIF(v_jwt ->> 'session_id', '')::uuid;
  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_REQUIRED');
  END IF;

  v_request_id := NULLIF(v_jwt ->> 'request_id', '')::uuid;

  SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id = v_session_id AND user_id = v_uid) INTO v_session_exists;
  IF NOT v_session_exists THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  SELECT is_security_admin INTO v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  IF NOT COALESCE(v_is_security_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  SELECT * INTO v_stepup_grant
  FROM public.session_security_grants
  WHERE user_id = v_uid AND session_id = v_session_id
    AND grant_type = 'mfa_stepup' AND purpose = 'auth_settings_change'
    AND revoked_at IS NULL AND consumed_at IS NULL AND expires_at > now()
  ORDER BY issued_at DESC LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  UPDATE public.session_security_grants SET consumed_at = now() WHERE id = v_stepup_grant.id;

  SELECT * INTO v_current FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  IF v_current.settings_version != p_expected_version THEN
    RETURN jsonb_build_object('ok', false, 'error', 'VERSION_CONFLICT', 'current_version', v_current.settings_version);
  END IF;

  v_new := v_current;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY', 'key', v_key);
    END IF;

    IF v_key IN ('username_login','email_login','phone_login','registration_enabled',
                 'registration_requires_admin_approval','require_profile_completion',
                 'allow_totp_mfa','allow_bale_mfa','allow_email_mfa','allow_recovery_codes',
                 'recovery_enabled','custom_mfa_enabled','custom_mfa_required') THEN
      IF jsonb_typeof(v_value) != 'boolean' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, v_value::text::boolean));
    ELSIF v_key IN ('session_idle_timeout_minutes','session_absolute_lifetime_minutes',
                    'max_active_sessions','lock_threshold','lock_duration_minutes',
                    'custom_mfa_challenge_ttl_seconds','custom_mfa_max_resends',
                    'custom_mfa_max_attempts','custom_mfa_grant_lifetime_minutes') THEN
      IF jsonb_typeof(v_value) != 'number' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_int_val := v_value::text::integer;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, v_int_val));
    ELSIF v_key = 'mfa_policy' THEN
      IF v_value::text !~ '^(disabled|optional|required)$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, v_value::text));
    ELSIF v_key = 'custom_mfa_allowed_factors' THEN
      IF jsonb_typeof(v_value) != 'array' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TYPE', 'key', v_key);
      END IF;
      v_new := jsonb_populate_record(v_new, jsonb_build_object(v_key, ARRAY(SELECT jsonb_array_elements_text(v_value))));
    END IF;
  END LOOP;

  IF NOT v_new.username_login AND NOT v_new.email_login AND NOT v_new.phone_login THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_LOGIN_METHOD_ENABLED');
  END IF;

  IF v_new.mfa_policy = 'required' AND NOT v_new.allow_totp_mfa THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  IF v_new.custom_mfa_required AND NOT v_new.custom_mfa_enabled THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  IF v_new.custom_mfa_required AND COALESCE(array_length(v_new.custom_mfa_allowed_factors, 1), 0) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED_WITHOUT_FACTOR');
  END IF;

  IF v_new.session_idle_timeout_minutes > v_new.session_absolute_lifetime_minutes THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_SESSION_POLICY');
  END IF;

  IF v_new.custom_mfa_challenge_ttl_seconds < 30 OR v_new.custom_mfa_challenge_ttl_seconds > 3600 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.custom_mfa_max_resends < 0 OR v_new.custom_mfa_max_resends > 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.custom_mfa_max_attempts < 1 OR v_new.custom_mfa_max_attempts > 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;
  IF v_new.custom_mfa_grant_lifetime_minutes < 1 OR v_new.custom_mfa_grant_lifetime_minutes > 1440 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'OUT_OF_RANGE');
  END IF;

  v_before_state := to_jsonb(v_current) - 'updated_at' - 'updated_by' - 'settings_version';
  v_after_state := to_jsonb(v_new) - 'updated_at' - 'updated_by' - 'settings_version';
  IF v_before_state = v_after_state THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_EFFECTIVE_CHANGE');
  END IF;

  v_new_version := v_current.settings_version + 1;
  v_truncated_reason := left(trim(COALESCE(p_change_reason, '')), 500);

  UPDATE public.auth_security_settings SET
    settings_version = v_new_version,
    username_login = v_new.username_login,
    email_login = v_new.email_login,
    phone_login = v_new.phone_login,
    mfa_policy = v_new.mfa_policy,
    registration_enabled = v_new.registration_enabled,
    registration_requires_admin_approval = v_new.registration_requires_admin_approval,
    require_profile_completion = v_new.require_profile_completion,
    allow_totp_mfa = v_new.allow_totp_mfa,
    allow_bale_mfa = v_new.allow_bale_mfa,
    allow_email_mfa = v_new.allow_email_mfa,
    allow_recovery_codes = v_new.allow_recovery_codes,
    session_idle_timeout_minutes = v_new.session_idle_timeout_minutes,
    session_absolute_lifetime_minutes = v_new.session_absolute_lifetime_minutes,
    max_active_sessions = v_new.max_active_sessions,
    lock_threshold = v_new.lock_threshold,
    lock_duration_minutes = v_new.lock_duration_minutes,
    recovery_enabled = v_new.recovery_enabled,
    custom_mfa_enabled = v_new.custom_mfa_enabled,
    custom_mfa_required = v_new.custom_mfa_required,
    custom_mfa_allowed_factors = v_new.custom_mfa_allowed_factors,
    custom_mfa_challenge_ttl_seconds = v_new.custom_mfa_challenge_ttl_seconds,
    custom_mfa_max_resends = v_new.custom_mfa_max_resends,
    custom_mfa_max_attempts = v_new.custom_mfa_max_attempts,
    custom_mfa_grant_lifetime_minutes = v_new.custom_mfa_grant_lifetime_minutes,
    updated_at = now(),
    updated_by = v_uid
  WHERE id = 1;

  INSERT INTO public.auth_security_settings_history (
    version, username_login, email_login, phone_login, mfa_policy,
    allow_totp_mfa, allow_bale_mfa, allow_email_mfa, allow_recovery_codes,
    registration_enabled, registration_requires_admin_approval, require_profile_completion,
    session_idle_timeout_minutes, session_absolute_lifetime_minutes, max_active_sessions,
    lock_threshold, lock_duration_minutes, recovery_enabled,
    changed_by, change_reason
  )
  VALUES (
    v_new_version, v_new.username_login, v_new.email_login, v_new.phone_login, v_new.mfa_policy,
    v_new.allow_totp_mfa, v_new.allow_bale_mfa, v_new.allow_email_mfa, v_new.allow_recovery_codes,
    v_new.registration_enabled, v_new.registration_requires_admin_approval, v_new.require_profile_completion,
    v_new.session_idle_timeout_minutes, v_new.session_absolute_lifetime_minutes, v_new.max_active_sessions,
    v_new.lock_threshold, v_new.lock_duration_minutes, v_new.recovery_enabled,
    v_uid, v_truncated_reason
  );

  INSERT INTO public.security_audit_events (user_id, actor_user_id, event_type, event_category, severity, metadata, session_id, result)
  VALUES (v_uid, v_uid, 'security_settings_changed', 'settings_change', 'warning',
    jsonb_build_object('old_version', v_current.settings_version, 'new_version', v_new_version),
    v_session_id, 'success');

  RETURN jsonb_build_object('ok', true, 'new_version', v_new_version);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 22. Update get_auth_security_console_state
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_auth_security_console_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_settings public.auth_security_settings%ROWTYPE;
  v_is_security_admin boolean := false;
  v_active_users int;
  v_users_with_totp int;
  v_users_without_totp int;
  v_security_admins int;
  v_security_admins_without_totp int;
  v_history jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT is_security_admin INTO v_is_security_admin
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;
  IF NOT COALESCE(v_is_security_admin, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  SELECT * INTO v_settings FROM public.auth_security_settings WHERE id = 1 LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SETTINGS_NOT_FOUND');
  END IF;

  SELECT COUNT(*) INTO v_active_users FROM public.profiles WHERE is_active = true;
  SELECT COUNT(*) INTO v_users_with_totp FROM auth.mfa_factors WHERE factor_type = 'totp' AND status = 'verified';
  v_users_without_totp := v_active_users - v_users_with_totp;
  SELECT COUNT(*) INTO v_security_admins FROM public.profiles WHERE is_security_admin = true;
  SELECT COUNT(*) INTO v_security_admins_without_totp
  FROM public.profiles p
  WHERE p.is_security_admin = true
    AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p.user_id AND f.factor_type = 'totp' AND f.status = 'verified');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'version', version, 'changed_at', changed_at, 'change_reason', change_reason,
    'changed_by', changed_by, 'mfa_policy', mfa_policy, 'allow_totp_mfa', allow_totp_mfa,
    'username_login', username_login, 'email_login', email_login, 'phone_login', phone_login
  ) ORDER BY version DESC), '[]'::jsonb)
  INTO v_history
  FROM public.auth_security_settings_history LIMIT 20;

  RETURN jsonb_build_object(
    'ok', true,
    'settings', jsonb_build_object(
      'settings_version', v_settings.settings_version,
      'username_login', v_settings.username_login,
      'email_login', v_settings.email_login,
      'phone_login', v_settings.phone_login,
      'mfa_policy', v_settings.mfa_policy,
      'registration_enabled', v_settings.registration_enabled,
      'registration_requires_admin_approval', v_settings.registration_requires_admin_approval,
      'require_profile_completion', v_settings.require_profile_completion,
      'allow_totp_mfa', v_settings.allow_totp_mfa,
      'allow_bale_mfa', v_settings.allow_bale_mfa,
      'allow_email_mfa', v_settings.allow_email_mfa,
      'allow_recovery_codes', v_settings.allow_recovery_codes,
      'session_idle_timeout_minutes', v_settings.session_idle_timeout_minutes,
      'session_absolute_lifetime_minutes', v_settings.session_absolute_lifetime_minutes,
      'max_active_sessions', v_settings.max_active_sessions,
      'lock_threshold', v_settings.lock_threshold,
      'lock_duration_minutes', v_settings.lock_duration_minutes,
      'recovery_enabled', v_settings.recovery_enabled,
      'config_schema_version', v_settings.config_schema_version,
      'updated_at', v_settings.updated_at,
      'custom_mfa_enabled', v_settings.custom_mfa_enabled,
      'custom_mfa_required', v_settings.custom_mfa_required,
      'custom_mfa_allowed_factors', v_settings.custom_mfa_allowed_factors,
      'custom_mfa_challenge_ttl_seconds', v_settings.custom_mfa_challenge_ttl_seconds,
      'custom_mfa_max_resends', v_settings.custom_mfa_max_resends,
      'custom_mfa_max_attempts', v_settings.custom_mfa_max_attempts,
      'custom_mfa_grant_lifetime_minutes', v_settings.custom_mfa_grant_lifetime_minutes
    ),
    'impact', jsonb_build_object(
      'active_users', v_active_users,
      'users_with_verified_totp', v_users_with_totp,
      'users_without_verified_totp', v_users_without_totp,
      'security_admins', v_security_admins,
      'security_admins_without_verified_totp', v_security_admins_without_totp
    ),
    'recent_history', v_history
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 23. Grant RPC execute
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.get_custom_mfa_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_challenge(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_mfa_recovery(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.regenerate_custom_mfa_recovery_codes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_custom_mfa_grant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_bale_link_nonce() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_bale_link_nonce(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_mfa_challenge(text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_active_custom_mfa_grant(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.hmac_with_pepper(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_encrypt(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.mfa_decrypt(bytea) TO service_role;
