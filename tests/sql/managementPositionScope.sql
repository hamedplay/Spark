-- TEST DATABASE ONLY. Fixture writes and auth stubs are all rolled back.
BEGIN;
SET LOCAL statement_timeout = '25s';
CREATE OR REPLACE FUNCTION private.is_current_session_fully_authorized()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce(current_setting('spark.test_full', true), '') = 'true' $$;
CREATE OR REPLACE FUNCTION public._has_permission(p_user_id uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT false $$;
DO $test$
DECLARE
  users uuid[];
  unit_id uuid;
  top_pos uuid := gen_random_uuid();
  manager_pos uuid := gen_random_uuid();
  child_pos uuid := gen_random_uuid();
  peer_pos uuid := gen_random_uuid();
  visible_task uuid := gen_random_uuid();
  hidden_task uuid := gen_random_uuid();
  actual uuid[];
  caps jsonb;
  dashboard jsonb;
  rows_result jsonb;
  elem jsonb;
BEGIN
  SELECT array_agg(user_id) INTO users FROM (
    SELECT user_id FROM public.profiles ORDER BY user_id LIMIT 4
  ) p;
  IF cardinality(users) <> 4 THEN RAISE EXCEPTION 'Four test profiles required'; END IF;
  SELECT id INTO unit_id FROM public.org_units ORDER BY id LIMIT 1;
  INSERT INTO public.org_positions(id, unit_id, title, level, parent_position_id)
  VALUES (top_pos, unit_id, 'scope-test-top', 1, NULL),
    (manager_pos, unit_id, 'scope-test-manager', 2, top_pos),
    (child_pos, unit_id, 'scope-test-child', 3, manager_pos),
    (peer_pos, unit_id, 'scope-test-peer', 2, top_pos);
  DELETE FROM public.org_position_members WHERE user_id = ANY(users);
  UPDATE public.profiles SET is_admin = false, is_active = true,
    account_status = 'ACTIVE', primary_unit_id = unit_id,
    primary_position_id = CASE user_id
      WHEN users[1] THEN top_pos WHEN users[2] THEN manager_pos
      WHEN users[3] THEN child_pos ELSE peer_pos END
  WHERE user_id = ANY(users);
  INSERT INTO public.tasks(id, title, description, assignee, user_id, current_assignee_id)
  VALUES (visible_task, 'scope-test-visible', '', '', users[3], users[3]),
    (hidden_task, 'scope-test-hidden', '', '', users[4], users[4]);

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[2], 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', users[2]::text, true);
  PERFORM set_config('spark.test_full', 'true', true);
  IF NOT public.has_management_dashboard_access_v1() THEN RAISE EXCEPTION 'Ordinary FULL user denied'; END IF;
  SELECT array_agg(scoped_user_id ORDER BY scoped_user_id) INTO actual
  FROM private.get_management_scope_users_v1(users[2]);
  IF cardinality(actual) <> 2 OR NOT users[2] = ANY(actual) OR NOT users[3] = ANY(actual)
    OR users[1] = ANY(actual) OR users[4] = ANY(actual) THEN
    RAISE EXCEPTION 'Peer/superior scope leak';
  END IF;
  IF EXISTS (SELECT 1 FROM private.get_management_scope_units_v1(users[2])) THEN
    RAISE EXCEPTION 'Unit-wide scope leak';
  END IF;
  caps := public.get_management_capabilities_v1();
  IF NOT (caps->>'tasks_view')::boolean OR NOT (caps->>'decisions_view')::boolean
    OR (caps->>'tasks_manage')::boolean OR (caps->>'decisions_manage')::boolean THEN
    RAISE EXCEPTION 'Read/write permission separation failed';
  END IF;
  rows_result := public.get_management_tasks_v2(p_search => 'scope-test-', p_limit => 250);
  IF (rows_result->>'total_count')::integer <> 1
     OR rows_result->'rows'->0->>'id' <> visible_task::text THEN
    RAISE EXCEPTION 'Task list scope failed';
  END IF;
  BEGIN
    PERFORM public.manage_management_task_v1(visible_task, 'in_progress', 10, NULL, NULL, NULL, 'test');
    RAISE EXCEPTION 'Write privilege was widened' USING ERRCODE = 'XX000';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  dashboard := public.get_management_dashboard_v1();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(dashboard->'important_tasks') e
             WHERE e->>'id' = hidden_task::text) THEN
    RAISE EXCEPTION 'Dashboard task leak';
  END IF;
  FOR elem IN SELECT * FROM jsonb_array_elements(dashboard->'recent_meetings') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = (elem->>'id')::uuid
      AND (m.user_id = ANY(actual) OR m.meeting_manager = ANY(actual)
        OR coalesce(m.participant_user_ids, '{}'::uuid[]) && actual
        OR coalesce(m.notify_users, '{}'::uuid[]) && actual)) THEN
      RAISE EXCEPTION 'Dashboard meeting leak';
    END IF;
  END LOOP;
  -- Calls to these RPCs must no longer require old per-group view grants.
  PERFORM public.get_management_decisions_v3();
  PERFORM public.get_management_minutes_v1();
  PERFORM public.get_management_minutes_dashboard_stats_v1();
  IF jsonb_array_length(public.get_management_scope_people_v1()) <> 2 THEN
    RAISE EXCEPTION 'People scope failed';
  END IF;
  BEGIN
    PERFORM public.get_management_dashboard_for_user_v1(users[4]);
    RAISE EXCEPTION 'Caller impersonation allowed' USING ERRCODE = 'XX000';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  dashboard := public.get_management_dashboard_for_user_v1(users[2]);
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(dashboard->'important_tasks') e
             WHERE e->>'id' = hidden_task::text) THEN
    RAISE EXCEPTION 'Service adapter scope leak';
  END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[2], 'role', 'authenticated')::text, true);
  PERFORM set_config('spark.test_full', 'false', true);
  IF public.has_management_dashboard_access_v1() THEN RAISE EXCEPTION 'Restricted session allowed'; END IF;
  BEGIN
    PERFORM public.get_management_dashboard_v1();
    RAISE EXCEPTION 'Restricted dashboard allowed' USING ERRCODE = 'XX000';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('spark.test_full', 'true', true);
  PERFORM set_config('request.jwt.claim.sub', users[3]::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', users[3], 'role', 'authenticated')::text, true);
  SELECT array_agg(scoped_user_id) INTO actual FROM private.get_management_scope_users_v1(users[3]);
  IF actual <> ARRAY[users[3]] THEN RAISE EXCEPTION 'Leaf user must see only self'; END IF;
  UPDATE public.org_positions SET parent_position_id = child_pos WHERE id = manager_pos;
  IF (SELECT count(*) FROM private.get_management_scope_users_v1(users[2])) <> 2 THEN
    RAISE EXCEPTION 'Cycle guard failed';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  IF public.has_management_dashboard_access_v1() THEN RAISE EXCEPTION 'Anonymous dashboard allowed'; END IF;
END;
$test$;
ROLLBACK;
