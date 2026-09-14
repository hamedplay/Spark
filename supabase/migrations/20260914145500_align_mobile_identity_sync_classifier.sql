-- Align the mobile-identity status classifier with the repair runtime.
-- The UI and bulk-sync-profile-phones Edge Function rely on
-- IDENTITY_REPAIR_REQUIRED to distinguish a matching auth.phone from a
-- complete canonical phone identity. The legacy classifier never inspected
-- auth.identities, so that status was unreachable.

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
SET search_path = ''
AS $function$
DECLARE
  r record;
  v_norm text;
  v_auth_phone text;
  v_auth_phone_confirmed_at timestamptz;
  v_conflict_id uuid;
  v_orphan_id uuid;
  v_dup_count integer;
  v_status text;
  v_identity record;
BEGIN
  -- p_dry_run remains part of the stable RPC signature. Classification itself
  -- is intentionally read-only in both modes; mutation is owned by the Edge
  -- Function after MFA/step-up checks.
  PERFORM p_dry_run;

  FOR r IN
    SELECT p.user_id, p.phone, p.full_name
    FROM public.profiles p
    WHERE p.is_active IS TRUE
    ORDER BY p.created_at ASC
  LOOP
    v_status := 'AUTH_PROFILE_MISMATCH';
    v_conflict_id := NULL;
    v_orphan_id := NULL;
    v_auth_phone := NULL;
    v_auth_phone_confirmed_at := NULL;

    v_norm := NULLIF(public.normalize_iran_phone(r.phone), '');

    IF v_norm IS NULL THEN
      IF r.phone IS NULL OR btrim(r.phone) = '' THEN
        v_status := 'PROFILE_PHONE_MISSING';
      ELSE
        v_status := 'INVALID_PHONE';
      END IF;
    ELSE
      SELECT count(*)
      INTO v_dup_count
      FROM public.profiles p2
      WHERE p2.is_active IS TRUE
        AND p2.user_id <> r.user_id
        AND NULLIF(public.normalize_iran_phone(p2.phone), '') = v_norm;

      IF v_dup_count > 0 THEN
        v_status := 'PROFILE_DUPLICATE';
      ELSE
        SELECT au.phone, au.phone_confirmed_at
        INTO v_auth_phone, v_auth_phone_confirmed_at
        FROM auth.users au
        WHERE au.id = r.user_id;

        IF NOT FOUND THEN
          v_status := 'AUTH_USER_MISSING';
        ELSE
          SELECT au.id
          INTO v_conflict_id
          FROM auth.users au
          WHERE au.id <> r.user_id
            AND NULLIF(public.normalize_iran_phone(au.phone), '') = v_norm
          LIMIT 1;

          SELECT au.id
          INTO v_orphan_id
          FROM auth.users au
          WHERE au.id <> r.user_id
            AND NULLIF(public.normalize_iran_phone(au.phone), '') = v_norm
            AND au.email IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM public.profiles p3
              WHERE p3.user_id = au.id
            )
          LIMIT 1;

          IF v_conflict_id IS NOT NULL AND v_orphan_id IS NOT NULL THEN
            v_status := 'PHONE_ONLY_AUTH_ORPHAN';
          ELSIF v_conflict_id IS NOT NULL THEN
            v_status := 'PHONE_USED_BY_OTHER_AUTH_USER';
          ELSIF NULLIF(public.normalize_iran_phone(v_auth_phone), '') IS NULL THEN
            v_status := 'SAFE_TO_SYNC';
          ELSIF public.normalize_iran_phone(v_auth_phone) <> v_norm THEN
            v_status := 'AUTH_PHONE_CONFLICT';
          ELSIF v_auth_phone_confirmed_at IS NULL THEN
            v_status := 'AUTH_PHONE_UNCONFIRMED';
          ELSE
            SELECT *
            INTO v_identity
            FROM public.get_phone_auth_identity_state_v1(r.user_id, v_norm);

            IF NOT FOUND THEN
              v_status := 'AUTH_PROFILE_MISMATCH';
            ELSIF v_identity.identity_count = 0 THEN
              v_status := 'IDENTITY_REPAIR_REQUIRED';
            ELSIF v_identity.identity_count = 1
              AND v_identity.exactly_one_phone_identity IS TRUE
              AND v_identity.identity_same_user IS TRUE
              AND v_identity.identity_sub_matches_user IS TRUE
              AND v_identity.identity_phone_matches IS TRUE
              AND v_identity.identity_phone_verified IS TRUE THEN
              v_status := 'ALREADY_SYNCED';
            ELSE
              v_status := 'AUTH_PROFILE_MISMATCH';
            END IF;
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
$function$;

REVOKE ALL ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM anon;
REVOKE ALL ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) TO service_role;

NOTIFY pgrst, 'reload schema';
