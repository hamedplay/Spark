/*
# Fix search_decisions_report GROUP BY error

## Problem
The function `public.search_decisions_report` used `jsonb_agg` (an aggregate
function) but placed `ORDER BY d.created_at DESC` at the query level without a
`GROUP BY` clause. PostgreSQL raised:

  column "d.created_at" must appear in the GROUP BY clause or be used in an
  aggregate function

## Fix
Move the `ORDER BY d.created_at DESC` *inside* the `jsonb_agg` aggregate so
the rows are sorted before aggregation, and remove it from the outer query
level. This is the idiomatic Postgres pattern for ordering rows within a
single aggregate group. The separate `count(*)` query is unaffected.

## Behaviour preserved
- Same columns, filters, pagination (LIMIT/OFFSET), and total count.
- Rows still ordered by `d.created_at DESC`.
- SECURITY DEFINER, search_path '', auth.uid() check, and all grants unchanged.

## Security
- No RLS changes.
- No new tables or columns.
- No data added, removed, or modified.
*/

CREATE OR REPLACE FUNCTION public.search_decisions_report(
  p_filters jsonb,
  p_limit   integer,
  p_offset  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_limit  int := LEAST(COALESCE(p_limit, 50), 100);
  v_offset int := GREATEST(COALESCE(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  int;
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
  ) ORDER BY d.created_at DESC), '[]'::jsonb)
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

-- Preserve existing grants
GRANT EXECUTE ON FUNCTION public.search_decisions_report(jsonb, integer, integer) TO authenticated;
