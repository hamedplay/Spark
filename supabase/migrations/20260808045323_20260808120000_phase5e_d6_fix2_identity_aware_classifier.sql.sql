/*
# Phase 5E-D6 Fix 2 — Identity-Aware Phone Sync Classifier

## Purpose
The previous classifier (`bulk_classify_phone_sync`) treated users as `ALREADY_SYNCED`
when `profiles.phone` matched `auth.users.phone` and `phone_confirmed_at` was set,
but did NOT check whether a GoTrue `auth.identities` row with `provider='phone'` existed.
After the Phase 5E-D6 Fix 1 backfill, 22 users had `auth.users.phone` set directly
but no phone identity — auth integrity was incomplete.

## Changes
1. Replaces `bulk_classify_phone_sync` with an identity-aware version that adds two
   new statuses:
   - `IDENTITY_REPAIR_REQUIRED` — phone matches and is confirmed but no phone identity
   - `AUTH_PHONE_UNCONFIRMED` — phone matches but `phone_confirmed_at` is NULL
2. `ALREADY_SYNCED` now requires exactly one correct phone identity for the same user.
3. All other existing statuses are preserved with identical semantics.
4. SECURITY DEFINER, search_path=public, owner=postgres, grants to service_role —
   all preserved from the original function.

## Security
- No RLS changes (function only).
- No new tables.
- No data modifications.
- Resolver `resolve_phone_password_login_v1` is NOT touched.
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
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_norm text;
  v_auth_phone text;
  v_auth_phone_norm text;
  v_conflict_id uuid;
  v_orphan_id uuid;
  v_dup_count int;
  v_status text;
  v_has_phone_identity boolean;
  v_identity_count int;
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
      v_status := 'PROFILE_DUPLICATE';
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
          v_status := 'AUTH_PHONE_CONFLICT';
        ELSIF v_auth_phone IS NULL OR v_auth_phone_norm = '' OR v_auth_phone_norm IS NULL THEN
          v_status := 'SAFE_TO_SYNC';
        ELSIF v_auth_phone_norm <> v_norm THEN
          v_status := 'AUTH_PROFILE_MISMATCH';
        ELSE
          -- Phones match — check identity and confirmation
          SELECT count(*) INTO v_identity_count
          FROM auth.identities ai
          WHERE ai.user_id = r.user_id
            AND ai.provider = 'phone';

          v_has_phone_identity := (v_identity_count = 1);

          IF au_is_phone_confirmed(v_auth_phone, r.user_id) = false THEN
            v_status := 'AUTH_PHONE_UNCONFIRMED';
          ELSIF v_has_phone_identity THEN
            v_status := 'ALREADY_SYNCED';
          ELSE
            v_status := 'IDENTITY_REPAIR_REQUIRED';
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

-- Helper: check phone_confirmed_at for a user (inline to avoid extra function dependency)
-- We need to reference auth.users.phone_confirmed_at directly inside the loop.
-- The above uses a helper call; replace with direct column access instead.

-- Drop the helper if it was accidentally created
DROP FUNCTION IF EXISTS public.au_is_phone_confirmed(text, uuid);

-- Re-create the function with direct auth.users.phone_confirmed_at access
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
SET search_path TO 'public'
AS $function$
DECLARE
  r RECORD;
  v_norm text;
  v_auth_phone text;
  v_auth_phone_norm text;
  v_conflict_id uuid;
  v_orphan_id uuid;
  v_dup_count int;
  v_status text;
  v_has_phone_identity boolean;
  v_identity_count int;
  v_phone_confirmed timestamptz;
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
      v_status := 'PROFILE_DUPLICATE';
    ELSE
      SELECT au.phone, au.phone_confirmed_at
      INTO v_auth_phone, v_phone_confirmed
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
          v_status := 'AUTH_PHONE_CONFLICT';
        ELSIF v_auth_phone IS NULL OR v_auth_phone_norm = '' OR v_auth_phone_norm IS NULL THEN
          v_status := 'SAFE_TO_SYNC';
        ELSIF v_auth_phone_norm <> v_norm THEN
          v_status := 'AUTH_PROFILE_MISMATCH';
        ELSE
          SELECT count(*) INTO v_identity_count
          FROM auth.identities ai
          WHERE ai.user_id = r.user_id
            AND ai.provider = 'phone';

          v_has_phone_identity := (v_identity_count = 1);

          IF v_phone_confirmed IS NULL THEN
            v_status := 'AUTH_PHONE_UNCONFIRMED';
          ELSIF v_has_phone_identity THEN
            v_status := 'ALREADY_SYNCED';
          ELSE
            v_status := 'IDENTITY_REPAIR_REQUIRED';
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

-- Preserve grants
GRANT EXECUTE ON FUNCTION public.bulk_classify_phone_sync(boolean) TO service_role;
