/*
# Unified Phone Auth & Recovery Architecture

## Purpose
Replaces the fragmented phone auth configuration (operator confirmations, test modes,
E2E flags, DB-stored pepper) with two canonical feature flags and runtime-computed
readiness checks. Removes legacy flags from the decision path without deleting them.

## Changes

### 1. New Feature Flags (system_config)
- `phone_login_canonical_enabled` (boolean, default false) — canonical toggle for phone OTP login
- `phone_password_recovery_canonical_enabled` (boolean, default false) — canonical toggle for password recovery
- `phone_password_recovery_secret_configured` (boolean, proxy for env var)

### 2. Replaced RPC: get_public_auth_config
- Dropped and recreated with simplified + new canonical columns
- Legacy columns still returned (as false/defaults) for backward compatibility
- New computed fields: phone_login_canonical_enabled/ready, phone_password_recovery_canonical_enabled/ready

### 3. New RPC: get_phone_auth_admin_status
- Admin-only runtime status (provider, templates, origins, sync stats, last dispatch)

### 4. New RPC: consume_phone_login_verify_rate_limit
- Rate limit for OTP verification attempts (5 per phone / 20 per IP per 15min)

### 5. New RPC: set_phone_auth_canonical_flags
- Admin-only setter for the two canonical feature flags

### 6. Schema: add purpose column to phone_otp_rate_limit

### Security
- No tables dropped, no data deleted
- Legacy keys remain in system_config but are no longer read by new RPCs
- All new RPCs are SECURITY DEFINER with explicit search_path
- REVOKE EXECUTE FROM PUBLIC on new RPCs, GRANT to authenticated/anon as appropriate
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. Drop old get_public_auth_config so we can recreate with new return columns
-- ═══════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS public.get_public_auth_config();

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. New canonical feature flags
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO public.system_config (section, key, value, description)
VALUES ('security', 'phone_login_canonical_enabled', 'false',
        'Canonical feature flag for phone OTP login (replaces legacy phone_login_enabled + operator confirmations)')
ON CONFLICT (section, key) DO NOTHING;

INSERT INTO public.system_config (section, key, value, description)
VALUES ('security', 'phone_password_recovery_canonical_enabled', 'false',
        'Canonical feature flag for password recovery via phone OTP (replaces legacy recovery_enabled + e2e + operator confirmations)')
ON CONFLICT (section, key) DO NOTHING;

INSERT INTO public.system_config (section, key, value, description)
VALUES ('security', 'phone_password_recovery_secret_configured', 'false',
        'Proxy flag: set to true when PHONE_PASSWORD_RESET_SECRET env var is configured (>=32 chars)')
ON CONFLICT (section, key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Recreate get_public_auth_config with canonical fields
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_public_auth_config()
RETURNS TABLE (
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
  recovery_ttl_seconds integer,
  phone_password_recovery_e2e_verified boolean,
  phone_login_canonical_enabled boolean,
  phone_login_canonical_ready boolean,
  phone_password_recovery_canonical_enabled boolean,
  phone_password_recovery_canonical_ready boolean
)
SET search_path = public
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_login_canonical boolean := false;
  v_recovery_canonical boolean := false;
  v_provider_id text := NULL;
  v_provider_active boolean := false;
  v_provider_ready boolean := false;
  v_origins_text text := '';
  v_origins_count int := 0;
  v_origins_set boolean := false;
  v_login_template_ready boolean := false;
  v_login_template_body text := '';
  v_recovery_template_ready boolean := false;
  v_recovery_template_body text := '';
  v_recovery_ttl_text text := '';
  v_recovery_ttl_seconds int := 0;
  v_recovery_ttl_valid boolean := false;
  v_recovery_secret_proxy boolean := false;
BEGIN
  SELECT (value = 'true') INTO v_login_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;
  v_login_canonical := COALESCE(v_login_canonical, false);

  SELECT (value = 'true') INTO v_recovery_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1;
  v_recovery_canonical := COALESCE(v_recovery_canonical, false);

  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;

  IF v_provider_id IS NOT NULL THEN
    BEGIN
      SELECT COALESCE(is_active, false) INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;
  v_provider_ready := v_provider_id IS NOT NULL AND COALESCE(v_provider_active, false);

  SELECT value INTO v_origins_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;
  v_origins_text := COALESCE(v_origins_text, '');
  IF btrim(v_origins_text) <> '' THEN
    SELECT COUNT(*) INTO v_origins_count
    FROM unnest(string_to_array(v_origins_text, ',')) AS elem
    WHERE btrim(elem) <> '';
  ELSE
    v_origins_count := 0;
  END IF;
  v_origins_set := v_origins_count > 0;

  BEGIN
    SELECT body INTO v_login_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_login_template_ready := false; END;

  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false; END;

  SELECT value INTO v_recovery_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
  BEGIN
    v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);
  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600; END;
  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

  SELECT (value = 'true') INTO v_recovery_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;
  v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);

  RETURN QUERY SELECT
    false,             -- phone_login_enabled (legacy)
    v_provider_ready,  -- provider_ready
    false,             -- operator_confirmed (legacy)
    false,             -- e2e_verified (legacy)
    false,             -- phone_login_test_mode (legacy)
    false,             -- phone_login_test_ready (legacy)
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set, -- phone_login_ready
    false,             -- otp_ttl_operator_confirmed (legacy)
    false,             -- phone_password_recovery_enabled (legacy)
    false,             -- phone_password_recovery_test_mode (legacy)
    false,             -- phone_password_recovery_test_ready (legacy)
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid, -- phone_password_recovery_ready
    v_recovery_template_ready,
    v_recovery_secret_proxy,
    v_recovery_ttl_valid,
    v_recovery_ttl_seconds,
    false,             -- phone_password_recovery_e2e_verified (legacy)
    v_login_canonical,
    v_login_canonical AND v_provider_ready AND v_login_template_ready AND v_origins_set,
    v_recovery_canonical,
    v_recovery_canonical AND v_provider_ready AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_public_auth_config() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_auth_config() TO anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. New RPC: get_phone_auth_admin_status
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_phone_auth_admin_status()
RETURNS jsonb
SET search_path = public
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_active boolean := false;
  v_login_canonical boolean := false;
  v_recovery_canonical boolean := false;
  v_provider_id text;
  v_provider_selected boolean := false;
  v_provider_active boolean := false;
  v_origins_text text := '';
  v_origins_count int := 0;
  v_origins_set boolean := false;
  v_login_template_ready boolean := false;
  v_login_template_body text;
  v_recovery_template_ready boolean := false;
  v_recovery_template_body text;
  v_recovery_ttl_text text := '';
  v_recovery_ttl_seconds int := 0;
  v_recovery_ttl_valid boolean := false;
  v_recovery_secret_proxy boolean := false;
  v_sync_matched int := 0;
  v_sync_auth_only int := 0;
  v_sync_profile_only int := 0;
  v_sync_mismatched int := 0;
  v_sync_duplicates int := 0;
  v_last_dispatch jsonb := NULL;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
  INTO v_is_admin, v_is_active
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND OR NOT v_is_active OR NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  SELECT (value = 'true') INTO v_login_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_canonical_enabled' LIMIT 1;
  v_login_canonical := COALESCE(v_login_canonical, false);

  SELECT (value = 'true') INTO v_recovery_canonical
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_canonical_enabled' LIMIT 1;
  v_recovery_canonical := COALESCE(v_recovery_canonical, false);

  SELECT value INTO v_provider_id
  FROM public.system_config WHERE section = 'sms' AND key = 'phone_login_sms_provider_id' LIMIT 1;
  v_provider_selected := v_provider_id IS NOT NULL AND btrim(v_provider_id) <> '';

  IF v_provider_selected THEN
    BEGIN
      SELECT COALESCE(is_active, false) INTO v_provider_active
      FROM public.sms_providers WHERE id = v_provider_id::uuid LIMIT 1;
    EXCEPTION WHEN OTHERS THEN v_provider_active := false; END;
  END IF;

  SELECT value INTO v_origins_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_login_allowed_origins' LIMIT 1;
  v_origins_text := COALESCE(v_origins_text, '');
  IF btrim(v_origins_text) <> '' THEN
    SELECT COUNT(*) INTO v_origins_count
    FROM unnest(string_to_array(v_origins_text, ',')) AS elem
    WHERE btrim(elem) <> '';
  ELSE
    v_origins_count := 0;
  END IF;
  v_origins_set := v_origins_count > 0;

  BEGIN
    SELECT body INTO v_login_template_body
    FROM public.sms_templates
    WHERE category = 'auth' AND event_type = 'login_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_login_template_ready := v_login_template_body IS NOT NULL AND v_login_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_login_template_ready := false; END;

  BEGIN
    SELECT body INTO v_recovery_template_body
    FROM public.notification_templates
    WHERE category = 'auth' AND event_type = 'password_reset_otp' AND audience = 'all' AND is_active = true
    LIMIT 1;
    v_recovery_template_ready := v_recovery_template_body IS NOT NULL AND v_recovery_template_body LIKE '%{{otp}}%';
  EXCEPTION WHEN OTHERS THEN v_recovery_template_ready := false; END;

  SELECT value INTO v_recovery_ttl_text
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_otp_ttl_seconds' LIMIT 1;
  BEGIN
    v_recovery_ttl_seconds := COALESCE(v_recovery_ttl_text::integer, 600);
  EXCEPTION WHEN OTHERS THEN v_recovery_ttl_seconds := 600; END;
  v_recovery_ttl_valid := v_recovery_ttl_seconds >= 60 AND v_recovery_ttl_seconds <= 86400;

  SELECT (value = 'true') INTO v_recovery_secret_proxy
  FROM public.system_config WHERE section = 'security' AND key = 'phone_password_recovery_secret_configured' LIMIT 1;
  v_recovery_secret_proxy := COALESCE(v_recovery_secret_proxy, false);

  BEGIN
    SELECT COUNT(*) INTO v_sync_matched
    FROM public.profiles p
    INNER JOIN auth.users u ON u.id = p.user_id
    WHERE p.phone IS NOT NULL AND btrim(p.phone) <> ''
    AND u.phone IS NOT NULL AND btrim(u.phone) <> ''
    AND public.normalize_iran_phone(p.phone) = public.normalize_iran_phone(u.phone);
  EXCEPTION WHEN OTHERS THEN v_sync_matched := 0; END;

  BEGIN
    SELECT COUNT(*) INTO v_sync_auth_only
    FROM public.profiles p
    INNER JOIN auth.users u ON u.id = p.user_id
    WHERE (p.phone IS NULL OR btrim(p.phone) = '') AND u.phone IS NOT NULL AND btrim(u.phone) <> '';
  EXCEPTION WHEN OTHERS THEN v_sync_auth_only := 0; END;

  BEGIN
    SELECT COUNT(*) INTO v_sync_profile_only
    FROM public.profiles p
    INNER JOIN auth.users u ON u.id = p.user_id
    WHERE p.phone IS NOT NULL AND btrim(p.phone) <> '' AND (u.phone IS NULL OR btrim(u.phone) = '');
  EXCEPTION WHEN OTHERS THEN v_sync_profile_only := 0; END;

  BEGIN
    SELECT COUNT(*) INTO v_sync_mismatched
    FROM public.profiles p
    INNER JOIN auth.users u ON u.id = p.user_id
    WHERE p.phone IS NOT NULL AND btrim(p.phone) <> ''
    AND u.phone IS NOT NULL AND btrim(u.phone) <> ''
    AND public.normalize_iran_phone(p.phone) <> public.normalize_iran_phone(u.phone);
  EXCEPTION WHEN OTHERS THEN v_sync_mismatched := 0; END;

  BEGIN
    WITH normalized_phones AS (
      SELECT public.normalize_iran_phone(p.phone) AS nphone
      FROM public.profiles p
      WHERE p.phone IS NOT NULL AND btrim(p.phone) <> ''
    )
    SELECT COUNT(*) INTO v_sync_duplicates
    FROM (
      SELECT nphone, COUNT(*) AS cnt
      FROM normalized_phones
      WHERE nphone <> ''
      GROUP BY nphone
      HAVING COUNT(*) > 1
    ) dup;
  EXCEPTION WHEN OTHERS THEN v_sync_duplicates := 0; END;

  BEGIN
    SELECT jsonb_build_object(
      'status', sms_dispatch_logs.status,
      'created_at', sms_dispatch_logs.created_at,
      'event_type', sms_dispatch_logs.event_type
    ) INTO v_last_dispatch
    FROM public.sms_dispatch_logs
    WHERE category = 'auth'
    ORDER BY created_at DESC
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN v_last_dispatch := NULL; END;

  RETURN jsonb_build_object(
    'ok', true,
    'phone_login_canonical_enabled', v_login_canonical,
    'phone_login_canonical_ready', v_login_canonical AND v_provider_active AND v_login_template_ready AND v_origins_set,
    'phone_password_recovery_canonical_enabled', v_recovery_canonical,
    'phone_password_recovery_canonical_ready', v_recovery_canonical AND v_provider_active AND v_recovery_template_ready AND v_origins_set AND v_recovery_secret_proxy AND v_recovery_ttl_valid,
    'provider_selected', v_provider_selected,
    'provider_active', v_provider_active,
    'login_template_ready', v_login_template_ready,
    'recovery_template_ready', v_recovery_template_ready,
    'recovery_ttl_valid', v_recovery_ttl_valid,
    'recovery_ttl_seconds', v_recovery_ttl_seconds,
    'recovery_secret_configured', v_recovery_secret_proxy,
    'origins_set', v_origins_set,
    'origins_count', v_origins_count,
    'sync_matched', v_sync_matched,
    'sync_auth_only', v_sync_auth_only,
    'sync_profile_only', v_sync_profile_only,
    'sync_mismatched', v_sync_mismatched,
    'sync_duplicates', v_sync_duplicates,
    'last_dispatch', v_last_dispatch
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_phone_auth_admin_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_phone_auth_admin_status() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. New RPC: consume_phone_login_verify_rate_limit
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.consume_phone_login_verify_rate_limit(
  p_phone_hash text,
  p_ip_hash text
)
RETURNS json
SET search_path = public
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := now();
  v_window timestamptz := v_now - interval '15 minutes';
  v_phone_count int;
  v_ip_count int;
  v_phone_limit int := 5;
  v_ip_limit int := 20;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('vphone:' || p_phone_hash, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('vip:' || p_ip_hash, 0));

  SELECT count(*) INTO v_phone_count
  FROM public.phone_otp_rate_limit
  WHERE phone_hash = p_phone_hash AND purpose = 'phone_login_verify' AND created_at >= v_window;

  SELECT count(*) INTO v_ip_count
  FROM public.phone_otp_rate_limit
  WHERE ip_hash = p_ip_hash AND purpose = 'phone_login_verify' AND created_at >= v_window;

  IF v_phone_count >= v_phone_limit THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  IF v_ip_count >= v_ip_limit THEN
    RETURN json_build_object('allowed', false, 'retry_after_seconds', 900);
  END IF;

  INSERT INTO public.phone_otp_rate_limit (phone_hash, ip_hash, purpose)
  VALUES (p_phone_hash, p_ip_hash, 'phone_login_verify');

  RETURN json_build_object('allowed', true, 'retry_after_seconds', 0);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('allowed', false, 'retry_after_seconds', 900);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_phone_login_verify_rate_limit(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_phone_login_verify_rate_limit(text, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. New RPC: set_phone_auth_canonical_flags
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.set_phone_auth_canonical_flags(
  p_login_enabled boolean DEFAULT NULL,
  p_recovery_enabled boolean DEFAULT NULL
)
RETURNS jsonb
SET search_path = public
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean := false;
  v_is_active boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT COALESCE(is_admin, false), COALESCE(is_active, false)
  INTO v_is_admin, v_is_active
  FROM public.profiles WHERE user_id = v_uid LIMIT 1;

  IF NOT FOUND OR NOT v_is_active OR NOT v_is_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF p_login_enabled IS NOT NULL THEN
    INSERT INTO public.system_config (section, key, value, description)
    VALUES ('security', 'phone_login_canonical_enabled', p_login_enabled::text,
            'Canonical feature flag for phone OTP login')
    ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  IF p_recovery_enabled IS NOT NULL THEN
    INSERT INTO public.system_config (section, key, value, description)
    VALUES ('security', 'phone_password_recovery_canonical_enabled', p_recovery_enabled::text,
            'Canonical feature flag for password recovery via phone OTP')
    ON CONFLICT (section, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_phone_auth_canonical_flags(boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_phone_auth_canonical_flags(boolean, boolean) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Add purpose column to phone_otp_rate_limit if missing
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'phone_otp_rate_limit'
    AND column_name = 'purpose'
  ) THEN
    ALTER TABLE public.phone_otp_rate_limit ADD COLUMN purpose text DEFAULT 'phone_login';
  END IF;
END $$;
