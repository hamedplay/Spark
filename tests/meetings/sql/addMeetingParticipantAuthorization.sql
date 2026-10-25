-- Run on a test database. Fixtures, sessions, inbox and audit rows are rolled back.
BEGIN;
DO $test$
DECLARE
  actors uuid[];
  sessions uuid[] := ARRAY[]::uuid[];
  meeting uuid := gen_random_uuid();
  session uuid;
  actor uuid;
  i integer;
  result record;
  target_org text;
  invalid_target uuid;
  cross_target uuid;
BEGIN
  SELECT array_agg(user_id ORDER BY user_id) INTO actors FROM (
    SELECT p.user_id FROM public.profiles p
    WHERE p.organization = (
      SELECT organization FROM public.profiles WHERE organization <> ''
      GROUP BY organization ORDER BY count(*) DESC LIMIT 1
    ) AND p.is_active AND NOT coalesce(p.is_hidden,false)
      AND p.account_status='ACTIVE' AND p.mfa_method IS NULL
      AND NOT coalesce(p.mfa_enrollment_required,false)
      AND NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=p.user_id AND f.status='verified')
      AND NOT EXISTS(SELECT 1 FROM public.custom_mfa_factors f WHERE f.user_id=p.user_id AND f.factor_status='active')
    ORDER BY p.user_id LIMIT 5
  ) eligible;
  IF cardinality(actors) <> 5 THEN RAISE EXCEPTION 'Need five eligible test actors'; END IF;
  FOREACH actor IN ARRAY actors LOOP
    session := gen_random_uuid();
    sessions := array_append(sessions, session);
    INSERT INTO auth.sessions(id,user_id,aal,created_at,updated_at)
    VALUES(session,actor,'aal1',now(),now());
    INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
    SELECT session,actor,coalesce(p.auth_epoch,1),now()+interval '1 hour',now()+interval '1 day'
    FROM public.profiles p WHERE p.user_id=actor;
  END LOOP;
  INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,notify_users,participant_user_ids)
  VALUES(meeting,'participant authorization regression','','','',actors[1],ARRAY[actors[2]],ARRAY[actors[3]]);

  -- A participant who is neither organizer nor informee may add a new member.
  PERFORM set_config('request.jwt.claim.sub',actors[3]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actors[3],'session_id',sessions[3],'aal','aal1','role','authenticated')::text,true);
  IF NOT private.is_current_session_fully_authorized() THEN RAISE EXCEPTION 'Test participant is not FULL'; END IF;
  SELECT * INTO result FROM public.add_meeting_participant_as_informee(meeting,actors[5]);
  IF result.added IS DISTINCT FROM true THEN RAISE EXCEPTION 'Participant add denied'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.meeting_inbox WHERE meeting_id=meeting AND user_id=actors[5]) THEN RAISE EXCEPTION 'Missing invitation'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.audit_log WHERE entity_id=meeting::text AND details::jsonb->>'source'='participant') THEN RAISE EXCEPTION 'Wrong audit source'; END IF;
  SELECT * INTO result FROM public.add_meeting_participant_as_informee(meeting,actors[5]);
  IF result.added IS DISTINCT FROM false THEN RAISE EXCEPTION 'Duplicate add was not idempotent'; END IF;

  -- Organizer and informee retain access; unrelated users do not gain access.
  FOR i IN 1..4 LOOP
    PERFORM set_config('request.jwt.claim.sub',actors[i]::text,true);
    PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actors[i],'session_id',sessions[i],'aal','aal1','role','authenticated')::text,true);
    IF NOT private.is_current_session_fully_authorized() THEN RAISE EXCEPTION 'Test actor is not FULL'; END IF;
    BEGIN
      SELECT * INTO result FROM public.add_meeting_participant_as_informee(meeting,actors[5]);
      IF i=4 THEN RAISE EXCEPTION 'Unrelated user was authorized'; END IF;
    EXCEPTION WHEN raise_exception THEN
      IF i<>4 OR SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF;
    END;
  END LOOP;

  PERFORM set_config('request.jwt.claim.sub',actors[3]::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actors[3],'session_id',sessions[3],'aal','aal1','role','authenticated')::text,true);
  SELECT organization INTO target_org FROM public.profiles WHERE user_id=actors[4];
  SELECT user_id INTO cross_target FROM public.profiles WHERE coalesce(organization,'') IS DISTINCT FROM target_org AND is_active AND NOT coalesce(is_hidden,false) LIMIT 1;
  IF cross_target IS NULL THEN RAISE EXCEPTION 'Need cross-org target fixture'; END IF;
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(meeting,cross_target);
    RAISE EXCEPTION 'Cross organization target was authorized';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'CROSS_ORG_PARTICIPANT' THEN RAISE; END IF;
  END;
  SELECT user_id INTO invalid_target FROM public.profiles WHERE NOT is_active OR coalesce(is_hidden,false) LIMIT 1;
  IF invalid_target IS NULL THEN RAISE EXCEPTION 'Need invalid target fixture'; END IF;
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(meeting,invalid_target);
    RAISE EXCEPTION 'Inactive target was authorized';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INVALID_PARTICIPANT' THEN RAISE; END IF;
  END;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actors[3],'session_id',gen_random_uuid(),'aal','aal1')::text,true);
  BEGIN
    PERFORM public.add_meeting_participant_as_informee(meeting,actors[4]);
    RAISE EXCEPTION 'Invalid session was authorized';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'NOT_AUTHORIZED' THEN RAISE; END IF;
  END;
END;
$test$;
ROLLBACK;
