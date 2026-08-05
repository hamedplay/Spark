/*
# Phase 4 — Registration Challenge Tables, Rate Limit, OTP Config

## Summary
Creates the public registration challenge infrastructure: challenge table,
rate limit table, OTP config entries, SMS template, and secret proxy.

## New Tables
1. public_registration_challenges
   - Stores hashed identity + OTP challenge for public registration
   - Never stores raw email/username/phone/OTP/password
   - Only postgres and service_role can access

2. public_registration_rate_limit
   - Tracks registration request and verify attempts by identity/phone/IP
   - Only postgres and service_role can access

## New Config (system_config, insert-if-missing)
- security.registration_phone_otp_ttl_seconds = 300
- security.registration_phone_otp_resend_seconds = 60
- security.registration_phone_otp_secret_configured = false

## New SMS Template (insert-if-missing)
- category=auth, event_type=registration_phone_otp, audience=all
- body contains {{otp}}

## Safety
- No prior migration modified
- No data deleted
- No MFA policy changed
*/

-- ════════════════════════════════════════════════════════════
-- 1. public_registration_challenges
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.public_registration_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash text NOT NULL,
  email_hash text NOT NULL,
  username_hash text NOT NULL,
  phone_hash text NOT NULL,
  otp_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  expires_at timestamptz NOT NULL,
  locked_until timestamptz,
  processing_claim_id uuid,
  processing_started_at timestamptz,
  processing_expires_at timestamptz,
  created_user_id uuid,
  request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

ALTER TABLE public.public_registration_challenges ENABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_challenges FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_challenges FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON public.public_registration_challenges TO service_role;

CREATE INDEX IF NOT EXISTS idx_registration_challenges_identity
  ON public.public_registration_challenges (identity_hash, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_challenges_phone
  ON public.public_registration_challenges (phone_hash, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_challenges_created_user
  ON public.public_registration_challenges (created_user_id)
  WHERE created_user_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════
-- 2. public_registration_rate_limit
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.public_registration_rate_limit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_hash text,
  phone_hash text,
  ip_hash text,
  purpose text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.public_registration_rate_limit ENABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_rate_limit FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.public_registration_rate_limit FROM authenticated;

GRANT SELECT, INSERT, DELETE ON public.public_registration_rate_limit TO service_role;

CREATE INDEX IF NOT EXISTS idx_registration_rate_limit_identity
  ON public.public_registration_rate_limit (identity_hash, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_rate_limit_phone
  ON public.public_registration_rate_limit (phone_hash, purpose, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_registration_rate_limit_ip
  ON public.public_registration_rate_limit (ip_hash, purpose, created_at DESC);

-- ════════════════════════════════════════════════════════════
-- 3. OTP Config entries (insert-if-missing)
-- ════════════════════════════════════════════════════════════

INSERT INTO public.system_config (section, key, value, description)
SELECT 'security', 'registration_phone_otp_ttl_seconds', '300', 'TTL for registration phone OTP in seconds'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_ttl_seconds'
);

INSERT INTO public.system_config (section, key, value, description)
SELECT 'security', 'registration_phone_otp_resend_seconds', '60', 'Resend cooldown for registration phone OTP in seconds'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_resend_seconds'
);

INSERT INTO public.system_config (section, key, value, description)
SELECT 'security', 'registration_phone_otp_secret_configured', 'false', 'Proxy indicating whether REGISTRATION_PHONE_OTP_SECRET is configured'
WHERE NOT EXISTS (
  SELECT 1 FROM public.system_config WHERE section = 'security' AND key = 'registration_phone_otp_secret_configured'
);

-- ════════════════════════════════════════════════════════════
-- 4. Registration SMS Template (insert-if-missing, do NOT overwrite)
-- ════════════════════════════════════════════════════════════

INSERT INTO public.sms_templates (id, category, event_type, audience, subject, body, placeholders, is_active)
SELECT
  gen_random_uuid(),
  'auth',
  'registration_phone_otp',
  'all',
  'کد تأیید ثبت‌نام',
  'کد تأیید ثبت‌نام شما در سامانه: {{otp}}',
  ARRAY['{{otp}}']::text[],
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.sms_templates
  WHERE category = 'auth' AND event_type = 'registration_phone_otp' AND audience = 'all'
);

-- ════════════════════════════════════════════════════════════
-- 5. Registration RPCs (service_role only)
-- ════════════════════════════════════════════════════════════

-- create_public_registration_challenge
CREATE OR REPLACE FUNCTION public.create_public_registration_challenge(
  p_identity_hash text,
  p_email_hash text,
  p_username_hash text,
  p_phone_hash text,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_request_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_challenge_id uuid;
BEGIN
  INSERT INTO public.public_registration_challenges (
    identity_hash, email_hash, username_hash, phone_hash, otp_hash,
    expires_at, request_id
  ) VALUES (
    p_identity_hash, p_email_hash, p_username_hash, p_phone_hash, p_otp_hash,
    p_expires_at, p_request_id
  )
  RETURNING id INTO v_challenge_id;

  RETURN v_challenge_id;
END;
$function$;

ALTER FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_registration_challenge(text, text, text, text, text, timestamptz, uuid) TO service_role;

-- claim_public_registration_challenge
CREATE OR REPLACE FUNCTION public.claim_public_registration_challenge(
  p_challenge_id uuid,
  p_identity_hash text,
  p_otp_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_challenge record;
  v_claim_id uuid := gen_random_uuid();
BEGIN
  SELECT * INTO v_challenge
  FROM public.public_registration_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_NOT_FOUND');
  END IF;

  IF v_challenge.status = 'consumed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_CONSUMED', 'created_user_id', v_challenge.created_user_id);
  END IF;

  IF v_challenge.status = 'locked' OR (v_challenge.locked_until IS NOT NULL AND v_challenge.locked_until > now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_LOCKED');
  END IF;

  IF v_challenge.expires_at <= now() THEN
    UPDATE public.public_registration_challenges SET status = 'expired', updated_at = now()
    WHERE id = p_challenge_id;
    RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_EXPIRED');
  END IF;

  IF v_challenge.identity_hash != p_identity_hash THEN
    RETURN jsonb_build_object('ok', false, 'error', 'IDENTITY_MISMATCH');
  END IF;

  IF v_challenge.otp_hash != p_otp_hash THEN
    UPDATE public.public_registration_challenges
    SET attempt_count = attempt_count + 1, updated_at = now()
    WHERE id = p_challenge_id;

    IF attempt_count + 1 >= max_attempts THEN
      UPDATE public.public_registration_challenges
      SET status = 'locked', locked_until = now() + interval '30 minutes', updated_at = now()
      WHERE id = p_challenge_id;
      RETURN jsonb_build_object('ok', false, 'error', 'CHALLENGE_LOCKED');
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'OTP_INVALID');
  END IF;

  -- Claim the challenge
  UPDATE public.public_registration_challenges
  SET status = 'processing',
      processing_claim_id = v_claim_id,
      processing_started_at = now(),
      processing_expires_at = now() + interval '5 minutes',
      updated_at = now()
  WHERE id = p_challenge_id;

  RETURN jsonb_build_object('ok', true, 'claim_id', v_claim_id);
END;
$function$;

ALTER FUNCTION public.claim_public_registration_challenge(uuid, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge(uuid, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_public_registration_challenge(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_registration_challenge(uuid, text, text) TO service_role;

-- finalize_public_registration_challenge
CREATE OR REPLACE FUNCTION public.finalize_public_registration_challenge(
  p_challenge_id uuid,
  p_created_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.public_registration_challenges
  SET status = 'consumed',
      created_user_id = p_created_user_id,
      consumed_at = now(),
      processing_claim_id = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL,
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'processing';

  RETURN FOUND;
END;
$function$;

ALTER FUNCTION public.finalize_public_registration_challenge(uuid, uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.finalize_public_registration_challenge(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.finalize_public_registration_challenge(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_public_registration_challenge(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_public_registration_challenge(uuid, uuid) TO service_role;

-- release_public_registration_claim
CREATE OR REPLACE FUNCTION public.release_public_registration_claim(
  p_challenge_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.public_registration_challenges
  SET status = 'pending',
      processing_claim_id = NULL,
      processing_started_at = NULL,
      processing_expires_at = NULL,
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'processing';
END;
$function$;

ALTER FUNCTION public.release_public_registration_claim(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_public_registration_claim(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_public_registration_claim(uuid) TO service_role;

-- mark_registration_delivery_failed
CREATE OR REPLACE FUNCTION public.mark_registration_delivery_failed(
  p_challenge_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.public_registration_challenges
  SET status = 'delivery_failed',
      updated_at = now()
  WHERE id = p_challenge_id
    AND status = 'pending';
END;
$function$;

ALTER FUNCTION public.mark_registration_delivery_failed(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_registration_delivery_failed(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_registration_delivery_failed(uuid) TO service_role;

-- consume_public_registration_rate_limit
CREATE OR REPLACE FUNCTION public.consume_public_registration_rate_limit(
  p_identity_hash text,
  p_phone_hash text,
  p_ip_hash text,
  p_purpose text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.public_registration_rate_limit (identity_hash, phone_hash, ip_hash, purpose)
  VALUES (p_identity_hash, p_phone_hash, p_ip_hash, p_purpose);
END;
$function$;

ALTER FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.consume_public_registration_rate_limit(text, text, text, text) TO service_role;
