BEGIN;
DO $test$
DECLARE
  u uuid;
  epoch integer;
  active_id uuid := gen_random_uuid();
  old_orphan uuid := gen_random_uuid();
  recent_orphan uuid := gen_random_uuid();
  old_backed uuid := gen_random_uuid();
  revoked_id uuid := gen_random_uuid();
  listing jsonb;
  settings_before jsonb;
  n integer;
  original_absolute timestamptz;
BEGIN
  SELECT p.user_id, COALESCE(p.auth_epoch,1) INTO u, epoch
  FROM public.profiles p JOIN auth.users a ON a.id=p.user_id LIMIT 1;
  IF u IS NULL THEN RAISE EXCEPTION 'TEST_USER_REQUIRED'; END IF;
  SELECT to_jsonb(a) INTO settings_before FROM public.auth_security_settings a WHERE id=1;
  INSERT INTO auth.sessions(id,user_id,created_at,updated_at)
  VALUES(active_id,u,now()-interval '45 days',now()),
        (old_backed,u,now()-interval '50 days',now()),
        (revoked_id,u,now()-interval '2 days',now());
  INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,created_at,last_activity_at,idle_expiry_at,absolute_expiry_at,revoked_at)
  VALUES
    (active_id,u,epoch,now()-interval '45 days',now(),now()+interval '8 hours',now()+interval '1 day',null),
    (old_orphan,u,epoch,now()-interval '50 days',now()-interval '45 days',now()-interval '44 days',now()-interval '44 days',null),
    (recent_orphan,u,epoch,now()-interval '3 days',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day',null),
    (old_backed,u,epoch,now()-interval '50 days',now()-interval '45 days',now()-interval '44 days',now()-interval '44 days',null),
    (revoked_id,u,epoch,now()-interval '2 days',now()-interval '1 day',now()+interval '8 hours',now()+interval '1 day',now()-interval '1 day');

  SELECT private.get_user_session_security_state_impl(u) INTO listing;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'sessions') s WHERE s->>'session_id'=active_id::text AND s->>'status'='active')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'sessions') s WHERE s->>'session_id' IN (old_orphan::text,old_backed::text)) THEN
    RAISE EXCEPTION 'SESSION_PRESENTATION_RETENTION_FAILED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'sessions') s WHERE s->>'session_id'=revoked_id::text AND s->>'status'='revoked') THEN
    RAISE EXCEPTION 'RECENT_REVOCATION_HISTORY_LOST';
  END IF;
  SELECT absolute_expiry_at INTO original_absolute FROM public.session_security_state WHERE session_id=active_id;
  PERFORM public.register_session_security_state_v2(active_id,u,480,1440,'test',null);
  PERFORM public.register_session_security_state_v2(active_id,u,480,1440,'test',null);
  PERFORM public.touch_session_security_state(active_id,u,epoch,480);
  PERFORM public.touch_session_security_state(active_id,u,epoch,480);
  IF (SELECT count(*) FROM public.session_security_state WHERE session_id=active_id)<>1
     OR (SELECT absolute_expiry_at FROM public.session_security_state WHERE session_id=active_id) IS DISTINCT FROM original_absolute THEN
    RAISE EXCEPTION 'SESSION_REGISTRATION_OR_HEARTBEAT_DUPLICATED_STATE';
  END IF;
  UPDATE public.session_security_state SET auth_epoch=epoch+1 WHERE session_id=active_id;
  SELECT private.get_user_session_security_state_impl(u) INTO listing;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(listing->'sessions') s WHERE s->>'session_id'=active_id::text AND s->>'status'='active') THEN
    RAISE EXCEPTION 'STALE_EPOCH_SHOWN_ACTIVE';
  END IF;
  UPDATE public.session_security_state SET auth_epoch=epoch WHERE session_id=active_id;
  SELECT private.cleanup_session_security_history() INTO n;
  IF n<1 OR EXISTS(SELECT 1 FROM public.session_security_state WHERE session_id=old_orphan)
     OR (SELECT count(*) FROM public.session_security_state WHERE session_id IN(active_id,recent_orphan,old_backed,revoked_id))<>4
     OR (SELECT count(*) FROM auth.sessions WHERE id IN(active_id,old_backed,revoked_id))<>3 THEN
    RAISE EXCEPTION 'SESSION_CLEANUP_SAFETY_FAILED';
  END IF;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid())::text,true);
  SELECT private.get_user_session_security_state_impl(u) INTO listing;
  IF listing->>'error' <> 'FORBIDDEN' THEN RAISE EXCEPTION 'CROSS_USER_SESSION_ACCESS'; END IF;
  PERFORM set_config('request.jwt.claims','{}',true);
  IF has_function_privilege('anon','private.cleanup_session_security_history()','EXECUTE')
     OR has_function_privilege('authenticated','private.cleanup_session_security_history()','EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC_CLEANUP_EXECUTION';
  END IF;
  IF settings_before IS DISTINCT FROM (SELECT to_jsonb(a) FROM public.auth_security_settings a WHERE id=1) THEN
    RAISE EXCEPTION 'SECURITY_POLICY_CHANGED';
  END IF;
END;
$test$;
SELECT 'passed: retention, current/active protection, Auth preservation, epoch classification, user isolation, execution permissions, unchanged timeouts' AS result;
ROLLBACK;