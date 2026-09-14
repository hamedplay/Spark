BEGIN;

CREATE OR REPLACE FUNCTION private.clear_malformed_phone_record(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_session_id uuid;
  v_grant_id uuid;
  v_target_email text;
  v_target_phone text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = v_actor
      AND p.is_security_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  BEGIN
    v_session_id := NULLIF(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END;

  IF v_session_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM auth.sessions s
    WHERE s.id = v_session_id
      AND s.user_id = v_actor
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  END IF;

  -- session_security_grants has no revoked_at column. Grants are invalidated by
  -- consuming them (consumed_at), exactly like private.issue_totp_stepup_grant.
  SELECT g.id
  INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_actor
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'auth_settings_change'
    AND g.factor_type = 'totp'
    AND g.assurance_level = 'aal2'
    AND g.consumed_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  SELECT u.email::text, u.phone::text
  INTO v_target_email, v_target_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = p_user_id
    AND p.user_id IS NULL
    AND u.deleted_at IS NULL
    AND (
      (u.phone IS NOT NULL AND btrim(u.phone) <> '')
      OR (
        u.email IS NOT NULL
        AND btrim(u.email) <> ''
        AND u.email NOT ILIKE '%@auth.spark.invalid'
      )
    )
  FOR UPDATE OF u;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ORPHAN_AUTH_USER_NOT_ELIGIBLE');
  END IF;

  BEGIN
    UPDATE public.session_security_grants
    SET consumed_at = now()
    WHERE id = v_grant_id
      AND consumed_at IS NULL;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
    END IF;

    DELETE FROM auth.users
    WHERE id = p_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'TARGET_DISAPPEARED' USING ERRCODE = 'P0001';
    END IF;
  EXCEPTION
    WHEN foreign_key_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'USER_HAS_REFERENCES');
    WHEN raise_exception THEN
      RETURN jsonb_build_object('ok', false, 'error', 'ORPHAN_AUTH_USER_NOT_ELIGIBLE');
  END;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    event_type,
    event_category,
    severity,
    metadata,
    session_id,
    result
  ) VALUES (
    p_user_id,
    v_actor,
    'orphan_auth_user_deleted',
    'settings_change',
    'warning',
    jsonb_build_object(
      'had_phone', v_target_phone IS NOT NULL AND btrim(v_target_phone) <> '',
      'had_real_email', v_target_email IS NOT NULL AND btrim(v_target_email) <> '' AND v_target_email NOT ILIKE '%@auth.spark.invalid'
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'user_deleted', true
  );
END;
$$;

REVOKE ALL ON FUNCTION private.clear_malformed_phone_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_malformed_phone_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clear_malformed_phone_record(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
