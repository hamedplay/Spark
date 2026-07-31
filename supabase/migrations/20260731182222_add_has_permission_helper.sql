
-- ── Helper: _has_permission — check resolved permission for a user ────────────
CREATE OR REPLACE FUNCTION public._has_permission(p_user_id uuid, p_key text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_result boolean := false;
BEGIN
  -- 1. Check user groups (group-level permissions)
  SELECT COALESCE(bool_or((g.permissions->>p_key)::boolean), false)
  INTO v_result
  FROM public.user_group_members ugm
  JOIN public.user_groups g ON g.id = ugm.group_id
  WHERE ugm.user_id = p_user_id
    AND (g.permissions ? p_key);
  IF v_result THEN RETURN true; END IF;

  -- 2. Check org level permissions (via primary position)
  SELECT COALESCE(bool_or(olp.granted), false)
  INTO v_result
  FROM public.org_position_members opm
  JOIN public.org_positions op ON op.id = opm.position_id
  JOIN public.org_level_permissions olp
    ON olp.level_id = op.level
   AND olp.permission_key = p_key
  WHERE opm.user_id = p_user_id AND opm.is_primary = true;
  IF v_result THEN RETURN true; END IF;

  -- 3. Check position-level overrides
  SELECT COALESCE(bool_or(opp.granted), false)
  INTO v_result
  FROM public.org_position_members opm
  JOIN public.org_position_permissions opp
    ON opp.position_id = opm.position_id
   AND opp.permission_key = p_key
  WHERE opm.user_id = p_user_id AND opm.is_primary = true;

  RETURN COALESCE(v_result, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public._has_permission(uuid, text) TO authenticated;
