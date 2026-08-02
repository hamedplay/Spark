/*
# Fix minutes decisions view publication gate

## Problem
The `get_minutes_decisions_for_view` RPC returned an empty result set for
minutes that were not yet published (e.g. draft, pending_approval). This
caused the "Decisions" tab on the minutes detail page to show an empty state
("مصوبه‌ای ثبت نشده") even when `minutes_decisions` rows existed for that
minute.

## Root cause
Lines 295-297 of the previous migration added a publication gate:
  IF v_minute_status <> 'published' OR v_minute_published_at IS NULL THEN
    RETURN;
  END IF;
This early return suppressed all decision rows for non-published minutes.

## Fix
Remove the publication gate from `get_minutes_decisions_for_view`. Access
control is already enforced by `_can_view_minute` (admin, creator, secretary,
chair, participants, approvers, decision owners, meeting members). The view
RPC is read-only and does not modify data, so showing decisions to authorized
users before publication is the correct behavior — the detail page already
shows all other tabs (summary, participants, agenda) to the same users.

## Security
- No RLS policy changes.
- No table or column changes.
- `_can_view_minute` still gates access: only users who can view the minute
  receive decision rows.
- The `minutes_decisions` SELECT RLS policy is unchanged.
- EXECUTE grant on `get_minutes_decisions_for_view` remains `authenticated`
  only.
*/

CREATE OR REPLACE FUNCTION public.get_minutes_decisions_for_view(p_minute_id uuid)
RETURNS TABLE (
  id uuid, title text, description text, priority text, status text,
  progress_percent integer, start_date date, due_date date,
  responsible_unit_name_snapshot text, primary_owner_user_id uuid,
  owner_name text, requires_followup boolean, latest_update text,
  agenda_result_id uuid, agenda_title text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public._can_view_minute(p_minute_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.minutes m WHERE m.id = p_minute_id
  ) THEN
    RAISE EXCEPTION 'MINUTE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    d.id, d.title, d.description, d.priority::text, d.status::text,
    d.progress_percent, d.start_date, d.due_date,
    d.responsible_unit_name_snapshot, d.primary_owner_user_id,
    COALESCE(p.full_name, p.username, d.primary_owner_user_id::text) AS owner_name,
    d.requires_followup, d.latest_update, d.agenda_result_id,
    ar.agenda_title_snapshot AS agenda_title
  FROM public.minutes_decisions d
  LEFT JOIN public.profiles_public p ON p.user_id = d.primary_owner_user_id
  LEFT JOIN public.minutes_agenda_results ar ON ar.id = d.agenda_result_id
  WHERE d.minute_id = p_minute_id
  ORDER BY d.created_at ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_minutes_decisions_for_view(uuid) TO authenticated;
