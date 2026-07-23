-- ============================================================================
-- Fix 1: bulk_classify_phone_sync — normalize auth.users.phone before comparison
-- Bug: au.phone = v_norm fails when auth phone stored as +989... but v_norm is 989...
-- Fix: use normalize_iran_phone(au.phone) = v_norm for all auth phone comparisons
-- ============================================================================
CREATE OR REPLACE FUNCTION public.bulk_classify_phone_sync(p_dry_run boolean DEFAULT true)
RETURNS TABLE (
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
  v_auth_phone_norm text;
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
        v_auth_phone_norm := public.normalize_iran_phone(v_auth_phone);

        SELECT au.id INTO v_conflict_id
        FROM auth.users au
        WHERE public.normalize_iran_phone(au.phone) = v_norm
          AND au.id <> r.user_id
        LIMIT 1;

        SELECT au.id INTO v_orphan_id
        FROM auth.users au
        WHERE public.normalize_iran_phone(au.phone) = v_norm
          AND au.email IS NULL
          AND au.id <> r.user_id
          AND NOT EXISTS (SELECT 1 FROM public.profiles p3 WHERE p3.user_id = au.id)
        LIMIT 1;

        IF v_conflict_id IS NOT NULL AND v_orphan_id IS NOT NULL THEN
          v_status := 'PHONE_ONLY_AUTH_ORPHAN';
        ELSIF v_conflict_id IS NOT NULL THEN
          v_status := 'PHONE_USED_BY_OTHER_AUTH_USER';
        ELSIF v_auth_phone IS NULL OR v_auth_phone_norm = '' OR v_auth_phone_norm IS NULL THEN
          v_status := 'SAFE_TO_SYNC';
        ELSIF v_auth_phone_norm = v_norm THEN
          v_status := 'ALREADY_SYNCED';
        ELSE
          v_status := 'MISMATCH';
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

-- ============================================================================
-- Fix 2: diagnose_phone_only_orphans — normalize auth.users.phone before comparison
-- ============================================================================
CREATE OR REPLACE FUNCTION public.diagnose_phone_only_orphans()
RETURNS TABLE (
  auth_user_id uuid,
  masked_phone text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  has_profile boolean,
  has_identity boolean,
  has_sessions boolean,
  has_dependent_records boolean,
  primary_profile_user_id uuid,
  primary_profile_masked_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
RETURN QUERY
SELECT
  u.id AS auth_user_id,
  public.mask_phone_partial(u.phone) AS masked_phone,
  u.created_at,
  u.last_sign_in_at,
  EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id = u.id) AS has_profile,
  EXISTS(SELECT 1 FROM auth.identities i WHERE i.user_id = u.id) AS has_identity,
  EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id) AS has_sessions,
  (
    EXISTS(SELECT 1 FROM public.meetings m WHERE m.user_id = u.id)
    OR EXISTS(SELECT 1 FROM public.minutes mn WHERE mn.created_by_user_id = u.id)
    OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.user_id = u.id)
    OR EXISTS(SELECT 1 FROM public.notes n WHERE n.user_id = u.id)
    OR EXISTS(SELECT 1 FROM public.chat_messages cm WHERE cm.sender_id = u.id)
  ) AS has_dependent_records,
  (
    SELECT p2.user_id FROM public.profiles p2
    WHERE p2.is_active = true
      AND public.normalize_iran_phone(p2.phone) = public.normalize_iran_phone(u.phone)
      AND p2.user_id <> u.id
    ORDER BY p2.created_at ASC
    LIMIT 1
  ) AS primary_profile_user_id,
  (
    SELECT public.mask_phone_partial(p2.phone) FROM public.profiles p2
    WHERE p2.is_active = true
      AND public.normalize_iran_phone(p2.phone) = public.normalize_iran_phone(u.phone)
      AND p2.user_id <> u.id
    ORDER BY p2.created_at ASC
    LIMIT 1
  ) AS primary_profile_masked_phone
FROM auth.users u
WHERE u.email IS NULL
  AND u.phone IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
ORDER BY u.created_at DESC;
END;
$$;

-- ============================================================================
-- Fix 3: Set secure search_path on functions with empty search_path
-- ============================================================================
ALTER FUNCTION public.normalize_iran_phone(text) SET search_path = public;
ALTER FUNCTION public.resolve_phone_password_reset_target(text) SET search_path = public;
ALTER FUNCTION public.revalidate_phone_password_reset_target(uuid) SET search_path = public;

-- ============================================================================
-- Fix 4: Revoke EXECUTE on diagnostic RPCs from anon and authenticated
-- These RPCs access auth.users and must be admin/service_role only
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.diagnose_phone_only_orphans() FROM anon, authenticated;