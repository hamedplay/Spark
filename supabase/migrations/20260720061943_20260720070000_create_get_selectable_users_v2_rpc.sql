-- Incremental, backward-compatible directory RPC.
-- get_selectable_users (v1) is intentionally left untouched.
-- Returns one row per user with all org assignments as a JSON array.
-- Security: SECURITY DEFINER, search_path='', authenticated only,
-- same-organization enforced, inactive/hidden excluded, no sensitive fields.

CREATE OR REPLACE FUNCTION public.get_selectable_users_v2()
RETURNS TABLE(
  user_id uuid,
  full_name text,
  avatar_url text,
  "position" text,
  unit_id uuid,
  unit_name text,
  position_title text,
  level integer,
  assignments jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_caller_org text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  SELECT p.organization INTO v_caller_org
  FROM public.profiles p
  WHERE p.user_id = auth.uid()
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
    s.level,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'position_id',   a.position_id,
            'position_title', a.position_title,
            'unit_id',        a.unit_id,
            'unit_name',      a.unit_name,
            'level',          a.level,
            'is_primary',     a.is_primary
          )
          ORDER BY
            (a.is_primary = true) DESC,
            a.level DESC NULLS LAST,
            a.unit_name NULLS LAST,
            a.position_title NULLS LAST,
            a.position_id NULLS LAST
          -- dedupe by position_id to guarantee no duplicate assignments
        )
        FROM (
          SELECT DISTINCT ON (m.position_id)
            m.position_id,
            pos.title AS position_title,
            u.id AS unit_id,
            u.name AS unit_name,
            pos.level AS level,
            m.is_primary
          FROM public.org_position_members m
          JOIN public.org_positions pos ON pos.id = m.position_id
          LEFT JOIN public.org_units u ON u.id = pos.unit_id
          WHERE m.user_id = s.user_id
          ORDER BY m.position_id
        ) a
      ),
      '[]'::jsonb
    ) AS assignments
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
    LEFT JOIN public.org_position_members m ON m.user_id = p.user_id
    LEFT JOIN public.org_positions pos ON pos.id = m.position_id
    LEFT JOIN public.org_units u ON u.id = pos.unit_id
    WHERE p.is_active = true
      AND COALESCE(p.is_hidden, false) = false
      AND p.organization = v_caller_org
    ORDER BY p.user_id,
      (m.is_primary = true) DESC,
      pos.level DESC NULLS LAST,
      m.position_id NULLS LAST,
      m.id NULLS LAST
  ) s
  ORDER BY s.full_name NULLS LAST;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_selectable_users_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_selectable_users_v2() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_selectable_users_v2() TO authenticated;
