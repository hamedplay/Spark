CREATE OR REPLACE FUNCTION private.is_legacy_malformed_phone_value(p_phone text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $function$
  SELECT
    p_phone IS NOT NULL
    AND btrim(p_phone) ~ '\.0$'
    AND public.normalize_iran_phone(regexp_replace(btrim(p_phone), '\.0$', '')) <> '';
$function$;

REVOKE ALL ON FUNCTION private.is_legacy_malformed_phone_value(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.is_legacy_malformed_phone_value(text) FROM anon;
REVOKE ALL ON FUNCTION private.is_legacy_malformed_phone_value(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.list_malformed_phone_records()
RETURNS TABLE(
  user_id uuid,
  email text,
  profile_phone text,
  auth_phone text,
  profile_problem boolean,
  auth_problem boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  IF NOT private.is_current_security_admin() THEN
    RAISE EXCEPTION 'SECURITY_ADMIN_REQUIRED' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(au.id, p.user_id) AS user_id,
    COALESCE(p.email, au.email) AS email,
    p.phone AS profile_phone,
    au.phone AS auth_phone,
    private.is_legacy_malformed_phone_value(p.phone) AS profile_problem,
    private.is_legacy_malformed_phone_value(au.phone) AS auth_problem
  FROM auth.users au
  FULL JOIN public.profiles p ON p.user_id = au.id
  WHERE private.is_legacy_malformed_phone_value(p.phone)
     OR private.is_legacy_malformed_phone_value(au.phone)
  ORDER BY COALESCE(p.updated_at, au.updated_at, au.created_at) DESC NULLS LAST;
END;
$function$;

REVOKE ALL ON FUNCTION public.list_malformed_phone_records() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_malformed_phone_records() FROM anon;
GRANT EXECUTE ON FUNCTION public.list_malformed_phone_records() TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_malformed_phone_record(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_auth_phone text;
  v_profile_phone text;
  v_auth_problem boolean := false;
  v_profile_problem boolean := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'UNAUTHORIZED');
  END IF;

  IF NOT private.is_current_security_admin() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SECURITY_ADMIN_REQUIRED');
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_USER_ID');
  END IF;

  SELECT au.phone
    INTO v_auth_phone
  FROM auth.users au
  WHERE au.id = p_user_id
  FOR UPDATE;

  SELECT p.phone
    INTO v_profile_phone
  FROM public.profiles p
  WHERE p.user_id = p_user_id
  FOR UPDATE;

  v_auth_problem := private.is_legacy_malformed_phone_value(v_auth_phone);
  v_profile_problem := private.is_legacy_malformed_phone_value(v_profile_phone);

  IF NOT v_auth_problem AND NOT v_profile_problem THEN
    RETURN jsonb_build_object('ok', false, 'error', 'PHONE_NOT_MALFORMED');
  END IF;

  IF v_profile_problem THEN
    UPDATE public.profiles
    SET phone = NULL,
        phone_verified_at = NULL
    WHERE user_id = p_user_id
      AND private.is_legacy_malformed_phone_value(phone);
  END IF;

  IF v_auth_problem THEN
    UPDATE auth.users
    SET phone = NULL,
        phone_confirmed_at = NULL,
        phone_change = '',
        phone_change_token = '',
        phone_change_sent_at = NULL,
        updated_at = now()
    WHERE id = p_user_id
      AND private.is_legacy_malformed_phone_value(phone);
  END IF;

  INSERT INTO public.security_audit_events (
    user_id,
    actor_user_id,
    target_user_id,
    event_type,
    event_category,
    severity,
    metadata,
    before_state,
    after_state,
    result
  ) VALUES (
    v_actor,
    v_actor,
    p_user_id,
    'malformed_phone_cleared',
    'settings_change',
    'warning',
    jsonb_build_object(
      'auth_phone_cleared', v_auth_problem,
      'profile_phone_cleared', v_profile_problem
    ),
    jsonb_build_object(
      'auth_phone', CASE WHEN v_auth_problem THEN public.mask_phone_partial(v_auth_phone) ELSE NULL END,
      'profile_phone', CASE WHEN v_profile_problem THEN public.mask_phone_partial(v_profile_phone) ELSE NULL END
    ),
    jsonb_build_object('auth_phone', NULL, 'profile_phone', NULL),
    'success'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'auth_phone_cleared', v_auth_problem,
    'profile_phone_cleared', v_profile_problem
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.clear_malformed_phone_record(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_malformed_phone_record(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.clear_malformed_phone_record(uuid) TO authenticated;
