/*
# Make Password Recovery Challenges Atomic and Enumeration-Safe

## Summary
Adds new challenge statuses, atomic RPCs for rate limiting, challenge
creation, OTP verification, completion claiming, and finalization.
Replaces non-atomic count-then-insert patterns with single-transaction
advisory-locked operations. Adds resolve RPC to find target user without
listing all users in JavaScript.

## New Columns on phone_password_reset_challenges (all additive)
- otp_attempt_count integer NOT NULL DEFAULT 0 — tracks OTP verification attempts
- complete_attempt_count integer NOT NULL DEFAULT 0 — tracks completion attempts
- processing_claim_id uuid — identifies the active completion claim
- processing_started_at timestamptz — when processing began
- updated_at timestamptz NOT NULL DEFAULT now() — last modification time

## Status Constraint Updated
Old: pending, verified, consumed, expired, locked
New: pending, verified, processing, consumed, expired, locked, delivery_failed

## Partial Unique Index
One active challenge (pending/verified/processing) per user_id.
Duplicate active challenges are expired before index creation.

## New RPCs (all SECURITY DEFINER, service_role only)
1. resolve_phone_password_reset_target(p_normalized_phone) — finds user_id
2. consume_phone_password_recovery_request_limit(...) — atomic rate limit
3. consume_phone_password_recovery_verify_limit(...) — atomic verify rate limit
4. consume_phone_password_recovery_complete_limit(...) — atomic complete rate limit
5. create_phone_password_reset_challenge(...) — atomic challenge creation
6. verify_phone_password_reset_challenge(...) — atomic OTP verification
7. claim_phone_password_reset_completion(...) — atomic completion claim
8. finalize_phone_password_reset_completion(...) — finalize after password change
9. revalidate_phone_password_reset_target(...) — re-check user/phone before verify/complete
10. set_phone_password_recovery_test_mode(...) — admin test mode toggle

## Security
- All new RPCs: SECURITY DEFINER, SET search_path='', revoke from PUBLIC/anon/authenticated
- resolve/revalidate: service_role only
- Rate limit RPCs: service_role only
- Challenge RPCs: service_role only
- Test mode RPC: authenticated only (admin check inside)
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Add new columns
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.phone_password_reset_challenges
  ADD COLUMN IF NOT EXISTS otp_attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.phone_password_reset_challenges
  ADD COLUMN IF NOT EXISTS complete_attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.phone_password_reset_challenges
  ADD COLUMN IF NOT EXISTS processing_claim_id uuid;
ALTER TABLE public.phone_password_reset_challenges
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;
ALTER TABLE public.phone_password_reset_challenges
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Update status constraint
-- ═══════════════════════════════════════════════════════════════════════
ALTER TABLE public.phone_password_reset_challenges DROP CONSTRAINT IF EXISTS chk_challenge_status;
ALTER TABLE public.phone_password_reset_challenges ADD CONSTRAINT chk_challenge_status CHECK (
  status IN ('pending', 'verified', 'processing', 'consumed', 'expired', 'locked', 'delivery_failed')
);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Expire duplicate active challenges, keep newest per user
-- ═══════════════════════════════════════════════════════════════════════
WITH ranked AS (
  SELECT id, user_id, status, created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC
    ) AS rn
  FROM public.phone_password_reset_challenges
  WHERE status IN ('pending', 'verified', 'processing')
)
UPDATE public.phone_password_reset_challenges c
SET status = 'expired', updated_at = now()
FROM ranked r
WHERE c.id = r.id AND r.rn > 1;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Partial unique index — one active challenge per user
-- ═══════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS idx_pprc_one_active_per_user
  ON public.phone_password_reset_challenges (user_id)
  WHERE status IN ('pending', 'verified', 'processing');

-- ═══════════════════════════════════════════════════════════════════════
-- 5. updated_at trigger
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.trigger_set_pprc_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pprc_updated_at ON public.phone_password_reset_challenges;
CREATE TRIGGER trg_pprc_updated_at
  BEFORE UPDATE ON public.phone_password_reset_challenges
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_pprc_updated_at();

-- ═══════════════════════════════════════════════════════════════════════
-- 6. resolve_phone_password_reset_target
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resolve_phone_password_reset_target(
  p_normalized_phone text
)
RETURNS TABLE(user_id uuid, resolved_phone_hash text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile_count int;
  v_profile_user_id uuid;
  v_profile_phone text;
  v_auth_count int;
  v_auth_user_id uuid;
  v_auth_phone text;
BEGIN
  -- Find active profiles with matching phone
  SELECT count(*), user_id, phone
  INTO v_profile_count, v_profile_user_id, v_profile_phone
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone
  GROUP BY user_id, phone
  LIMIT 1;

  -- Actually we need to count all matching profiles, not just one
  SELECT count(*)
  INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone;

  IF v_profile_count = 0 OR v_profile_count > 1 THEN
    RETURN;
  END IF;

  SELECT user_id, phone
  INTO v_profile_user_id, v_profile_phone
  FROM public.profiles
  WHERE is_active = true
    AND phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone
  LIMIT 1;

  -- Find auth users with matching phone
  SELECT count(*)
  INTO v_auth_count
  FROM auth.users
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone;

  IF v_auth_count = 0 OR v_auth_count > 1 THEN
    RETURN;
  END IF;

  SELECT id, phone
  INTO v_auth_user_id, v_auth_phone
  FROM auth.users
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = p_normalized_phone
  LIMIT 1;

  -- user_id must match
  IF v_auth_user_id IS NULL OR v_auth_user_id <> v_profile_user_id THEN
    RETURN;
  END IF;

  -- Return user_id and a deterministic phone hash for comparison
  -- We use a simple hash of the normalized phone for the challenge phone_hash
  -- The edge function will compute HMAC separately; this just returns user_id
  RETURN QUERY SELECT v_profile_user_id, p_normalized_phone;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_phone_password_reset_target(text) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. consume_phone_password_recovery_request_limit
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_phone_password_recovery_request_limit(
  p_phone_hash text,
  p_ip_hash text,
  p_purpose text,
  p_phone_limit integer,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_phone_count int;
  v_ip_count int;
  v_window_start timestamptz;
  v_phone_lock_key bigint;
  v_ip_lock_key bigint;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::interval;

  -- Deterministic advisory lock keys from phone_hash and ip_hash
  v_phone_lock_key := ('x' || substr(md5(p_phone_hash), 1, 15))::bit(60)::bigint;
  v_ip_lock_key := ('x' || substr(md5(p_ip_hash), 1, 15))::bit(60)::bigint;

  -- Lock phone first, then IP (fixed order)
  PERFORM pg_advisory_xact_lock(v_phone_lock_key);
  PERFORM pg_advisory_xact_lock(v_ip_lock_key);

  -- Count existing records
  SELECT count(*) INTO v_phone_count
  FROM public.phone_otp_rate_limit
  WHERE phone_hash = p_phone_hash
    AND purpose = p_purpose
    AND created_at >= v_window_start;

  SELECT count(*) INTO v_ip_count
  FROM public.phone_otp_rate_limit
  WHERE ip_hash = p_ip_hash
    AND purpose = p_purpose
    AND created_at >= v_window_start;

  IF v_phone_count >= p_phone_limit OR v_ip_count >= p_ip_limit THEN
    RETURN QUERY SELECT false, p_window_seconds;
    RETURN;
  END IF;

  -- Insert rate limit record
  INSERT INTO public.phone_otp_rate_limit (phone_hash, ip_hash, purpose)
  VALUES (p_phone_hash, p_ip_hash, p_purpose);

  RETURN QUERY SELECT true, 0::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_request_limit(text, text, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. consume_phone_password_recovery_verify_limit
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_phone_password_recovery_verify_limit(
  p_ip_hash text,
  p_purpose text,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ip_count int;
  v_window_start timestamptz;
  v_ip_lock_key bigint;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::interval;
  v_ip_lock_key := ('x' || substr(md5(p_ip_hash), 1, 15))::bit(60)::bigint;

  PERFORM pg_advisory_xact_lock(v_ip_lock_key);

  SELECT count(*) INTO v_ip_count
  FROM public.phone_otp_rate_limit
  WHERE ip_hash = p_ip_hash
    AND purpose = p_purpose
    AND created_at >= v_window_start;

  IF v_ip_count >= p_ip_limit THEN
    RETURN QUERY SELECT false, p_window_seconds;
    RETURN;
  END IF;

  INSERT INTO public.phone_otp_rate_limit (phone_hash, ip_hash, purpose)
  VALUES ('verify', p_ip_hash, p_purpose);

  RETURN QUERY SELECT true, 0::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_verify_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. consume_phone_password_recovery_complete_limit
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.consume_phone_password_recovery_complete_limit(
  p_ip_hash text,
  p_purpose text,
  p_ip_limit integer,
  p_window_seconds integer
)
RETURNS TABLE(allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ip_count int;
  v_window_start timestamptz;
  v_ip_lock_key bigint;
BEGIN
  v_window_start := now() - (p_window_seconds || ' seconds')::interval;
  v_ip_lock_key := ('x' || substr(md5(p_ip_hash), 1, 15))::bit(60)::bigint;

  PERFORM pg_advisory_xact_lock(v_ip_lock_key);

  SELECT count(*) INTO v_ip_count
  FROM public.phone_otp_rate_limit
  WHERE ip_hash = p_ip_hash
    AND purpose = p_purpose
    AND created_at >= v_window_start;

  IF v_ip_count >= p_ip_limit THEN
    RETURN QUERY SELECT false, p_window_seconds;
    RETURN;
  END IF;

  INSERT INTO public.phone_otp_rate_limit (phone_hash, ip_hash, purpose)
  VALUES ('complete', p_ip_hash, p_purpose);

  RETURN QUERY SELECT true, 0::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_phone_password_recovery_complete_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 10. create_phone_password_reset_challenge
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_phone_password_reset_challenge(
  p_user_id uuid,
  p_phone_hash text,
  p_otp_hash text,
  p_expires_at timestamptz
)
RETURNS TABLE(challenge_id uuid, success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lock_key bigint;
  v_new_id uuid := gen_random_uuid();
BEGIN
  v_lock_key := ('x' || substr(md5(p_user_id::text), 1, 15))::bit(60)::bigint;
  PERFORM pg_advisory_xact_lock(v_lock_key);

  -- Expire all previous pending/verified challenges for this user
  UPDATE public.phone_password_reset_challenges
  SET status = 'expired', updated_at = now()
  WHERE user_id = p_user_id
    AND status IN ('pending', 'verified');

  -- Insert new challenge
  INSERT INTO public.phone_password_reset_challenges (
    id, user_id, phone_hash, otp_hash, status, expires_at, max_attempts
  ) VALUES (
    v_new_id, p_user_id, p_phone_hash, p_otp_hash, 'pending', p_expires_at, 5
  );

  RETURN QUERY SELECT v_new_id, true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.create_phone_password_reset_challenge(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 11. verify_phone_password_reset_challenge
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.verify_phone_password_reset_challenge(
  p_challenge_id uuid,
  p_provided_otp_hash text,
  p_reset_token_hash text,
  p_reset_expires_at timestamptz
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
  v_new_otp_attempt int;
BEGIN
  -- Lock the challenge row
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Must be pending
  IF v_challenge.status <> 'pending' THEN
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check expiry
  IF v_challenge.expires_at < now() THEN
    UPDATE public.phone_password_reset_challenges
    SET status = 'expired', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check locked
  IF v_challenge.locked_until IS NOT NULL AND v_challenge.locked_until > now() THEN
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check max attempts
  IF v_challenge.otp_attempt_count >= v_challenge.max_attempts THEN
    UPDATE public.phone_password_reset_challenges
    SET status = 'locked', locked_until = now() + interval '1 hour', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Increment attempt count
  v_new_otp_attempt := v_challenge.otp_attempt_count + 1;

  -- Compare OTP hash
  IF v_challenge.otp_hash <> p_provided_otp_hash THEN
    -- Wrong OTP
    IF v_new_otp_attempt >= v_challenge.max_attempts THEN
      UPDATE public.phone_password_reset_challenges
      SET otp_attempt_count = v_new_otp_attempt,
          status = 'locked',
          locked_until = now() + interval '1 hour',
          updated_at = now()
      WHERE id = p_challenge_id;
    ELSE
      UPDATE public.phone_password_reset_challenges
      SET otp_attempt_count = v_new_otp_attempt, updated_at = now()
      WHERE id = p_challenge_id;
    END IF;
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- OTP correct — transition to verified
  UPDATE public.phone_password_reset_challenges
  SET status = 'verified',
      otp_attempt_count = v_new_otp_attempt,
      otp_hash = 'consumed',
      reset_token_hash = p_reset_token_hash,
      reset_expires_at = p_reset_expires_at,
      verified_at = now(),
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'pending';

  IF NOT FOUND THEN
    -- Race: another request already verified
    RETURN QUERY SELECT false, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_phone_password_reset_challenge(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 12. claim_phone_password_reset_completion
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_phone_password_reset_completion(
  p_challenge_id uuid,
  p_provided_reset_token_hash text,
  p_claim_id uuid
)
RETURNS TABLE(success boolean, user_id uuid, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
  v_new_complete_attempt int;
BEGIN
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Must be verified
  IF v_challenge.status <> 'verified' THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check reset token expiry
  IF v_challenge.reset_expires_at IS NOT NULL AND v_challenge.reset_expires_at < now() THEN
    UPDATE public.phone_password_reset_challenges
    SET status = 'expired', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Check max complete attempts
  IF v_challenge.complete_attempt_count >= v_challenge.max_attempts THEN
    UPDATE public.phone_password_reset_challenges
    SET status = 'locked', locked_until = now() + interval '1 hour', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Verify reset token hash
  IF v_challenge.reset_token_hash IS NULL OR v_challenge.reset_token_hash <> p_provided_reset_token_hash THEN
    v_new_complete_attempt := v_challenge.complete_attempt_count + 1;
    IF v_new_complete_attempt >= v_challenge.max_attempts THEN
      UPDATE public.phone_password_reset_challenges
      SET complete_attempt_count = v_new_complete_attempt,
          status = 'locked',
          locked_until = now() + interval '1 hour',
          updated_at = now()
      WHERE id = p_challenge_id;
    ELSE
      UPDATE public.phone_password_reset_challenges
      SET complete_attempt_count = v_new_complete_attempt, updated_at = now()
      WHERE id = p_challenge_id;
    END IF;
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  -- Claim: transition verified → processing
  UPDATE public.phone_password_reset_challenges
  SET status = 'processing',
      processing_claim_id = p_claim_id,
      processing_started_at = now(),
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'verified';

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, NULL::uuid, 'INVALID_OR_EXPIRED'::text;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_challenge.user_id, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_phone_password_reset_completion(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 13. finalize_phone_password_reset_completion
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.finalize_phone_password_reset_completion(
  p_challenge_id uuid,
  p_claim_id uuid,
  p_success boolean
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_challenge record;
BEGIN
  SELECT * INTO v_challenge
  FROM public.phone_password_reset_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'NOT_FOUND'::text;
    RETURN;
  END IF;

  -- Must be processing with matching claim_id
  IF v_challenge.status <> 'processing' OR v_challenge.processing_claim_id IS NULL OR v_challenge.processing_claim_id <> p_claim_id THEN
    RETURN QUERY SELECT false, 'CLAIM_MISMATCH'::text;
    RETURN;
  END IF;

  IF p_success THEN
    -- Finalize as consumed
    UPDATE public.phone_password_reset_challenges
    SET status = 'consumed',
        consumed_at = now(),
        reset_token_hash = NULL,
        processing_claim_id = NULL,
        processing_started_at = NULL,
        updated_at = now()
    WHERE id = p_challenge_id;

    -- Expire all other challenges for this user
    UPDATE public.phone_password_reset_challenges
    SET status = 'expired', updated_at = now()
    WHERE user_id = v_challenge.user_id
      AND id <> p_challenge_id
      AND status IN ('pending', 'verified');

    RETURN QUERY SELECT true, NULL::text;
  ELSE
    -- Release claim: back to verified, increment attempt
    DECLARE
      v_new_attempt int := v_challenge.complete_attempt_count + 1;
    BEGIN
      IF v_new_attempt >= v_challenge.max_attempts THEN
        UPDATE public.phone_password_reset_challenges
        SET status = 'locked',
            locked_until = now() + interval '1 hour',
            complete_attempt_count = v_new_attempt,
            processing_claim_id = NULL,
            processing_started_at = NULL,
            updated_at = now()
        WHERE id = p_challenge_id;
      ELSE
        UPDATE public.phone_password_reset_challenges
        SET status = 'verified',
            complete_attempt_count = v_new_attempt,
            processing_claim_id = NULL,
            processing_started_at = NULL,
            updated_at = now()
        WHERE id = p_challenge_id;
      END IF;
      RETURN QUERY SELECT true, NULL::text;
    END;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_phone_password_reset_completion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 14. revalidate_phone_password_reset_target
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.revalidate_phone_password_reset_target(
  p_user_id uuid,
  p_expected_phone_hash text
)
RETURNS TABLE(valid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile record;
  v_auth_user record;
BEGIN
  -- Check profile exists and is active
  SELECT user_id, phone, is_active INTO v_profile
  FROM public.profiles
  WHERE user_id = p_user_id
  LIMIT 1;

  IF NOT FOUND OR v_profile.is_active <> true THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Check auth user exists
  SELECT id, phone INTO v_auth_user
  FROM auth.users
  WHERE id = p_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Auth user ID must match profile user_id (implicit since both queried by p_user_id)

  -- Normalized phones must match
  IF regexp_replace(v_auth_user.phone, '\D', '', 'g') <> regexp_replace(v_profile.phone, '\D', '', 'g') THEN
    RETURN QUERY SELECT false;
    RETURN;
  END IF;

  -- Phone hash must match (edge function computes HMAC, but we can't do HMAC in SQL easily)
  -- The edge function will compare the HMAC of the normalized phone against p_expected_phone_hash
  -- Here we just validate the user/profile/auth consistency
  RETURN QUERY SELECT true;
END;
$$;

REVOKE ALL ON FUNCTION public.revalidate_phone_password_reset_target(uuid, text) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 15. set_phone_password_recovery_test_mode
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_test_mode(
  p_enabled boolean,
  p_test_phone text
)
RETURNS TABLE(success boolean, masked_phone text, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_template_ready boolean := false;
  v_secret_confirmed boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds int := 0;
  v_public_enabled boolean := false;
  v_normalized_phone text;
  v_profile_count int;
  v_auth_count int;
  v_masked text;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, NULL::text, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, NULL::text, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  -- Disable path
  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';
    UPDATE public.system_config SET value = ''
    WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';
    RETURN QUERY SELECT true, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Enable path: all gates must pass

  -- Gate: public recovery must be false
  SELECT (value = 'true') INTO v_public_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_enabled' LIMIT 1;

  IF COALESCE(v_public_enabled, false) THEN
    RETURN QUERY SELECT false, NULL::text, 'TEST_MODE_STILL_ACTIVE'::text;
    RETURN;
  END IF;

  -- Gate: provider ready
  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  IF NOT v_provider_ready THEN
    RETURN QUERY SELECT false, NULL::text, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: template ready
  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  IF NOT v_template_ready THEN
    RETURN QUERY SELECT false, NULL::text, 'TEMPLATE_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: secret confirmed
  SELECT (value = 'true') INTO v_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;

  IF NOT COALESCE(v_secret_confirmed, false) THEN
    RETURN QUERY SELECT false, NULL::text, 'SECRET_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
  SELECT value INTO v_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;

  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN v_ttl_seconds := 0; END;

  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  -- Gate: test phone must be valid and unique
  v_normalized_phone := regexp_replace(p_test_phone, '\D', '', 'g');
  IF v_normalized_phone !~ '^989\d{9}$' THEN
    RETURN QUERY SELECT false, NULL::text, 'INVALID_PHONE'::text;
    RETURN;
  END IF;

  SELECT count(*) INTO v_profile_count
  FROM public.profiles
  WHERE is_active = true AND phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = v_normalized_phone;

  SELECT count(*) INTO v_auth_count
  FROM auth.users
  WHERE phone IS NOT NULL
    AND regexp_replace(phone, '\D', '', 'g') = v_normalized_phone;

  IF v_profile_count <> 1 OR v_auth_count <> 1 THEN
    RETURN QUERY SELECT false, NULL::text, 'PHONE_NOT_UNIQUE'::text;
    RETURN;
  END IF;

  -- All gates passed — enable test mode
  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_test_mode';
  UPDATE public.system_config SET value = p_test_phone
  WHERE section = 'security' AND key = 'phone_password_recovery_test_phone';

  -- Mask phone: 98912345678 → 98912****78
  v_masked := substr(v_normalized_phone, 1, 5) || '****' || substr(v_normalized_phone, length(v_normalized_phone) - 1);

  RETURN QUERY SELECT true, v_masked, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_test_mode(boolean, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 16. Update get_public_auth_config for new readiness logic
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.get_public_auth_config();

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE(
  phone_login_enabled boolean,
  provider_ready boolean,
  operator_confirmed boolean,
  e2e_verified boolean,
  phone_login_test_mode boolean,
  phone_login_test_ready boolean,
  phone_login_ready boolean,
  otp_ttl_operator_confirmed boolean,
  phone_password_recovery_enabled boolean,
  phone_password_recovery_test_mode boolean,
  phone_password_recovery_test_ready boolean,
  phone_password_recovery_ready boolean,
  recovery_template_ready boolean,
  recovery_secret_confirmed boolean,
  recovery_ttl_valid boolean,
  recovery_ttl_seconds integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_login_enabled boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_operator_confirmed boolean := false;
  v_login_e2e boolean := false;
  v_test_mode boolean := false;
  v_otp_ttl_confirmed boolean := false;
  v_provider_ready boolean := false;

  v_recovery_enabled boolean := false;
  v_recovery_e2e boolean := false;
  v_recovery_test_mode boolean := false;
  v_recovery_test_phone text := '';
  v_recovery_secret_confirmed boolean := false;
  v_recovery_otp_ttl text := '';
  v_recovery_ttl_seconds int := 0;
  v_recovery_ttl_valid boolean := false;

  v_template_ready boolean := false;
BEGIN
  -- Login config
  SELECT (value = 'true') INTO v_login_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_enabled' LIMIT 1;

  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  SELECT (value = 'true') INTO v_operator_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_hook_operator_confirmed' LIMIT 1;

  SELECT (value = 'true') INTO v_login_e2e
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_e2e_verified' LIMIT 1;

  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_test_mode' LIMIT 1;

  SELECT (value = 'true') INTO v_otp_ttl_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_otp_ttl_operator_confirmed' LIMIT 1;

  -- Recovery config
  SELECT (value = 'true') INTO v_recovery_enabled
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_enabled' LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_e2e
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified' LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_test_mode
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_test_mode' LIMIT 1;

  SELECT value INTO v_recovery_test_phone
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_test_phone' LIMIT 1;

  SELECT (value = 'true') INTO v_recovery_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;

  SELECT value INTO v_recovery_otp_ttl
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;

  BEGIN
    v_recovery_ttl_seconds := v_recovery_otp_ttl::integer;
  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 0; END;
  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;

  RETURN QUERY SELECT
    -- Login fields
    v_login_enabled,
    v_provider_ready,
    COALESCE(v_operator_confirmed, false),
    COALESCE(v_login_e2e, false),
    COALESCE(v_test_mode, false),
    v_provider_ready AND COALESCE(v_operator_confirmed, false) AND COALESCE(v_otp_ttl_confirmed, false),
    v_login_enabled AND v_provider_ready AND COALESCE(v_operator_confirmed, false)
      AND COALESCE(v_otp_ttl_confirmed, false) AND COALESCE(v_login_e2e, false),
    COALESCE(v_otp_ttl_confirmed, false),
    -- Recovery fields
    COALESCE(v_recovery_enabled, false),
    COALESCE(v_recovery_test_mode, false),
    -- test_ready = provider_ready AND template_ready AND secret_confirmed AND ttl_valid
    v_provider_ready AND v_template_ready AND COALESCE(v_recovery_secret_confirmed, false) AND v_recovery_ttl_valid,
    -- ready = enabled AND test_ready AND e2e_verified
    COALESCE(v_recovery_enabled, false)
      AND v_provider_ready
      AND v_template_ready
      AND COALESCE(v_recovery_secret_confirmed, false)
      AND v_recovery_ttl_valid
      AND COALESCE(v_recovery_e2e, false),
    -- Extra fields for UI
    v_template_ready,
    COALESCE(v_recovery_secret_confirmed, false),
    v_recovery_ttl_valid,
    v_recovery_ttl_seconds;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 17. Update set_phone_password_recovery_config to check test mode
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.set_phone_password_recovery_config(boolean);

CREATE OR REPLACE FUNCTION public.set_phone_password_recovery_config(
  p_enabled boolean
)
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_e2e_verified boolean := false;
  v_secret_confirmed boolean := false;
  v_template_ready boolean := false;
  v_ttl_text text := '';
  v_ttl_seconds integer := 0;
  v_test_mode boolean := false;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  IF NOT p_enabled THEN
    UPDATE public.system_config SET value = 'false'
    WHERE section = 'security' AND key = 'phone_password_recovery_enabled';
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  -- Gate: test mode must be off
  SELECT (value = 'true') INTO v_test_mode
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_test_mode' LIMIT 1;
  IF COALESCE(v_test_mode, false) THEN
    RETURN QUERY SELECT false, 'TEST_MODE_STILL_ACTIVE'::text;
    RETURN;
  END IF;

  -- Gate: provider ready
  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;
  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT is_active INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid AND is_active = true LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);
  IF NOT v_provider_ready THEN
    RETURN QUERY SELECT false, 'PROVIDER_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: template ready
  BEGIN
    SELECT EXISTS(
      SELECT 1 FROM public.notification_templates
      WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    ) INTO v_template_ready;
  EXCEPTION WHEN OTHERS THEN v_template_ready := false; END;
  IF NOT v_template_ready THEN
    RETURN QUERY SELECT false, 'TEMPLATE_NOT_READY'::text;
    RETURN;
  END IF;

  -- Gate: secret confirmed
  SELECT (value = 'true') INTO v_secret_confirmed
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed' LIMIT 1;
  IF NOT COALESCE(v_secret_confirmed, false) THEN
    RETURN QUERY SELECT false, 'SECRET_NOT_CONFIRMED'::text;
    RETURN;
  END IF;

  -- Gate: E2E verified
  SELECT (value = 'true') INTO v_e2e_verified
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_e2e_verified' LIMIT 1;
  IF NOT COALESCE(v_e2e_verified, false) THEN
    RETURN QUERY SELECT false, 'E2E_NOT_VERIFIED'::text;
    RETURN;
  END IF;

  -- Gate: TTL valid
  SELECT value INTO v_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
  BEGIN
    v_ttl_seconds := v_ttl_text::integer;
  EXCEPTION WHEN OTHERS THEN v_ttl_seconds := 0; END;
  IF v_ttl_seconds < 60 OR v_ttl_seconds > 86400 THEN
    RETURN QUERY SELECT false, 'INVALID_TTL'::text;
    RETURN;
  END IF;

  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_enabled';
  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.set_phone_password_recovery_config(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_phone_password_recovery_config(boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 18. Confirm secret RPC for admin
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.confirm_phone_password_recovery_secret()
RETURNS TABLE(success boolean, error text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_uid uuid;
  v_is_admin boolean := false;
BEGIN
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RETURN QUERY SELECT false, 'NOT_AUTHENTICATED'::text;
    RETURN;
  END IF;

  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM public.profiles WHERE user_id = v_caller_uid LIMIT 1;

  IF NOT v_is_admin THEN
    RETURN QUERY SELECT false, 'NOT_ADMIN'::text;
    RETURN;
  END IF;

  UPDATE public.system_config SET value = 'true'
  WHERE section = 'security' AND key = 'phone_password_recovery_secret_operator_confirmed';

  RETURN QUERY SELECT true, NULL::text;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_phone_password_recovery_secret() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_phone_password_recovery_secret() TO authenticated;
