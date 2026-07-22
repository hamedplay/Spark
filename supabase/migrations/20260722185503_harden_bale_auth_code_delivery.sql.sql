-- ─── Additive: processing_expires_at + RPCs + grants + cleanup ─────────────

-- 1. Add processing_expires_at column
ALTER TABLE bale_auth_code_dispatches
  ADD COLUMN IF NOT EXISTS processing_expires_at timestamptz;

-- 2. Explicit grants for bale_auth_code_dispatches (service_role only)
REVOKE ALL ON bale_auth_code_dispatches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bale_auth_code_dispatches TO service_role;

-- 3. Admin-scoped RPC: set_bale_auth_otp_config
CREATE OR REPLACE FUNCTION set_bale_auth_otp_config(
  p_key text,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
  v_allowed_keys text[] := ARRAY['phone_login_bale_otp_enabled', 'phone_password_recovery_bale_otp_enabled'];
  v_new_val text;
  v_updated_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  SELECT is_active, is_admin INTO v_profile
  FROM profiles
  WHERE user_id = v_uid;

  IF NOT FOUND OR v_profile.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PROFILE_INACTIVE');
  END IF;

  IF v_profile.is_admin IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;

  IF NOT (p_key = ANY(v_allowed_keys)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_KEY');
  END IF;

  v_new_val := CASE WHEN p_enabled THEN 'true' ELSE 'false' END;

  UPDATE system_config
  SET value = v_new_val, updated_at = now()
  WHERE section = 'security' AND key = p_key;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONFIG_NOT_FOUND');
  END IF;

  INSERT INTO audit_log (user_id, module, action, entity_name, details, severity)
  VALUES (v_uid, 'security', 'bale_otp_config_updated',
          'security.' || p_key,
          'مقدار جدید: ' || v_new_val,
          'warning');

  RETURN jsonb_build_object('ok', true, 'key', p_key, 'value', v_new_val);
END;
$$;

REVOKE ALL ON FUNCTION set_bale_auth_otp_config(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_bale_auth_otp_config(text, boolean) TO authenticated;

-- 4. Owner-scoped RPC: set_my_bale_auth_codes_enabled
CREATE OR REPLACE FUNCTION set_my_bale_auth_codes_enabled(
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  UPDATE user_bale_mapping
  SET auth_codes_enabled = p_enabled
  WHERE user_id = v_uid;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'MAPPING_NOT_FOUND');
  END IF;

  RETURN jsonb_build_object('ok', true, 'enabled', p_enabled);
END;
$$;

REVOKE ALL ON FUNCTION set_my_bale_auth_codes_enabled(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION set_my_bale_auth_codes_enabled(boolean) TO authenticated;

-- 5. Service-scoped RPC: cleanup_bale_auth_code_dispatches
CREATE OR REPLACE FUNCTION cleanup_bale_auth_code_dispatches()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_count int;
  v_retention_count int;
BEGIN
  -- Expire stuck processing records (>5 min)
  UPDATE bale_auth_code_dispatches
  SET status = 'failed', error_code = 'PROCESSING_EXPIRED', completed_at = now()
  WHERE status = 'processing'
    AND processing_expires_at IS NOT NULL
    AND processing_expires_at < now();

  GET DIAGNOSTICS v_expired_count = ROW_COUNT;

  -- Delete completed records older than 90 days
  DELETE FROM bale_auth_code_dispatches
  WHERE completed_at IS NOT NULL
    AND completed_at < (now() - interval '90 days');

  GET DIAGNOSTICS v_retention_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'expired', v_expired_count,
    'retention_deleted', v_retention_count
  );
END;
$$;

REVOKE ALL ON FUNCTION cleanup_bale_auth_code_dispatches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION cleanup_bale_auth_code_dispatches() TO service_role;
