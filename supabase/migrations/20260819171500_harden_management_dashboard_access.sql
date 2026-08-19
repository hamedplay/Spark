-- Harden management dashboard authorization and drill-down metadata.
-- Existing migrations are intentionally not modified.

-- The employee group is a broad default role and must not implicitly grant the
-- sensitive management dashboard. Explicit group / position / level grants remain.
UPDATE public.user_groups
SET permissions = permissions - 'management_dashboard'
WHERE name = 'employee'
  AND permissions ? 'management_dashboard';

CREATE OR REPLACE FUNCTION public.has_management_dashboard_access_v1()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN false;
  END IF;
  RETURN public._has_permission(v_user_id, 'management_dashboard');
END;
$$;
REVOKE ALL ON FUNCTION public.has_management_dashboard_access_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_management_dashboard_access_v1() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_management_dashboard_for_user_v1(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_result jsonb;
  v_deadlines jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_USER_ID';
  END IF;

  -- This permission is intentionally independent of Admin/full-access shortcuts.
  IF NOT public._has_permission(p_user_id, 'management_dashboard') THEN
    RAISE EXCEPTION 'MANAGEMENT_DASHBOARD_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  v_result := public.get_management_dashboard_v1();

  -- Preserve the existing dashboard contract and add minute_id only to decision
  -- deadline items so the UI can open the exact decision in its minute.
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN COALESCE(e.item->>'source', '') = 'decision' AND d.minute_id IS NOT NULL
          THEN e.item || jsonb_build_object('minute_id', d.minute_id)
        ELSE e.item
      END
      ORDER BY e.ord
    ),
    '[]'::jsonb
  )
  INTO v_deadlines
  FROM jsonb_array_elements(COALESCE(v_result->'deadline_alerts', '[]'::jsonb))
       WITH ORDINALITY AS e(item, ord)
  LEFT JOIN public.minutes_decisions d
    ON COALESCE(e.item->>'source', '') = 'decision'
   AND d.id::text = e.item->>'id';

  RETURN jsonb_set(v_result, '{deadline_alerts}', v_deadlines, true);
END;
$$;

-- Sensitive aggregate functions are service-only. Browser roles must use the
-- JWT-verified Edge Function, whose bridge now enforces the explicit permission.
REVOKE ALL ON FUNCTION public.get_management_dashboard_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_dashboard_v1() TO service_role;
REVOKE ALL ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_management_dashboard_for_user_v1(uuid) TO service_role;
