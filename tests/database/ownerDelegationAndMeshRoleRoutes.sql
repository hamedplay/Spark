-- Actual authenticated/anonymous/service roles. All fixtures/settings roll back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL plpgsql.check_asserts=on;
INSERT INTO public.system_config(section,key,value,value_type) VALUES('video_conference','enabled','true','boolean')
ON CONFLICT(section,key) DO UPDATE SET value=EXCLUDED.value;
UPDATE public.auth_security_settings SET session_management_enabled=true,mfa_policy='disabled' WHERE id=1;
CREATE TEMP TABLE client_route_users AS SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,3)n;
GRANT SELECT ON client_route_users TO anon,authenticated,service_role;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}','{}' FROM client_route_users;
INSERT INTO public.profiles(user_id,full_name,organization,account_status,is_active,profile_completion_status,registration_source)
SELECT user_id,'Client route fixture '||n,CASE WHEN n=3 THEN 'Client route B' ELSE 'Client route A' END,'ACTIVE',true,'COMPLETE','imported' FROM client_route_users;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM client_route_users;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM client_route_users u JOIN public.profiles p USING(user_id);
CREATE TEMP TABLE client_route_objects AS SELECT n,gen_random_uuid() meeting_id,gen_random_uuid() room_id FROM generate_series(0,1)n;
GRANT SELECT ON client_route_objects TO anon,authenticated,service_role;
INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,request_date,start_time,end_time)
SELECT meeting_id,'Client route fixture meeting '||n,'Room','','',
 (SELECT user_id FROM client_route_users WHERE client_route_users.n=CASE WHEN o.n=0 THEN 0 ELSE 2 END),
 '2026-10-28','09:00','10:00' FROM client_route_objects o;
-- A different owner's delegation must stay outside the first owner's list.
INSERT INTO public.meeting_inbox(meeting_id,user_id,status,delegated_by_user_id,delegated_at)
SELECT meeting_id,(SELECT user_id FROM client_route_users WHERE n=1),'pending',(SELECT user_id FROM client_route_users WHERE n=2),now()
FROM client_route_objects WHERE n=1;
INSERT INTO public.conference_rooms(id,name,code,host_id,status,media_topology,livekit_room_name)
SELECT room_id,'Client route fixture room '||n,'client-route-'||room_id::text,
 (SELECT user_id FROM client_route_users WHERE n=0),'active',CASE WHEN n=0 THEN 'mesh' ELSE 'sfu' END,
 CASE WHEN n=1 THEN 'client-route-'||room_id::text ELSE NULL END FROM client_route_objects;
INSERT INTO public.conference_participants(room_id,user_id,display_name,role,status)
SELECT o.room_id,u.user_id,'Client route participant '||u.n,CASE WHEN u.n=0 THEN 'host' ELSE 'member' END,'joined'
FROM client_route_objects o CROSS JOIN client_route_users u WHERE u.n<3;
DO $test$ BEGIN
 ASSERT has_function_privilege('authenticated','private.assign_meeting_owner_delegate(uuid,uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','private.get_my_meeting_owner_delegations_v1()','EXECUTE');
 ASSERT NOT has_function_privilege('anon','private.assign_meeting_owner_delegate(uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','private.get_my_meeting_owner_delegations_v1()','EXECUTE');
 ASSERT has_function_privilege('authenticated','private.set_mesh_conference_participant_role(uuid,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('anon','private.set_mesh_conference_participant_role(uuid,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','private.set_conference_participant_role(uuid,uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','private.apply_conference_participant_role(uuid,uuid,text,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','private.set_conference_participant_role(uuid,uuid,text)','EXECUTE');
 ASSERT has_function_privilege('service_role','private.apply_conference_participant_role(uuid,uuid,text,uuid)','EXECUTE');
 ASSERT NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.set_conference_participant_role(uuid,uuid,text)'::regprocedure),'Public wrapper must remain invoker';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; mid uuid:=(SELECT meeting_id FROM client_route_objects WHERE n=0);
 target uuid:=(SELECT user_id FROM client_route_users WHERE n=1);
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Healthy owner fixture is not FULL';
 r:=public.assign_meeting_owner_delegate(mid,target);
 ASSERT (r->>'success') IS NOT DISTINCT FROM 'true','Browser owner delegation failed: '||r::text;
 ASSERT (SELECT count(*) FROM public.get_my_meeting_owner_delegations_v1())=1,'Owner list did not isolate owned meeting';
 ASSERT EXISTS(SELECT FROM public.get_my_meeting_owner_delegations_v1() WHERE meeting_id=mid AND delegate_user_id=target AND status='pending'),'Browser owner list lost actual request';
 r:=public.assign_meeting_owner_delegate(mid,(SELECT user_id FROM client_route_users WHERE n=3));
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'DELEGATE_DIFFERENT_ORG','Delegate organization rule lost';
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),target,'moderator');
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true' AND r->>'role'='MODERATOR','Browser Mesh role update failed: '||r::text;
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=1),target,'moderator');
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'false' AND r->>'reason'='use_sfu_host_control','Browser SFU boundary lost: '||r::text;
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),auth.uid(),'moderator');
 ASSERT (r->>'reason') IS NOT DISTINCT FROM 'cannot_change_owner_role','Owner protection lost';
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),target,'OWNER');
 ASSERT (r->>'reason') IS NOT DISTINCT FROM 'invalid_role','Owner role became assignable';
 BEGIN PERFORM private.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),target,'member');
 RAISE EXCEPTION 'Browser called low-level service implementation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.apply_livekit_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=1),target,'moderator',auth.uid());
 RAISE EXCEPTION 'Browser called SFU service implementation';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT FROM public.meeting_inbox WHERE meeting_id=(SELECT meeting_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1) AND delegated_by_user_id=(SELECT user_id FROM client_route_users WHERE n=0)),'Delegation not persisted';
 ASSERT EXISTS(SELECT FROM public.notifications WHERE entity_id=(SELECT meeting_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1) AND template_event_type='meeting_invitation_delegate_assigned'),'Delegation notification missing';
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Mesh role not persisted';
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=1)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='member','Browser SFU request mutated role';
 ASSERT EXISTS(SELECT FROM public.conference_audit_events WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND actor_user_id=(SELECT user_id FROM client_route_users WHERE n=0) AND target_user_id=(SELECT user_id FROM client_route_users WHERE n=1)
 AND event_type='participant_permission_changed'),'Mesh role audit missing';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=2),'admin');
 ASSERT (r->>'reason') IS NOT DISTINCT FROM 'forbidden_role_escalation','Moderator rank boundary lost: '||r::text;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=2;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.assign_meeting_owner_delegate((SELECT meeting_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=1));
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'NOT_MEETING_OWNER','Non-owner delegation accepted';
 ASSERT NOT EXISTS(SELECT FROM public.get_my_meeting_owner_delegations_v1() WHERE meeting_id=(SELECT meeting_id FROM client_route_objects WHERE n=0)),'Other owner delegation exposed';
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=1),'member');
 ASSERT (r->>'reason') IS NOT DISTINCT FROM 'forbidden','Ordinary room member changed roles';
END $test$;
RESET ROLE;
CREATE TEMP TABLE client_route_baseline AS
SELECT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects)) notifications,
 (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects)) audits;
CREATE FUNCTION pg_temp.assert_client_routes_blocked() RETURNS void LANGUAGE plpgsql AS $test$
DECLARE r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Expected blocked owner: '||current_setting('client_route.test_case');
 BEGIN PERFORM public.assign_meeting_owner_delegate((SELECT meeting_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=1));
 RAISE EXCEPTION 'Blocked owner delegation accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='AUTH_ACCESS_RESTRICTED'; END;
 ASSERT NOT EXISTS(SELECT FROM public.get_my_meeting_owner_delegations_v1()),'Blocked owner list exposed data';
 r:=public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=1),'member');
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'false' AND r->>'reason'='auth_access_restricted','Blocked Mesh update accepted: '||r::text;
END $test$;

-- revoked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=now() WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','revoked',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;

-- locked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.profiles SET locked_until=now()+interval '1 hour' WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','locked',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;

-- suspended
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.profiles SET account_status='SUSPENDED' WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','suspended',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;

-- idle expired
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET idle_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','idle expired',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;

-- absolute expired
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET absolute_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','absolute expired',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;

-- epoch mismatch
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET auth_epoch=auth_epoch+1 WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','epoch mismatch',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;

-- MFA restricted
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
UPDATE public.profiles SET mfa_enrollment_required=true WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
SELECT set_config('client_route.test_case','MFA restricted',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM client_route_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_client_routes_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=0)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','Blocked request changed Mesh role';
 ASSERT (SELECT count(*) FROM public.notifications WHERE entity_id IN(SELECT meeting_id FROM client_route_objects))=(SELECT notifications FROM client_route_baseline),'Blocked request created notification';
 ASSERT (SELECT count(*) FROM public.conference_audit_events WHERE room_id IN(SELECT room_id FROM client_route_objects))=(SELECT audits FROM client_route_baseline),'Blocked request created role audit';
END $test$;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',absolute_expiry_at=now()+interval '2 hours',
 auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM client_route_users WHERE n=0)) WHERE session_id=(SELECT session_id FROM client_route_users WHERE n=0);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.apply_livekit_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=1),
 (SELECT user_id FROM client_route_users WHERE n=1),'moderator',(SELECT user_id FROM client_route_users WHERE n=0));
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true','Existing SFU service DB route broke: '||r::text;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT role FROM public.conference_participants WHERE room_id=(SELECT room_id FROM client_route_objects WHERE n=1)
 AND user_id=(SELECT user_id FROM client_route_users WHERE n=1))='moderator','SFU service role not persisted';
END $test$;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $test$ BEGIN
 BEGIN PERFORM public.assign_meeting_owner_delegate((SELECT meeting_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=1));
 RAISE EXCEPTION 'Anonymous owner delegation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.get_my_meeting_owner_delegations_v1();
 RAISE EXCEPTION 'Anonymous owner list accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.set_conference_participant_role((SELECT room_id FROM client_route_objects WHERE n=0),(SELECT user_id FROM client_route_users WHERE n=1),'member');
 RAISE EXCEPTION 'Anonymous Mesh route accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'owner-delegation browser routes, Mesh RBAC boundary and SFU service DB path passed' result;
ROLLBACK;
