BEGIN;
DO $test$
DECLARE u uuid; sid uuid:=gen_random_uuid(); epoch integer; c record; state jsonb;
BEGIN
 SELECT p.user_id,coalesce(p.auth_epoch,1) INTO u,epoch FROM public.profiles p JOIN auth.users a ON a.id=p.user_id WHERE p.account_status='ACTIVE' AND p.is_active IS TRUE LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'TEST_USER_REQUIRED'; END IF;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(sid,u,now(),now());
 INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at) VALUES(sid,u,epoch,now()+interval '1 hour',now()+interval '1 day');
 PERFORM public.record_session_connection_service_v1(sid,u,'{"user-agent":"Test Chrome 156"}');
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'session_id',sid,'aal','aal1')::text,true);
 PERFORM set_config('request.headers','{"x-spark-client-ip-source":"nginx-v2","x-spark-client-ip":"192.0.2.25","user-agent":"Test Chrome 156"}',true);
 IF NOT public.record_my_login_connection_v1() THEN RAISE EXCEPTION 'BROWSER_LOGIN_RECOVERY_FAILED'; END IF;
 SELECT * INTO c FROM private.session_connection_context WHERE session_id=sid;
 IF host(c.initial_ip)<>'192.0.2.25' OR c.observation_kind<>'browser_login' OR c.last_ip_observed_at IS NULL THEN RAISE EXCEPTION 'INITIAL_IP_NOT_RECOVERED'; END IF;
 PERFORM private.capture_session_connection_v1(sid,u,NULL,'internal','{}','first_full_access');
 IF (SELECT host(last_ip) FROM private.session_connection_context WHERE session_id=sid)<>'192.0.2.25' THEN RAISE EXCEPTION 'INTERNAL_HOP_ERASED_VALID_IP'; END IF;
 SELECT private.get_my_auth_access_state_v3() INTO state;
 IF state->>'access_level'='FULL' THEN
  PERFORM set_config('request.headers','{"x-spark-client-ip-source":"nginx-v2","x-spark-client-ip":"2001:db8::25","user-agent":"Test Android 16"}',true);
  INSERT INTO public.user_presence(user_id,last_seen,is_online,status) VALUES(u,now(),true,'online')
   ON CONFLICT(user_id) DO UPDATE SET last_seen=now(),is_online=true;
  IF (SELECT host(last_ip) FROM private.session_connection_context WHERE session_id=sid)<>'2001:db8::25' THEN RAISE EXCEPTION 'DIRECT_PRESENCE_INGRESS_FAILED'; END IF;
 END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 BEGIN PERFORM public.get_online_sessions_v1(); RAISE EXCEPTION 'READ_SHOULD_BE_DENIED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.revoke_online_sessions_v1(u,sid,'test'); RAISE EXCEPTION 'KICK_SHOULD_BE_DENIED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF has_function_privilege('anon','public.get_online_sessions_v1(text)','EXECUTE') OR has_function_privilege('anon','public.revoke_online_sessions_v1(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'ANON_PRIVILEGE'; END IF;
END;
$test$;
SELECT 'passed: browser login recovery, missing internal headers preserve IP, guarded direct presence capture, denied reads and revocations, no anonymous privileges; all fixtures roll back' AS result;
ROLLBACK;
