-- Fix tenant-scoping and duplicate rows in get_selectable_users.
-- - Caller must have a non-null, non-empty organization; otherwise return nothing.
-- - Only users whose organization exactly equals the caller's organization are returned.
-- - Users with NULL/empty organization are never returned.
-- - Each user_id appears at most once (deterministic primary-position pick).
-- - Output columns and names are unchanged.

CREATE OR REPLACE FUNCTION public.get_selectable_users()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text, "position" text, unit_id uuid, unit_name text, position_title text, level integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_org text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT organization INTO v_caller_org
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  -- Caller without a concrete organization gets no list (no cross-org leak).
  IF v_caller_org IS NULL OR btrim(v_caller_org) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.user_id,
    s.full_name,
    s.avatar_url,
    s."position",
    s.unit_id,
    s.unit_name,
    s.position_title,
    s.level
  FROM (
    SELECT DISTINCT ON (p.user_id)
      p.user_id,
      p.full_name,
      p.avatar_url,
      p."position",
      u.id AS unit_id,
      u.name AS unit_name,
      pos.title AS position_title,
      pos.level AS level
    FROM public.profiles p
    LEFT JOIN public.org_position_members m
      ON m.user_id = p.user_id
    LEFT JOIN public.org_positions pos
      ON pos.id = m.position_id
    LEFT JOIN public.org_units u
      ON u.id = pos.unit_id
    WHERE p.is_active = true
      AND COALESCE(p.is_hidden, false) = false
      AND p.organization = v_caller_org
    ORDER BY p.user_id,
             (m.is_primary = true) DESC,
             pos.level DESC NULLS LAST,
             m.position_id NULLS LAST,
             m.id NULLS LAST
  ) AS s
  ORDER BY s.full_name NULLS LAST;
END;
$function$;

-- Preserve grants: only authenticated, service_role, postgres may execute.
REVOKE EXECUTE ON FUNCTION public.get_selectable_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_selectable_users() TO authenticated;
