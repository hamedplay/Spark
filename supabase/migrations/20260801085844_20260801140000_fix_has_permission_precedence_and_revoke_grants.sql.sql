/*
# Fix _has_permission precedence, revoke dangerous grants, add get_my_effective_permissions

## Summary

This migration fixes the permission resolution model so that explicit group-level
denials are honored, removes direct REST access to the internal _has_permission helper,
and adds a safe public RPC for the current user to fetch their own effective permissions.

## Changes

### 1. _has_permission precedence fix

The existing _has_permission function had a precedence bug: when a user's groups
explicitly set a permission key to `false`, the function ignored that and fell through
to org_level_permissions, which could grant `true`. This made group-level deny toggles
ineffective.

New precedence model:
  1. admin → true (checked by callers via is_current_user_admin, not changed here)
  2. position override (highest explicit precedence) — if a row exists for this
     position + key, return its granted value (true or false), no further checks.
  3. user groups — if at least one group defines the key:
       - if any group grants true → true
       - if all groups that define the key grant false → false (DENY, no org fallback)
  4. org level — only consulted when NO group defines the key
  5. none of the above → false

This is backward-compatible: groups that do not define a key still fall through to
org level. Groups that only set `true` still grant access. The only behavioral change
is that explicit `false` values from groups are now honored as denials.

### 2. Revoke EXECUTE on _has_permission from PUBLIC and anon

The function is SECURITY DEFINER and accepts an arbitrary user_id parameter, making
it dangerous if called directly from REST. We revoke from PUBLIC and anon.
`authenticated` is also revoked — the frontend should use get_my_effective_permissions
instead. Internal callers (other SECURITY DEFINER functions) still execute via the
postgres owner privilege.

### 3. Revoke EXECUTE on _sync_minutes_decisions from all roles except owner

This internal helper should only be called from within create_minutes_draft and
update_minutes_draft. It is not for direct REST invocation.

### 4. Add get_my_effective_permissions()

A new SECURITY DEFINER, STABLE function that:
  - takes no user_id parameter (uses auth.uid() only)
  - returns a JSONB object of {permission_key: boolean} for the current user
  - is closed to anon, open to authenticated
  - uses the same precedence as _has_permission (without the admin shortcut —
    callers check is_admin separately)
  - has a fixed safe search_path

## Security
  - _has_permission: REVOKE EXECUTE FROM PUBLIC, anon, authenticated
  - _sync_minutes_decisions: REVOKE EXECUTE FROM PUBLIC, anon, authenticated
  - get_my_effective_permissions: GRANT EXECUTE TO authenticated only

## Idempotency
  All statements use CREATE OR REPLACE and REVOKE IF EXISTS / GRANT patterns.
  Re-running is safe.

## No data loss
  No DROP, DELETE, TRUNCATE, or CASCADE. No table or column changes.
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Fix _has_permission precedence
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public._has_permission(p_user_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_position_id uuid;
  v_pos_level   integer;
  v_group_result boolean;
  v_any_group_defines boolean := false;
  v_pos_grant   boolean;
  v_level_grant boolean;
BEGIN
  -- Find primary position
  SELECT opm.position_id, op.level
  INTO v_position_id, v_pos_level
  FROM public.org_position_members opm
  JOIN public.org_positions op ON op.id = opm.position_id
  WHERE opm.user_id = p_user_id AND opm.is_primary = true
  LIMIT 1;

  -- 1. Position-level override (highest precedence)
  IF v_position_id IS NOT NULL THEN
    SELECT COALESCE(opp.granted, false) INTO v_pos_grant
    FROM public.org_position_permissions opp
    WHERE opp.position_id = v_position_id AND opp.permission_key = p_key
    LIMIT 1;
    IF FOUND THEN
      RETURN v_pos_grant;
    END IF;
  END IF;

  -- 2. User groups: check if any group defines this key
  SELECT
    COALESCE(bool_or((g.permissions->>p_key)::boolean), false),
    bool_or(g.permissions ? p_key)
  INTO v_group_result, v_any_group_defines
  FROM public.user_group_members ugm
  JOIN public.user_groups g ON g.id = ugm.group_id
  WHERE ugm.user_id = p_user_id;

  -- If at least one group explicitly defines the key, the group layer is authoritative:
  --   - any true → true
  --   - all false → false (DENY, do NOT fall through to org level)
  IF v_any_group_defines THEN
    RETURN v_group_result;
  END IF;

  -- 3. Org level permissions (only when no group defines the key)
  IF v_pos_level IS NOT NULL THEN
    SELECT COALESCE(olp.granted, false) INTO v_level_grant
    FROM public.org_level_permissions olp
    WHERE olp.level = v_pos_level AND olp.permission_key = p_key
    LIMIT 1;
    IF v_level_grant THEN RETURN true; END IF;
  END IF;

  RETURN false;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. Revoke dangerous EXECUTE grants on _has_permission
-- ═══════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public._has_permission(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._has_permission(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public._has_permission(uuid, text) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. Revoke EXECUTE on _sync_minutes_decisions from all non-owner roles
-- ═══════════════════════════════════════════════════════════════════════

REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._sync_minutes_decisions(uuid, jsonb) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. Add get_my_effective_permissions — safe public RPC
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_my_effective_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id     uuid := auth.uid();
  v_position_id uuid;
  v_pos_level   integer;
  v_result      jsonb := '{}'::jsonb;
  v_key         text;
  v_group_val   boolean;
  v_group_any   boolean;
  v_pos_grant   boolean;
  v_level_grant boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  -- Admin gets all permissions
  IF public.is_current_user_admin() THEN
    RETURN 'null'::jsonb;
  END IF;

  -- Collect all known permission keys from all sources
  -- We union keys from: user_groups.permissions, org_level_permissions, org_position_permissions
  -- Then resolve each key using the same precedence as _has_permission.

  -- Gather all keys into a temp set
  CREATE TEMP TABLE IF NOT EXISTS _tmp_perm_keys ON COMMIT DROP AS
  SELECT DISTINCT k AS key FROM (
    -- Keys from user groups
    SELECT jsonb_object_keys(g.permissions) AS k
    FROM public.user_group_members ugm
    JOIN public.user_groups g ON g.id = ugm.group_id
    WHERE ugm.user_id = v_user_id
    UNION ALL
    -- Keys from org level
    SELECT olp.permission_key AS k
    FROM public.org_level_permissions olp
    UNION ALL
    -- Keys from position overrides
    SELECT opp.permission_key AS k
    FROM public.org_position_members opm
    JOIN public.org_position_permissions opp ON opp.position_id = opm.position_id
    WHERE opm.user_id = v_user_id AND opm.is_primary = true
  ) keys
  WHERE k IS NOT NULL AND k <> '';

  -- Find primary position
  SELECT opm.position_id, op.level
  INTO v_position_id, v_pos_level
  FROM public.org_position_members opm
  JOIN public.org_positions op ON op.id = opm.position_id
  WHERE opm.user_id = v_user_id AND opm.is_primary = true
  LIMIT 1;

  FOR v_key IN SELECT key FROM _tmp_perm_keys LOOP
    -- 1. Position override
    IF v_position_id IS NOT NULL THEN
      SELECT COALESCE(opp.granted, false) INTO v_pos_grant
      FROM public.org_position_permissions opp
      WHERE opp.position_id = v_position_id AND opp.permission_key = v_key
      LIMIT 1;
      IF FOUND THEN
        v_result := v_result || jsonb_build_object(v_key, v_pos_grant);
        CONTINUE;
      END IF;
    END IF;

    -- 2. User groups
    SELECT
      COALESCE(bool_or((g.permissions->>v_key)::boolean), false),
      bool_or(g.permissions ? v_key)
    INTO v_group_val, v_group_any
    FROM public.user_group_members ugm
    JOIN public.user_groups g ON g.id = ugm.group_id
    WHERE ugm.user_id = v_user_id;

    IF v_group_any THEN
      v_result := v_result || jsonb_build_object(v_key, v_group_val);
      CONTINUE;
    END IF;

    -- 3. Org level
    IF v_pos_level IS NOT NULL THEN
      SELECT COALESCE(olp.granted, false) INTO v_level_grant
      FROM public.org_level_permissions olp
      WHERE olp.level = v_pos_level AND olp.permission_key = v_key
      LIMIT 1;
      v_result := v_result || jsonb_build_object(v_key, v_level_grant);
      CONTINUE;
    END IF;

    -- 4. No source defines this key
    v_result := v_result || jsonb_build_object(v_key, false);
  END LOOP;

  DROP TABLE IF EXISTS _tmp_perm_keys;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_effective_permissions() TO authenticated;
