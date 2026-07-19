/*
# Minutes Phase 3 — fix search_minutes_report aggregate ordering

The jsonb_agg aggregate with an outer ORDER BY fails because the ORDER BY
column (m.created_at) isn't in the aggregate. Fix by moving the ORDER BY
inside the jsonb_agg call.
*/

CREATE OR REPLACE FUNCTION public.search_minutes_report(
  p_filters jsonb, p_limit int, p_offset int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_limit int := LEAST(COALESCE(p_limit, 50), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows jsonb; v_total int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', m.id, 'meeting_title', m.meeting_title_snapshot,
    'meeting_date', m.meeting_date_snapshot, 'org_unit', m.org_unit_name_snapshot,
    'secretary', m.secretary_name_snapshot, 'chair', m.chair_name_snapshot,
    'status', m.status, 'approval_mode', m.approval_mode,
    'confidentiality', m.confidentiality, 'revision_number', m.revision_number,
    'decision_count', dc.cnt, 'published_at', m.published_at
  ) ORDER BY m.created_at DESC), '[]'::jsonb)
  INTO v_rows
  FROM public.minutes m
  LEFT JOIN LATERAL (
    SELECT count(*) AS cnt FROM public.minutes_decisions d WHERE d.minute_id = m.id
  ) dc ON true
  WHERE public._user_can_view_minute(m.id)
    AND (p_filters->>'status' IS NULL OR m.status = (p_filters->>'status'))
    AND (p_filters->>'approval_mode' IS NULL OR m.approval_mode = (p_filters->>'approval_mode'))
    AND (p_filters->>'confidentiality' IS NULL OR m.confidentiality = (p_filters->>'confidentiality'))
    AND (p_filters->>'org_unit_id' IS NULL OR m.org_unit_id = (p_filters->>'org_unit_id')::uuid)
    AND (p_filters->>'secretary_user_id' IS NULL OR m.secretary_user_id = (p_filters->>'secretary_user_id')::uuid)
    AND (p_filters->>'chair_user_id' IS NULL OR m.chair_user_id = (p_filters->>'chair_user_id')::uuid)
    AND (p_filters->>'meeting_type' IS NULL OR m.meeting_type = (p_filters->>'meeting_type'))
    AND (p_filters->>'has_decisions' IS NULL OR (
      (p_filters->>'has_decisions')::boolean AND EXISTS (
        SELECT 1 FROM public.minutes_decisions d WHERE d.minute_id = m.id
      )
    ) OR (
      NOT (p_filters->>'has_decisions')::boolean AND NOT EXISTS (
        SELECT 1 FROM public.minutes_decisions d WHERE d.minute_id = m.id
      )
    ))
  LIMIT v_limit OFFSET v_offset;

  SELECT count(*) INTO v_total
  FROM public.minutes m
  WHERE public._user_can_view_minute(m.id)
    AND (p_filters->>'status' IS NULL OR m.status = (p_filters->>'status'))
    AND (p_filters->>'approval_mode' IS NULL OR m.approval_mode = (p_filters->>'approval_mode'))
    AND (p_filters->>'confidentiality' IS NULL OR m.confidentiality = (p_filters->>'confidentiality'))
    AND (p_filters->>'org_unit_id' IS NULL OR m.org_unit_id = (p_filters->>'org_unit_id')::uuid)
    AND (p_filters->>'secretary_user_id' IS NULL OR m.secretary_user_id = (p_filters->>'secretary_user_id')::uuid)
    AND (p_filters->>'chair_user_id' IS NULL OR m.chair_user_id = (p_filters->>'chair_user_id')::uuid)
    AND (p_filters->>'meeting_type' IS NULL OR m.meeting_type = (p_filters->>'meeting_type'))
    AND (p_filters->>'has_decisions' IS NULL OR (
      (p_filters->>'has_decisions')::boolean AND EXISTS (
        SELECT 1 FROM public.minutes_decisions d WHERE d.minute_id = m.id
      )
    ) OR (
      NOT (p_filters->>'has_decisions')::boolean AND NOT EXISTS (
        SELECT 1 FROM public.minutes_decisions d WHERE d.minute_id = m.id
      )
    ));

  RETURN jsonb_build_object('rows', v_rows, 'total_count', v_total);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.search_minutes_report(jsonb,int,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_minutes_report(jsonb,int,int) TO authenticated;
ALTER FUNCTION public.search_minutes_report(jsonb,int,int) OWNER TO postgres;
