/*
# Fix ambiguous column references in diagnose_phone_auth_sync_status
*/

CREATE OR REPLACE FUNCTION public.diagnose_phone_auth_sync_status(p_target_user_id uuid)
RETURNS TABLE(
  status text,
  profile_phone_masked text,
  auth_phone_masked text,
  conflict_auth_user_id uuid,
  orphan_auth_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_phone text;
  v_profile_active boolean;
  v_auth_phone text;
  v_conflict_id uuid;
  v_orphan_id uuid;
  v_norm_phone text;
BEGIN
  SELECT p.phone, p.is_active INTO v_profile_phone, v_profile_active
  FROM public.profiles p
  WHERE p.user_id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTH_USER_MISSING'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  IF NOT v_profile_active THEN
    RETURN QUERY SELECT 'PROFILE_INACTIVE'::text, public.mask_phone_partial(v_profile_phone), NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  v_norm_phone := public.normalize_iran_phone(v_profile_phone);
  IF v_norm_phone = '' OR v_norm_phone IS NULL THEN
    RETURN QUERY SELECT 'PROFILE_PHONE_MISSING'::text, NULL::text, NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT au.phone INTO v_auth_phone
  FROM auth.users au
  WHERE au.id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTH_USER_MISSING'::text, public.mask_phone_partial(v_profile_phone), NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT au.id INTO v_conflict_id
  FROM auth.users au
  WHERE au.phone = v_norm_phone
    AND au.id <> p_target_user_id
  LIMIT 1;

  SELECT au.id INTO v_orphan_id
  FROM auth.users au
  WHERE au.phone = v_norm_phone
    AND au.email IS NULL
    AND au.id <> p_target_user_id
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = au.id)
  LIMIT 1;

  IF v_conflict_id IS NOT NULL AND v_orphan_id IS NOT NULL THEN
    RETURN QUERY SELECT 'PHONE_ONLY_AUTH_ORPHAN'::text,
      public.mask_phone_partial(v_profile_phone),
      public.mask_phone_partial(v_auth_phone),
      v_conflict_id, v_orphan_id;
  ELSIF v_conflict_id IS NOT NULL THEN
    RETURN QUERY SELECT 'PHONE_USED_BY_OTHER_AUTH_USER'::text,
      public.mask_phone_partial(v_profile_phone),
      public.mask_phone_partial(v_auth_phone),
      v_conflict_id, NULL::uuid;
  ELSIF v_auth_phone IS NULL THEN
    RETURN QUERY SELECT 'AUTH_PHONE_MISSING'::text,
      public.mask_phone_partial(v_profile_phone),
      NULL::text,
      NULL::uuid, NULL::uuid;
  ELSIF public.normalize_iran_phone(v_auth_phone) <> v_norm_phone THEN
    RETURN QUERY SELECT 'MISMATCH'::text,
      public.mask_phone_partial(v_profile_phone),
      public.mask_phone_partial(v_auth_phone),
      NULL::uuid, NULL::uuid;
  ELSE
    RETURN QUERY SELECT 'SYNCED'::text,
      public.mask_phone_partial(v_profile_phone),
      public.mask_phone_partial(v_auth_phone),
      NULL::uuid, NULL::uuid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnose_phone_auth_sync_status(uuid) TO authenticated;
