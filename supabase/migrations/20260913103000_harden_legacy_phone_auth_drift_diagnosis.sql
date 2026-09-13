CREATE OR REPLACE FUNCTION private.auth_user_has_any_reference_v1(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_ref record;
  v_found boolean;
BEGIN
  IF p_user_id IS NULL THEN RETURN true; END IF;

  IF EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.owner = p_user_id OR o.owner_id = p_user_id::text
  ) THEN
    RETURN true;
  END IF;

  FOR v_ref IN
    SELECT DISTINCT ns.nspname AS schema_name, cls.relname AS table_name, att.attname AS column_name
    FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_class cls ON cls.oid = con.conrelid
    JOIN pg_catalog.pg_namespace ns ON ns.oid = cls.relnamespace
    JOIN pg_catalog.unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ord) ON true
    JOIN pg_catalog.pg_attribute att ON att.attrelid = cls.oid AND att.attnum = ck.attnum
    WHERE con.contype = 'f'
      AND con.confrelid = 'auth.users'::pg_catalog.regclass
  LOOP
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM %I.%I WHERE %I = $1)',
      v_ref.schema_name, v_ref.table_name, v_ref.column_name
    ) INTO v_found USING p_user_id;
    IF v_found THEN RETURN true; END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.auth_user_has_any_reference_v1(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.auth_user_has_any_reference_v1(uuid) FROM anon;
REVOKE ALL ON FUNCTION private.auth_user_has_any_reference_v1(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION private.auth_user_has_any_reference_v1(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.diagnose_phone_only_orphans()
RETURNS TABLE(auth_user_id uuid, masked_phone text, created_at timestamptz, last_sign_in_at timestamptz, has_profile boolean, has_identity boolean, has_sessions boolean, has_dependent_records boolean, primary_profile_user_id uuid, primary_profile_masked_phone text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    public.mask_phone_partial(u.phone),
    u.created_at,
    u.last_sign_in_at,
    EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id = u.id),
    EXISTS(SELECT 1 FROM auth.identities i WHERE i.user_id = u.id),
    EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id),
    private.auth_user_has_any_reference_v1(u.id),
    (
      SELECT p2.user_id
      FROM public.profiles p2
      JOIN auth.users pu2 ON pu2.id = p2.user_id AND pu2.deleted_at IS NULL
      WHERE p2.is_active = true
        AND p2.account_status = 'ACTIVE'
        AND p2.phone_verified_at IS NOT NULL
        AND public.normalize_iran_phone(p2.phone) = public.normalize_iran_phone(u.phone)
        AND p2.user_id <> u.id
      ORDER BY p2.created_at ASC
      LIMIT 1
    ),
    (
      SELECT public.mask_phone_partial(p2.phone)
      FROM public.profiles p2
      JOIN auth.users pu2 ON pu2.id = p2.user_id AND pu2.deleted_at IS NULL
      WHERE p2.is_active = true
        AND p2.account_status = 'ACTIVE'
        AND p2.phone_verified_at IS NOT NULL
        AND public.normalize_iran_phone(p2.phone) = public.normalize_iran_phone(u.phone)
        AND p2.user_id <> u.id
      ORDER BY p2.created_at ASC
      LIMIT 1
    )
  FROM auth.users u
  WHERE u.deleted_at IS NULL
    AND u.email IS NULL
    AND u.phone IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.diagnose_phone_auth_sync_status(p_target_user_id uuid)
RETURNS TABLE(status text, profile_phone_masked text, auth_phone_masked text, conflict_auth_user_id uuid, orphan_auth_user_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_profile_phone text;
  v_profile_active boolean;
  v_profile_status text;
  v_profile_phone_verified timestamptz;
  v_auth_phone text;
  v_conflict_id uuid;
  v_orphan_id uuid;
  v_norm_phone text;
BEGIN
  SELECT p.phone, p.is_active, p.account_status, p.phone_verified_at
  INTO v_profile_phone, v_profile_active, v_profile_status, v_profile_phone_verified
  FROM public.profiles p
  WHERE p.user_id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTH_USER_MISSING'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF NOT v_profile_active OR v_profile_status <> 'ACTIVE' OR v_profile_phone_verified IS NULL THEN
    RETURN QUERY SELECT 'PROFILE_INACTIVE'::text, public.mask_phone_partial(v_profile_phone), NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_norm_phone := NULLIF(public.normalize_iran_phone(v_profile_phone), '');
  IF v_norm_phone IS NULL THEN
    RETURN QUERY SELECT 'PROFILE_PHONE_MISSING'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT au.phone INTO v_auth_phone
  FROM auth.users au
  WHERE au.id = p_target_user_id AND au.deleted_at IS NULL;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTH_USER_MISSING'::text, public.mask_phone_partial(v_profile_phone), NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT au.id INTO v_conflict_id
  FROM auth.users au
  WHERE au.id <> p_target_user_id
    AND au.deleted_at IS NULL
    AND public.normalize_iran_phone(au.phone) = v_norm_phone
  ORDER BY au.created_at ASC
  LIMIT 1;

  SELECT au.id INTO v_orphan_id
  FROM auth.users au
  WHERE au.id <> p_target_user_id
    AND au.deleted_at IS NULL
    AND au.email IS NULL
    AND public.normalize_iran_phone(au.phone) = v_norm_phone
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = au.id)
    AND NOT private.auth_user_has_any_reference_v1(au.id)
  ORDER BY au.created_at ASC
  LIMIT 1;

  IF v_conflict_id IS NOT NULL AND v_orphan_id IS NOT NULL AND v_conflict_id = v_orphan_id THEN
    RETURN QUERY SELECT 'PHONE_ONLY_AUTH_ORPHAN'::text, public.mask_phone_partial(v_profile_phone), public.mask_phone_partial(v_auth_phone), v_conflict_id, v_orphan_id;
  ELSIF v_conflict_id IS NOT NULL THEN
    RETURN QUERY SELECT 'PHONE_USED_BY_OTHER_AUTH_USER'::text, public.mask_phone_partial(v_profile_phone), public.mask_phone_partial(v_auth_phone), v_conflict_id, NULL::uuid;
  ELSIF v_auth_phone IS NULL OR btrim(v_auth_phone) = '' THEN
    RETURN QUERY SELECT 'AUTH_PHONE_MISSING'::text, public.mask_phone_partial(v_profile_phone), NULL::text, NULL::uuid, NULL::uuid;
  ELSIF public.normalize_iran_phone(v_auth_phone) <> v_norm_phone THEN
    RETURN QUERY SELECT 'MISMATCH'::text, public.mask_phone_partial(v_profile_phone), public.mask_phone_partial(v_auth_phone), NULL::uuid, NULL::uuid;
  ELSE
    RETURN QUERY SELECT 'SYNCED'::text, public.mask_phone_partial(v_profile_phone), public.mask_phone_partial(v_auth_phone), NULL::uuid, NULL::uuid;
  END IF;
END;
$$;
