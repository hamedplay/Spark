-- ─────────────────────────────────────────────────────────────────
-- Migration: add get_selectable_users RPC for meeting/calendar user pickers
-- Replaces direct profiles_public reads that broke because the view no longer
-- exposes email (and is restricted by owner-scoped RLS on the base table).
-- ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_selectable_users()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  avatar_url text,
  "position" text,
  unit_id uuid,
  unit_name text,
  position_title text,
  level integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

  RETURN QUERY
  SELECT
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
    ON m.user_id = p.user_id AND m.is_primary = true
  LEFT JOIN public.org_positions pos
    ON pos.id = m.position_id
  LEFT JOIN public.org_units u
    ON u.id = pos.unit_id
  WHERE p.is_active = true
    AND COALESCE(p.is_hidden, false) = false
    AND (v_caller_org IS NULL OR p.organization IS NULL OR p.organization = v_caller_org)
  ORDER BY p.full_name NULLS LAST;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_selectable_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_selectable_users() TO authenticated;
