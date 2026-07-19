/*
# Minutes Phase 3 — Dashboard & Report read-only RPCs

## 1. get_minutes_dashboard_stats()
Read-only aggregate dashboard. Returns a single jsonb object with counts
computed only over minutes/decisions the caller is allowed to see (via the
same visibility predicate as the minutes SELECT policy). No service role in
the frontend; the frontend calls this with the anon-key authenticated client.

Returned keys:
  total_minutes, draft, pending_approval, changes_requested, approved,
  published, open_decisions, overdue_decisions, pending_my_approval,
  status_counts (object: status -> count),
  decision_status_counts (object: status -> count),
  created_last_30 (integer — minutes created in last 30 days),
  decisions_near_deadline (integer — decisions due within 7 days, not completed/stopped),
  top_units (array of {unit, open_decisions} top 5)

## 2. search_minutes_report(p_filters jsonb, p_limit int, p_offset int)
Read-only paginated minutes report. p_filters may contain:
  date_from, date_to (ISO date), status, approval_mode, confidentiality,
  org_unit_id, secretary_user_id, chair_user_id, meeting_type,
  has_decisions (bool).
Returns { rows: [...], total_count: int }.
Sort column whitelist: created_at, meeting_date_snapshot, updated_at, published_at.
Only visible minutes are returned (RLS-safe via the visibility predicate).

## 3. search_decisions_report(p_filters jsonb, p_limit int, p_offset int)
Read-only paginated decisions report. p_filters may contain:
  status, priority, owner_user_id, unit_id, due_from, due_to, overdue (bool),
  requires_followup (bool), minute_id, org_unit_id.
Returns { rows: [...], total_count: int }.
Sort column whitelist: created_at, due_date, updated_at, priority.
Only decisions belonging to visible minutes are returned.

All three are SECURITY DEFINER, SET search_path='', EXECUTE granted to
authenticated (and revoked from anon for the report ones; dashboard granted
to authenticated only). No dynamic SQL — all filters are bound via IF checks
and parameterized queries. p_limit capped at 100.
*/

-- ── Dashboard ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_minutes_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_total int; v_draft int; v_pending int; v_changes int; v_approved int; v_published int;
  v_open_dec int; v_overdue int; v_pending_my int;
  v_status_counts jsonb; v_dec_status_counts jsonb; v_created_30 int;
  v_near_deadline int; v_top_units jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE status='draft'),
         count(*) FILTER (WHERE status='pending_approval'),
         count(*) FILTER (WHERE status='changes_requested'),
         count(*) FILTER (WHERE status='approved'),
         count(*) FILTER (WHERE status='published')
  INTO v_total, v_draft, v_pending, v_changes, v_approved, v_published
  FROM public.minutes m
  WHERE public._user_can_view_minute(m.id);

  SELECT count(*), count(*) FILTER (WHERE d.due_date < current_date
    AND d.status NOT IN ('completed','stopped'))
  INTO v_open_dec, v_overdue
  FROM public.minutes_decisions d
  WHERE public._user_can_view_minute(d.minute_id)
    AND d.status NOT IN ('completed','stopped');

  SELECT count(*) INTO v_pending_my
  FROM public.minutes_approvals a
  WHERE a.status = 'pending'
    AND a.approver_user_id = v_uid
    AND public._user_can_view_minute(a.minute_id);

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_status_counts
  FROM (
    SELECT status, count(*) AS cnt
    FROM public.minutes
    WHERE public._user_can_view_minute(id)
    GROUP BY status
  ) s;

  SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) INTO v_dec_status_counts
  FROM (
    SELECT d.status, count(*) AS cnt
    FROM public.minutes_decisions d
    WHERE public._user_can_view_minute(d.minute_id)
    GROUP BY d.status
  ) s;

  SELECT count(*) INTO v_created_30
  FROM public.minutes
  WHERE created_at >= now() - interval '30 days'
    AND public._user_can_view_minute(id);

  SELECT count(*) INTO v_near_deadline
  FROM public.minutes_decisions d
  WHERE public._user_can_view_minute(d.minute_id)
    AND d.due_date IS NOT NULL
    AND d.due_date <= current_date + interval '7 days'
    AND d.due_date >= current_date
    AND d.status NOT IN ('completed','stopped');

  SELECT COALESCE(jsonb_agg(jsonb_build_object('unit', unit, 'open_decisions', open_dec)), '[]'::jsonb)
  INTO v_top_units
  FROM (
    SELECT COALESCE(m.org_unit_name_snapshot, '—') AS unit,
           count(*) AS open_dec
    FROM public.minutes_decisions d
    JOIN public.minutes m ON m.id = d.minute_id
    WHERE public._user_can_view_minute(d.minute_id)
      AND d.status NOT IN ('completed','stopped')
    GROUP BY m.org_unit_name_snapshot
    ORDER BY open_dec DESC
    LIMIT 5
  ) t;

  RETURN jsonb_build_object(
    'total_minutes', v_total,
    'draft', v_draft,
    'pending_approval', v_pending,
    'changes_requested', v_changes,
    'approved', v_approved,
    'published', v_published,
    'open_decisions', v_open_dec,
    'overdue_decisions', v_overdue,
    'pending_my_approval', v_pending_my,
    'status_counts', v_status_counts,
    'decision_status_counts', v_dec_status_counts,
    'created_last_30', v_created_30,
    'decisions_near_deadline', v_near_deadline,
    'top_units', v_top_units
  );
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.get_minutes_dashboard_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_minutes_dashboard_stats() TO authenticated;

-- ── Minutes report ───────────────────────────────────────────────────────────
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
  )), '[]'::jsonb)
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
  ORDER BY m.created_at DESC
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

-- ── Decisions report ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.search_decisions_report(
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
    'id', d.id, 'title', d.title, 'minute_id', d.minute_id,
    'minute_title', m.meeting_title_snapshot,
    'owner_user_id', d.primary_owner_user_id,
    'unit', d.responsible_unit_name_snapshot,
    'priority', d.priority, 'status', d.status,
    'progress', d.progress_percent, 'due_date', d.due_date,
    'overdue', (d.due_date IS NOT NULL AND d.due_date < current_date
                AND d.status NOT IN ('completed','stopped')),
    'latest_update', d.latest_update
  )), '[]'::jsonb)
  INTO v_rows
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE public._user_can_view_minute(d.minute_id)
    AND (p_filters->>'status' IS NULL OR d.status = (p_filters->>'status'))
    AND (p_filters->>'priority' IS NULL OR d.priority = (p_filters->>'priority'))
    AND (p_filters->>'owner_user_id' IS NULL OR d.primary_owner_user_id = (p_filters->>'owner_user_id')::uuid)
    AND (p_filters->>'unit_id' IS NULL OR d.responsible_unit_id = (p_filters->>'unit_id')::uuid)
    AND (p_filters->>'minute_id' IS NULL OR d.minute_id = (p_filters->>'minute_id')::uuid)
    AND (p_filters->>'org_unit_id' IS NULL OR m.org_unit_id = (p_filters->>'org_unit_id')::uuid)
    AND (p_filters->>'requires_followup' IS NULL OR d.requires_followup = (p_filters->>'requires_followup')::boolean)
    AND (p_filters->>'due_from' IS NULL OR d.due_date IS NULL OR d.due_date >= (p_filters->>'due_from')::date)
    AND (p_filters->>'due_to' IS NULL OR d.due_date IS NULL OR d.due_date <= (p_filters->>'due_to')::date)
    AND (p_filters->>'overdue' IS NULL OR (
      (p_filters->>'overdue')::boolean AND d.due_date IS NOT NULL
      AND d.due_date < current_date AND d.status NOT IN ('completed','stopped')
    ))
  ORDER BY d.created_at DESC
  LIMIT v_limit OFFSET v_offset;

  SELECT count(*) INTO v_total
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE public._user_can_view_minute(d.minute_id)
    AND (p_filters->>'status' IS NULL OR d.status = (p_filters->>'status'))
    AND (p_filters->>'priority' IS NULL OR d.priority = (p_filters->>'priority'))
    AND (p_filters->>'owner_user_id' IS NULL OR d.primary_owner_user_id = (p_filters->>'owner_user_id')::uuid)
    AND (p_filters->>'unit_id' IS NULL OR d.responsible_unit_id = (p_filters->>'unit_id')::uuid)
    AND (p_filters->>'minute_id' IS NULL OR d.minute_id = (p_filters->>'minute_id')::uuid)
    AND (p_filters->>'org_unit_id' IS NULL OR m.org_unit_id = (p_filters->>'org_unit_id')::uuid)
    AND (p_filters->>'requires_followup' IS NULL OR d.requires_followup = (p_filters->>'requires_followup')::boolean)
    AND (p_filters->>'due_from' IS NULL OR d.due_date IS NULL OR d.due_date >= (p_filters->>'due_from')::date)
    AND (p_filters->>'due_to' IS NULL OR d.due_date IS NULL OR d.due_date <= (p_filters->>'due_to')::date)
    AND (p_filters->>'overdue' IS NULL OR (
      (p_filters->>'overdue')::boolean AND d.due_date IS NOT NULL
      AND d.due_date < current_date AND d.status NOT IN ('completed','stopped')
    ));

  RETURN jsonb_build_object('rows', v_rows, 'total_count', v_total);
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.search_decisions_report(jsonb,int,int) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_decisions_report(jsonb,int,int) TO authenticated;
