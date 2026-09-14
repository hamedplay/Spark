BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

-- Keep the malformed-phone detector independent from older helper migrations so
-- this repair can be applied safely to installations where the original
-- migration history was removed. A canonical Iranian mobile number may be
-- stored as 09xxxxxxxxx, 9xxxxxxxxx, 989xxxxxxxxx or 00989xxxxxxxxx.
CREATE OR REPLACE FUNCTION private.is_legacy_malformed_phone_value(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH normalized AS (
    SELECT regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') AS digits
  )
  SELECT p_phone IS NOT NULL
     AND btrim(p_phone) <> ''
     AND NOT EXISTS (
       SELECT 1
       FROM normalized
       WHERE digits ~ '^00989[0-9]{9}$'
          OR digits ~ '^989[0-9]{9}$'
          OR digits ~ '^09[0-9]{9}$'
          OR digits ~ '^9[0-9]{9}$'
     );
$$;

CREATE OR REPLACE FUNCTION private.list_malformed_phone_records()
RETURNS TABLE(
  user_id uuid,
  email text,
  profile_phone text,
  auth_phone text,
  profile_problem boolean,
  auth_problem boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.is_security_admin IS TRUE
      AND p.is_active IS TRUE
      AND p.account_status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'SECURITY_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email::text,
    p.phone::text,
    u.phone::text,
    private.is_legacy_malformed_phone_value(p.phone),
    private.is_legacy_malformed_phone_value(u.phone)
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE private.is_legacy_malformed_phone_value(p.phone)
     OR private.is_legacy_malformed_phone_value(u.phone)
  ORDER BY lower(COALESCE(u.email::text, '')), u.id;
END;
$$;

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
  v_auth_phone text;
  v_profile_phone text;
  v_auth_problem boolean;
  v_profile_problem boolean;
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

  SELECT g.id
  INTO v_grant_id
  FROM public.session_security_grants g
  WHERE g.user_id = v_actor
    AND g.session_id = v_session_id
    AND g.grant_type = 'mfa_stepup'
    AND g.purpose = 'auth_settings_change'
    AND g.revoked_at IS NULL
    AND g.consumed_at IS NULL
    AND g.expires_at > now()
  ORDER BY g.issued_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_grant_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

  SELECT u.phone::text, p.phone::text
  INTO v_auth_phone, v_profile_phone
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id = u.id
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_NOT_FOUND');
  END IF;

  v_auth_problem := private.is_legacy_malformed_phone_value(v_auth_phone);
  v_profile_problem := private.is_legacy_malformed_phone_value(v_profile_phone);

  IF NOT v_auth_problem AND NOT v_profile_problem THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PHONE_ALREADY_CANONICAL');
  END IF;

  IF v_profile_problem THEN
    UPDATE public.profiles
    SET phone = NULL,
        updated_at = now()
    WHERE user_id = p_user_id;
  END IF;

  IF v_auth_problem THEN
    UPDATE auth.users
    SET phone = NULL,
        phone_confirmed_at = NULL,
        phone_change = '',
        phone_change_token = '',
        phone_change_sent_at = NULL,
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        updated_at = now()
    WHERE id = p_user_id;
  END IF;

  UPDATE public.session_security_grants
  SET consumed_at = now()
  WHERE id = v_grant_id
    AND consumed_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'STEPUP_REQUIRED');
  END IF;

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
    'malformed_phone_cleared',
    'settings_change',
    'warning',
    jsonb_build_object(
      'profile_phone_cleared', v_profile_problem,
      'auth_phone_cleared', v_auth_problem
    ),
    v_session_id,
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'profile_phone_cleared', v_profile_problem,
    'auth_phone_cleared', v_auth_problem
  );
END;
$$;

-- Public PostgREST-facing wrappers. SECURITY DEFINER keeps the private schema
-- implementation inaccessible while the private functions still enforce the
-- authenticated Security Admin and step-up requirements using auth.uid()/jwt.
CREATE OR REPLACE FUNCTION public.list_malformed_phone_records()
RETURNS TABLE(
  user_id uuid,
  email text,
  profile_phone text,
  auth_phone text,
  profile_problem boolean,
  auth_problem boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT * FROM private.list_malformed_phone_records();
$$;

CREATE OR REPLACE FUNCTION public.clear_malformed_phone_record(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT private.clear_malformed_phone_record($1::uuid);
$$;

REVOKE ALL ON FUNCTION private.is_legacy_malformed_phone_value(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.list_malformed_phone_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.clear_malformed_phone_record(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.list_malformed_phone_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_malformed_phone_record(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_malformed_phone_records() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_malformed_phone_record(uuid) TO authenticated, service_role;

-- Force PostgREST to refresh the RPC schema immediately after deployment.
NOTIFY pgrst, 'reload schema';

COMMIT;
