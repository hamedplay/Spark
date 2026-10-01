-- Scope the management dashboard "today schedule" to the current manager's
-- existing organizational management scope. This intentionally does not alter
-- meetings RLS or the legacy/global dashboard payload used by other callers.

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_anchor text := E'  v_result := jsonb_set(v_result, ''{deadline_alerts}'', v_deadlines, true);\n\n  RETURN v_result;';
  v_replacement text := E'  v_result := jsonb_set(v_result, ''{deadline_alerts}'', v_deadlines, true);\n\n  v_result := jsonb_set(\n    v_result,\n    ''{today_schedule}'',\n    COALESCE((\n      WITH scoped_users AS (\n        SELECT scoped_user_id AS user_id\n        FROM private.get_management_scope_users_v1(p_user_id)\n      ),\n      scoped_today_schedule AS (\n        SELECT\n          m.id,\n          m.subject,\n          m.start_time,\n          m.location,\n          m.is_online,\n          m.status_type\n        FROM public.meetings m\n        WHERE m.request_date IS NOT NULL\n          AND m.request_date ~ ''^[0-9]{4}-[0-9]{2}-[0-9]{2}''\n          AND (m.request_date::timestamptz AT TIME ZONE ''Asia/Tehran'')::date = v_today\n          AND (\n            m.user_id IN (SELECT user_id FROM scoped_users)\n            OR m.meeting_manager IN (SELECT user_id FROM scoped_users)\n            OR EXISTS (\n              SELECT 1\n              FROM scoped_users su\n              WHERE su.user_id = ANY(COALESCE(m.participant_user_ids, ''{}''::uuid[]))\n            )\n            OR EXISTS (\n              SELECT 1\n              FROM scoped_users su\n              WHERE su.user_id = ANY(COALESCE(m.notify_users, ''{}''::uuid[]))\n            )\n          )\n        ORDER BY NULLIF(m.start_time, '''')::time NULLS LAST, m.created_at\n        LIMIT 8\n      )\n      SELECT jsonb_agg(to_jsonb(sts) ORDER BY sts.start_time NULLS LAST)\n      FROM scoped_today_schedule sts\n    ), ''[]''::jsonb),\n    true\n  );\n\n  RETURN v_result;';
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

  -- Idempotency guard for environments where this migration's change has
  -- already been applied manually.
  IF position('scoped_today_schedule AS (' in v_definition) > 0 THEN
    RETURN;
  END IF;

  IF position(v_anchor in v_definition) = 0 THEN
    RAISE EXCEPTION 'Expected management dashboard function patch anchor not found';
  END IF;

  v_definition := replace(v_definition, v_anchor, v_replacement);
  EXECUTE v_definition;
END;
$migration$;
