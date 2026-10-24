-- TEST DATABASE ONLY: all fixtures and the FULL-session stub are rolled back.
BEGIN;
SET LOCAL statement_timeout = '25s';
CREATE OR REPLACE FUNCTION private.is_current_session_fully_authorized()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT coalesce(current_setting('spark.test_full', true), '') = 'true' $$;
DO $test$
DECLARE
  users uuid[];
  v_meeting_id uuid := gen_random_uuid();
  result record;
  before_ids uuid[];
BEGIN
  SELECT array_agg(user_id) INTO users FROM (SELECT user_id FROM public.profiles ORDER BY user_id LIMIT 6) p;
  IF cardinality(users) <> 6 THEN RAISE EXCEPTION 'Six test profiles required'; END IF;
  UPDATE public.profiles SET organization = 'spark-participant-test', account_status = 'ACTIVE', is_active = true, is_hidden = false WHERE user_id = ANY(users);
  UPDATE public.profiles SET organization = 'spark-other-test' WHERE user_id = users[5];
  INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,notify_users,participant_user_ids,start_time,end_time,status,status_type)
  VALUES(v_meeting_id,'spark-participant-access-test','test','test','',users[1],ARRAY[users[2]],ARRAY[]::uuid[],'09:00','10:00','archived','scheduled');
  PERFORM set_config('spark.test_full','true',true);
  PERFORM set_config('request.jwt.claim.sub',users[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.add_meeting_participant_as_informee(v_meeting_id,users[3]);
  IF result.added IS NOT TRUE OR result.participant_user_id <> users[3] THEN RAISE EXCEPTION 'Organizer denied'; END IF;
  RESET ROLE;
  IF NOT EXISTS(SELECT 1 FROM public.meeting_inbox i WHERE i.meeting_id=v_meeting_id AND i.user_id=users[3]) THEN RAISE EXCEPTION 'Organizer invite missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_log a WHERE a.entity_id=v_meeting_id::text AND a.details::jsonb->>'source'='organizer') THEN RAISE EXCEPTION 'Organizer audit source incorrect'; END IF;
  PERFORM set_config('request.jwt.claim.sub',users[2]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[2],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.add_meeting_participant_as_informee(v_meeting_id,users[4]);
  IF result.added IS NOT TRUE THEN RAISE EXCEPTION 'Informee denied'; END IF;
  RESET ROLE;
  UPDATE public.meeting_inbox SET status='accepted' WHERE meeting_id=v_meeting_id AND user_id=users[4];
  SET LOCAL ROLE authenticated;
  SELECT * INTO result FROM public.add_meeting_participant_as_informee(v_meeting_id,users[4]);
  IF result.added IS NOT FALSE THEN RAISE EXCEPTION 'Duplicate participant added'; END IF;
  RESET ROLE;
  IF (SELECT status FROM public.meeting_inbox WHERE meeting_id=v_meeting_id AND user_id=users[4]) <> 'accepted' THEN RAISE EXCEPTION 'Duplicate reset accepted status'; END IF;
  SELECT participant_user_ids INTO before_ids FROM public.meetings WHERE id=v_meeting_id;
  -- A participant who is neither organizer nor informee cannot add others.
  PERFORM set_config('request.jwt.claim.sub',users[4]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[4],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(v_meeting_id,users[6]);
    RAISE EXCEPTION 'Unauthorized participant allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub',users[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(v_meeting_id,users[5]);
    RAISE EXCEPTION 'Cross-organization participant allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'CROSS_ORG_PARTICIPANT' THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  UPDATE public.profiles SET account_status='SUSPENDED',is_active=false WHERE user_id=users[6];
  PERFORM set_config('request.jwt.claim.sub',users[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(v_meeting_id,users[6]);
    RAISE EXCEPTION 'Inactive participant allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_PARTICIPANT' THEN RAISE; END IF;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  UPDATE public.profiles SET account_status='ACTIVE',is_active=true,is_hidden=true WHERE user_id=users[6];
  PERFORM set_config('request.jwt.claim.sub',users[1]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',users[1],'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(v_meeting_id,users[6]);
    RAISE EXCEPTION 'Hidden participant allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_PARTICIPANT' THEN RAISE; END IF;
  END;
  PERFORM set_config('spark.test_full','false',true);
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(v_meeting_id,users[6]);
    RAISE EXCEPTION 'Limited session allowed';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
  RESET ROLE;
  IF (SELECT participant_user_ids FROM public.meetings WHERE id=v_meeting_id) IS DISTINCT FROM before_ids THEN RAISE EXCEPTION 'Denied call modified participants'; END IF;
  IF has_function_privilege('anon','public.add_meeting_participant_as_informee(uuid,uuid)','EXECUTE') OR has_function_privilege('anon','private.add_meeting_participant_as_informee(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Anonymous execute leak'; END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid='public.add_meeting_participant_as_informee(uuid,uuid)'::regprocedure) THEN RAISE EXCEPTION 'Public RPC must remain invoker'; END IF;
  RAISE NOTICE 'PASS: organizer, informee, invite, audit, duplicate, participant denial, cross-org, inactive, hidden, FULL gate and ACL';
END;
$test$;
ROLLBACK;
