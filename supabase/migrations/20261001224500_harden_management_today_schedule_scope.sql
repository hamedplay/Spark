-- Ensure management-dashboard meeting scope is enforced server-side even when
-- the caller's ordinary meetings RLS would hide subordinate meetings.

CREATE OR REPLACE FUNCTION private.get_management_today_schedule_v1(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH scoped_users AS (
    SELECT scoped_user_id AS user_id
    FROM private.get_management_scope_users_v1(p_user_id)
  ),
  scoped_today_schedule AS (
    SELECT
      m.id,
      m.subject,
      m.start_time,
      m.location,
      m.is_online,
      m.status_type
    FROM public.meetings m
    WHERE m.request_date IS NOT NULL
      AND m.request_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
      AND (m.request_date::timestamptz AT TIME ZONE 'Asia/Tehran')::date = (timezone('Asia/Tehran', now()))::date
      AND (
        m.user_id IN (SELECT user_id FROM scoped_users)
        OR m.meeting_manager IN (SELECT user_id FROM scoped_users)
        OR EXISTS (
          SELECT 1
          FROM scoped_users su
          WHERE su.user_id = ANY(COALESCE(m.participant_user_ids, '{}'::uuid[]))
        )
        OR EXISTS (
          SELECT 1
          FROM scoped_users su
          WHERE su.user_id = ANY(COALESCE(m.notify_users, '{}'::uuid[]))
        )
      )
    ORDER BY NULLIF(m.start_time, '')::time NULLS LAST, m.created_at
    LIMIT 8
  )
  SELECT COALESCE(
    jsonb_agg(to_jsonb(sts) ORDER BY sts.start_time NULLS LAST),
    '[]'::jsonb
  )
  FROM scoped_today_schedule sts;
$function$;

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_start_marker text := E'  v_result := jsonb_set(\n    v_result,\n    ''{today_schedule}'',';
  v_end_marker text := E'\n\n  RETURN v_result;';
  v_start integer;
  v_relative_end integer;
  v_end integer;
  v_replacement text := E'  v_result := jsonb_set(\n    v_result,\n    ''{today_schedule}'',\n    private.get_management_today_schedule_v1(p_user_id),\n    true\n  );';
BEGIN
  SELECT p.oid
    INTO v_function_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_management_dashboard_for_user_v1'
    AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'get_management_dashboard_for_user_v1(p_user_id uuid) not found';
  END IF;

  v_definition := replace(pg_get_functiondef(v_function_oid), E'\r\n', E'\n');

  IF position('private.get_management_today_schedule_v1(p_user_id)' in v_definition) > 0 THEN
    RETURN;
  END IF;

  v_start := position(v_start_marker in v_definition);
  IF v_start = 0 THEN
    RAISE EXCEPTION 'Expected today_schedule patch start marker not found';
  END IF;

  v_relative_end := position(v_end_marker in substring(v_definition from v_start));
  IF v_relative_end = 0 THEN
    RAISE EXCEPTION 'Expected today_schedule patch end marker not found';
  END IF;

  v_end := v_start + v_relative_end - 1;
  v_definition := substring(v_definition from 1 for v_start - 1)
                  || v_replacement
                  || substring(v_definition from v_end);

  EXECUTE v_definition;
END;
$migration$;
