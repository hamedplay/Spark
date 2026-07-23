/*
# Phone-Auth Sync Repair Queue and Diagnostic RPCs

## Purpose
Creates a repair queue table for tracking phone↔auth sync issues, plus
diagnostic RPCs for identifying phone-only orphan auth users and computing
per-user phone sync status.

## New Tables
- `phone_auth_sync_repairs`
  - `id` (uuid PK)
  - `user_id` (uuid, the profile/auth user needing repair)
  - `related_auth_user_id` (uuid nullable, a phone-only orphan blocking sync)
  - `operation_type` (text: sync_profile_phone | repair_phone_orphan | change_phone)
  - `masked_phone` (text, masked for safety)
  - `status` (text: PENDING | RETRYING | RESOLVED | FAILED_PERMANENTLY | NEEDS_ADMIN_REVIEW)
  - `retry_count` (int, default 0)
  - `last_error_code` (text nullable)
  - `created_at`, `updated_at`, `resolved_at` (timestamptz)

## New RPCs
- `diagnose_phone_auth_sync_status(p_target_user_id)` — returns per-user status
- `diagnose_phone_only_orphans()` — returns orphan auth users
- `bulk_classify_phone_sync(p_dry_run boolean)` — classifies all active profiles

## Security
- RLS enabled on `phone_auth_sync_repairs`, admin-only CRUD.
- All RPCs require `authenticated` role.
*/

-- ── Repair Queue Table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.phone_auth_sync_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  related_auth_user_id uuid,
  operation_type text NOT NULL DEFAULT 'sync_profile_phone',
  masked_phone text,
  status text NOT NULL DEFAULT 'PENDING',
  retry_count integer NOT NULL DEFAULT 0,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

ALTER TABLE public.phone_auth_sync_repairs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_select_phone_sync_repairs" ON public.phone_auth_sync_repairs;
CREATE POLICY "admin_select_phone_sync_repairs"
  ON public.phone_auth_sync_repairs FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_admin = true AND p.is_active = true));

DROP POLICY IF EXISTS "admin_insert_phone_sync_repairs" ON public.phone_auth_sync_repairs;
CREATE POLICY "admin_insert_phone_sync_repairs"
  ON public.phone_auth_sync_repairs FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_admin = true AND p.is_active = true));

DROP POLICY IF EXISTS "admin_update_phone_sync_repairs" ON public.phone_auth_sync_repairs;
CREATE POLICY "admin_update_phone_sync_repairs"
  ON public.phone_auth_sync_repairs FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_admin = true AND p.is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_admin = true AND p.is_active = true));

DROP POLICY IF EXISTS "admin_delete_phone_sync_repairs" ON public.phone_auth_sync_repairs;
CREATE POLICY "admin_delete_phone_sync_repairs"
  ON public.phone_auth_sync_repairs FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid() AND p.is_admin = true AND p.is_active = true));

-- ── updated_at trigger ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_phone_sync_repairs_updated ON public.phone_auth_sync_repairs;
CREATE TRIGGER trg_phone_sync_repairs_updated
  BEFORE UPDATE ON public.phone_auth_sync_repairs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Masking helper ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mask_phone_partial(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR length(p_phone) < 7 THEN '***'
    ELSE substr(p_phone, 1, 4) || '****' || substr(p_phone, length(p_phone) - 1)
  END;
$$;

-- ── Per-user phone sync status diagnostic ────────────────────────────
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
  SELECT phone, is_active INTO v_profile_phone, v_profile_active
  FROM public.profiles
  WHERE user_id = p_target_user_id;

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

  SELECT phone INTO v_auth_phone
  FROM auth.users
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'AUTH_USER_MISSING'::text, public.mask_phone_partial(v_profile_phone), NULL::text, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  SELECT id INTO v_conflict_id
  FROM auth.users
  WHERE phone = v_norm_phone
    AND id <> p_target_user_id
  LIMIT 1;

  SELECT u.id INTO v_orphan_id
  FROM auth.users u
  WHERE u.phone = v_norm_phone
    AND u.email IS NULL
    AND u.id <> p_target_user_id
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
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

-- ── Phone-only orphan diagnostic ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.diagnose_phone_only_orphans()
RETURNS TABLE(
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
      EXISTS(SELECT 1 FROM public.meetings m WHERE m.created_by = u.id)
      OR EXISTS(SELECT 1 FROM public.minutes mn WHERE mn.created_by = u.id)
      OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.assigned_to = u.id)
      OR EXISTS(SELECT 1 FROM public.notes n WHERE n.user_id = u.id)
      OR EXISTS(SELECT 1 FROM public.chat_messages cm WHERE cm.sender_id = u.id)
    ) AS has_dependent_records,
    (
      SELECT p2.user_id FROM public.profiles p2
      WHERE p2.is_active = true
        AND public.normalize_iran_phone(p2.phone) = u.phone
        AND p2.user_id <> u.id
      ORDER BY p2.created_at ASC
      LIMIT 1
    ) AS primary_profile_user_id,
    (
      SELECT public.mask_phone_partial(p2.phone) FROM public.profiles p2
      WHERE p2.is_active = true
        AND public.normalize_iran_phone(p2.phone) = u.phone
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

-- ── Bulk classify phone sync ────────────────────────────────────────
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
    SELECT user_id, phone, full_name, is_active
    FROM public.profiles
    WHERE is_active = true
    ORDER BY created_at ASC
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
      FROM public.profiles
      WHERE is_active = true
        AND public.normalize_iran_phone(phone) = v_norm
        AND user_id <> r.user_id;

      IF v_dup_count > 0 THEN
        v_status := 'DUPLICATE_PROFILE_PHONE';
      ELSE
        SELECT phone INTO v_auth_phone
        FROM auth.users
        WHERE id = r.user_id;

        IF NOT FOUND THEN
          v_status := 'AUTH_USER_MISSING';
        ELSE
          SELECT id INTO v_conflict_id
          FROM auth.users
          WHERE phone = v_norm
            AND id <> r.user_id
          LIMIT 1;

          SELECT u.id INTO v_orphan_id
          FROM auth.users u
          WHERE u.phone = v_norm
            AND u.email IS NULL
            AND u.id <> r.user_id
            AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
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

GRANT EXECUTE ON FUNCTION public.diagnose_phone_auth_sync_status(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.diagnose_phone_only_orphans() TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mask_phone_partial(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO authenticated;
