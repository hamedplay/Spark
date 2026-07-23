/*
# Fix ambiguous column references in bulk_classify_phone_sync

The FOR loop variable names shadow table column names. Prefix all
column references with the table alias to disambiguate.
*/

CREATE OR REPLACE FUNCTION public.bulk_classify_phone_sync(p_dry_run boolean DEFAULT true)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  masked_phone text,
  status text,
  conflict_auth_user_id uuid,
  orphan_auth_user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  v_norm text;
  v_auth_phone text;
  v_conflict_id uuid;
  v_orphan_id uuid;
  v_dup_count int;
  v_status text;
BEGIN
  FOR r IN
    SELECT p.user_id, p.phone, p.full_name, p.is_active
    FROM public.profiles p
    WHERE p.is_active = true
    ORDER BY p.created_at ASC
  LOOP
    v_status := 'UNKNOWN_ERROR';
    v_conflict_id := NULL;
    v_orphan_id := NULL;

    v_norm := public.normalize_iran_phone(r.phone);

    IF v_norm = '' OR v_norm IS NULL THEN
      IF r.phone IS NULL OR r.phone = '' THEN
        v_status := 'PROFILE_PHONE_MISSING';
      ELSE
        v_status := 'INVALID_PHONE';
      END IF;
    ELSE
      SELECT count(*) INTO v_dup_count
      FROM public.profiles p2
      WHERE p2.is_active = true
        AND public.normalize_iran_phone(p2.phone) = v_norm
        AND p2.user_id <> r.user_id;

      IF v_dup_count > 0 THEN
        v_status := 'DUPLICATE_PROFILE_PHONE';
      ELSE
        SELECT au.phone INTO v_auth_phone
        FROM auth.users au
        WHERE au.id = r.user_id;

        IF NOT FOUND THEN
          v_status := 'AUTH_USER_MISSING';
        ELSE
          SELECT au.id INTO v_conflict_id
          FROM auth.users au
          WHERE au.phone = v_norm
            AND au.id <> r.user_id
          LIMIT 1;

          SELECT au.id INTO v_orphan_id
          FROM auth.users au
          WHERE au.phone = v_norm
            AND au.email IS NULL
            AND au.id <> r.user_id
            AND NOT EXISTS (SELECT 1 FROM public.profiles p3 WHERE p3.user_id = au.id)
          LIMIT 1;

          IF v_conflict_id IS NOT NULL AND v_orphan_id IS NOT NULL THEN
            v_status := 'PHONE_ONLY_AUTH_ORPHAN';
          ELSIF v_conflict_id IS NOT NULL THEN
            v_status := 'PHONE_USED_BY_OTHER_AUTH_USER';
          ELSIF v_auth_phone IS NULL THEN
            v_status := 'SAFE_TO_SYNC';
          ELSIF public.normalize_iran_phone(v_auth_phone) = v_norm THEN
            v_status := 'ALREADY_SYNCED';
          ELSE
            v_status := 'AUTH_PHONE_CONFLICT';
          END IF;
        END IF;
      END IF;
    END IF;

    RETURN QUERY SELECT
      r.user_id,
      r.full_name,
      public.mask_phone_partial(r.phone),
      v_status,
      v_conflict_id,
      v_orphan_id;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) TO authenticated;
