BEGIN;
DO $test$
DECLARE u uuid; sid uuid:=gen_random_uuid(); epoch integer; listing jsonb; row jsonb; original_ip text;
BEGIN
 SELECT p.user_id,coalesce(p.auth_epoch,1) INTO u,epoch FROM public.profiles p JOIN auth.users a ON a.id=p.user_id LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'TEST_USER_REQUIRED'; END IF;
 INSERT INTO auth.sessions(id,user_id,created_at,updated_at) VALUES(sid,u,now(),now());
 INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
 VALUES(sid,u,epoch,now()+interval '8 hours',now()+interval '1 day');
 IF private.request_client_ip_v2('{"x-forwarded-for":"192.0.2.99","x-spark-client-ip":"192.0.2.88"}') IS NOT NULL THEN RAISE EXCEPTION 'UNVERIFIED_HEADER_TRUSTED'; END IF;
 PERFORM public.record_session_connection_service_v1(sid,u,'{"x-spark-client-ip":"2001:db8::7","x-spark-client-ip-source":"nginx-v2","user-agent":"test Android 16"}');
 PERFORM private.capture_session_connection_v1(sid,u,'192.0.2.8','test Windows','{"platform":"Windows","platformVersion":"15.0.0","access_token":"SECRET","ip":"FAKE"}','first_full_access');
 SELECT host(initial_ip) INTO original_ip FROM private.session_connection_context WHERE session_id=sid;
 IF original_ip<>'2001:db8::7' OR EXISTS(SELECT FROM private.session_connection_context WHERE session_id=sid AND (client_hints ? 'access_token' OR client_hints ? 'ip')) THEN RAISE EXCEPTION 'INITIAL_IP_OR_REDACTION_FAILED'; END IF;
 SELECT private.get_user_session_security_state_impl(u) INTO listing;
 SELECT value INTO row FROM jsonb_array_elements(listing->'sessions') WHERE value->>'session_id'=sid::text;
 IF row->>'presence'<>'online' OR row->>'initial_ip'<>'2001:db8::7' OR row->>'last_ip'<>'192.0.2.8' THEN RAISE EXCEPTION 'ONLINE_PROJECTION_FAILED'; END IF;
 UPDATE private.session_connection_context SET last_observed_at=now()-interval '2 hours' WHERE session_id=sid;
 SELECT private.get_user_session_security_state_impl(u) INTO listing;
 SELECT value INTO row FROM jsonb_array_elements(listing->'sessions') WHERE value->>'session_id'=sid::text;
 IF row->>'presence'<>'offline' OR row->>'status'<>'active' THEN RAISE EXCEPTION 'OFFLINE_IS_NOT_REVOKED'; END IF;
 DELETE FROM auth.sessions WHERE id=sid;
 IF NOT EXISTS(SELECT FROM private.session_connection_context WHERE session_id=sid AND ended_at IS NOT NULL) THEN RAISE EXCEPTION 'SESSION_END_NOT_RETAINED'; END IF;
 SELECT private.get_user_session_security_state_impl(u) INTO listing;
 SELECT value INTO row FROM jsonb_array_elements(listing->'sessions') WHERE value->>'session_id'=sid::text;
 IF row->>'presence'<>'ended' OR row->>'ended_at' IS NULL THEN RAISE EXCEPTION 'END_PROJECTION_FAILED'; END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',gen_random_uuid())::text,true);
 IF private.get_user_session_security_state_impl(u)->>'error'<>'FORBIDDEN' THEN RAISE EXCEPTION 'CROSS_USER_READ'; END IF;
 PERFORM set_config('request.jwt.claims','{}',true);
 IF has_function_privilege('authenticated','public.record_session_connection_service_v1(uuid,uuid,jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.record_my_session_connection_v1(jsonb)','EXECUTE')
 OR has_table_privilege('authenticated','private.session_connection_context','SELECT') THEN RAISE EXCEPTION 'NETWORK_EVIDENCE_GRANTS'; END IF;
 row:=private.event_network_projection_v1('{"ip_address":"172.18.0.1","metadata":{"ip_source":"auth_service"}}');
 IF row->>'ip_address' IS NOT NULL OR row->'metadata'->>'reported_ip_address'<>'172.18.0.1' THEN RAISE EXCEPTION 'HISTORICAL_IP_MISATTRIBUTION'; END IF;
 DELETE FROM public.session_security_state WHERE session_id=sid;
 IF EXISTS(SELECT FROM private.session_connection_context WHERE session_id=sid) THEN RAISE EXCEPTION 'RETENTION_CASCADE'; END IF;
END;
$test$;
SELECT 'passed: IP provenance, IPv6, immutable initial IP, latest IP, hint redaction, presence, logout observation, ownership, grants and retention' AS result;
ROLLBACK;
