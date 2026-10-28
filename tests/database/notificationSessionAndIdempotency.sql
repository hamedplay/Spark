-- Test actual public RPCs and owner-executed delegation callers.
-- Run as migration owner on a migrated test DB. All data and settings roll back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE notification_security_users AS
SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,3)n;
GRANT SELECT ON notification_security_users TO anon,authenticated;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}','{}' FROM notification_security_users;
INSERT INTO public.profiles(user_id,full_name,organization,account_status,is_active,profile_completion_status,registration_source)
SELECT user_id,'Notification security fixture '||n,CASE WHEN n=3 THEN 'Notification security B' ELSE 'Notification security A' END,
'ACTIVE',true,'COMPLETE','imported' FROM notification_security_users;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM notification_security_users;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM notification_security_users u JOIN public.profiles p USING(user_id);
UPDATE public.auth_security_settings SET session_management_enabled=true,mfa_policy='disabled' WHERE id=1;
CREATE TEMP TABLE notification_security_keys AS
SELECT kind,'notification-security:'||gen_random_uuid()::text event_key,gen_random_uuid() notification_id
FROM (VALUES('legitimate'),('foreign_org'),('other_sender'),('system_sender'),('blocked'))k(kind);
GRANT SELECT ON notification_security_keys TO anon,authenticated;
INSERT INTO public.notifications(id,user_id,sender_id,title,message,type,event_key)
SELECT k.notification_id,u.user_id,
 CASE WHEN k.kind='system_sender' THEN NULL ELSE (SELECT user_id FROM notification_security_users WHERE n=2) END,
 'Protected fixture '||k.kind,'Protected body','system',k.event_key
FROM notification_security_keys k JOIN notification_security_users u ON u.n=CASE WHEN k.kind='foreign_org' THEN 3 ELSE 1 END
WHERE k.kind IN('foreign_org','other_sender','system_sender');
CREATE TEMP TABLE notification_security_originals AS
SELECT id,to_jsonb(n) original FROM public.notifications n
WHERE id IN(SELECT notification_id FROM notification_security_keys WHERE kind IN('foreign_org','other_sender','system_sender'));
CREATE TEMP TABLE notification_security_responses(name text,result jsonb);
GRANT SELECT,INSERT ON notification_security_responses TO authenticated;
CREATE FUNCTION pg_temp.expect_notification_collision(target uuid,key text) RETURNS void LANGUAGE plpgsql AS $test$
BEGIN
 BEGIN
 PERFORM public.create_notification(p_user_id=>target,p_title=>'Collision must fail',p_message=>'Fixture',p_type=>'system',p_event_key=>key);
 RAISE EXCEPTION 'Mismatched event key was accepted';
 EXCEPTION WHEN unique_violation THEN ASSERT SQLERRM='NOTIFICATION_EVENT_KEY_CONFLICT'; END;
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE a jsonb; b jsonb; target uuid:=(SELECT user_id FROM notification_security_users WHERE n=1);
 key text:=(SELECT event_key FROM notification_security_keys WHERE kind='legitimate');
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Healthy sender is not FULL';
 a:=public.create_notification(p_user_id=>target,p_title=>'Original valid fixture',p_message=>'Original valid body',p_type=>'system',p_event_key=>key)::jsonb;
 ASSERT (a->>'created') IS NOT DISTINCT FROM 'true' AND a->>'notification_id' IS NOT NULL,'Valid notification failed';
 b:=public.create_notification(p_user_id=>target,p_title=>'Retry must not overwrite',p_message=>'Retry body',p_type=>'system',p_event_key=>key)::jsonb;
 ASSERT (b->>'created') IS NOT DISTINCT FROM 'false','Same actor/recipient retry must deduplicate';
 ASSERT (b->>'notification_id') IS NOT DISTINCT FROM (a->>'notification_id'),'Retry returned a different ID';
 INSERT INTO notification_security_responses VALUES('legitimate',a),('retry',b);
 PERFORM pg_temp.expect_notification_collision(target,(SELECT event_key FROM notification_security_keys WHERE kind='foreign_org'));
 PERFORM pg_temp.expect_notification_collision(target,(SELECT event_key FROM notification_security_keys WHERE kind='other_sender'));
 PERFORM pg_temp.expect_notification_collision(target,(SELECT event_key FROM notification_security_keys WHERE kind='system_sender'));
 PERFORM pg_temp.expect_notification_collision((SELECT user_id FROM notification_security_users WHERE n=2),key);
 a:=public.create_notification(p_user_id=>target,p_title=>'Keyless fixture',p_message=>'Fixture',p_type=>'system')::jsonb;
 b:=public.create_notification(p_user_id=>target,p_title=>'Keyless fixture',p_message=>'Fixture',p_type=>'system')::jsonb;
 ASSERT (a->>'created') IS NOT DISTINCT FROM 'true' AND (b->>'created') IS NOT DISTINCT FROM 'true','NULL keys should insert normally';
 ASSERT (a->>'notification_id') IS DISTINCT FROM (b->>'notification_id'),'NULL keys unexpectedly deduplicated';
 BEGIN
 PERFORM public.create_notification(p_user_id=>(SELECT user_id FROM notification_security_users WHERE n=3),p_title=>'Wrong org',p_message=>'Fixture',p_type=>'system');
 RAISE EXCEPTION 'Recipient organization boundary lost';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'recipient_outside_organization' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.notifications WHERE event_key=(SELECT event_key FROM notification_security_keys WHERE kind='legitimate'))=1,'Retry created extra rows';
 ASSERT EXISTS(SELECT FROM public.notifications WHERE event_key=(SELECT event_key FROM notification_security_keys WHERE kind='legitimate')
 AND title='Original valid fixture' AND message='Original valid body'),'Retry overwrote original payload';
 ASSERT NOT EXISTS(SELECT FROM notification_security_originals o JOIN public.notifications n USING(id) WHERE to_jsonb(n) IS DISTINCT FROM o.original),'Conflicting request touched protected row';
 ASSERT (SELECT count(*) FROM public.notifications WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=1) AND title='Keyless fixture')=2,'Keyless inserts missing';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=2;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_notification_collision((SELECT user_id FROM notification_security_users WHERE n=1),
 (SELECT event_key FROM notification_security_keys WHERE kind='legitimate'));
RESET ROLE;

CREATE FUNCTION pg_temp.assert_blocked_notification_sender() RETURNS void LANGUAGE plpgsql AS $test$
DECLARE key text;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Expected blocked sender: '||current_setting('notification.test_case');
 -- Deny new writes, otherwise-valid retries and ownership conflicts before lookup.
 FOR key IN SELECT event_key FROM notification_security_keys WHERE kind IN('blocked','legitimate','foreign_org') LOOP
 BEGIN
 PERFORM public.create_notification(p_user_id=>(SELECT user_id FROM notification_security_users WHERE n=1),
 p_title=>'Blocked notification fixture',p_message=>'Fixture',p_type=>'system',p_event_key=>key);
 RAISE EXCEPTION 'Blocked notification write/retry accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='AUTH_ACCESS_RESTRICTED'; END;
 END LOOP;
END $test$;

-- revoked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=now() WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','revoked',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;

-- locked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.profiles SET locked_until=now()+interval '1 hour' WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','locked',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;

-- suspended
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.profiles SET account_status='SUSPENDED' WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','suspended',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;

-- idle expired
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET idle_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','idle expired',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;

-- absolute expired
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET absolute_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','absolute expired',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;

-- epoch mismatch
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET auth_epoch=auth_epoch+1 WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','epoch mismatch',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;

-- MFA restricted
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
UPDATE public.profiles SET mfa_enrollment_required=true WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
SELECT set_config('notification.test_case','MFA restricted',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_blocked_notification_sender();
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM notification_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=0;
CREATE TEMP TABLE notification_security_meetings AS SELECT n,gen_random_uuid() meeting_id FROM generate_series(0,1)n;
GRANT SELECT ON notification_security_meetings TO authenticated;
INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,request_date,start_time,end_time,participant_user_ids)
SELECT meeting_id,'Notification delegation fixture '||n,'Room','','',(SELECT user_id FROM notification_security_users WHERE n=0),
'2026-10-28','09:00','10:00',CASE WHEN n=1 THEN ARRAY[(SELECT user_id FROM notification_security_users WHERE n=1)] ELSE '{}'::uuid[] END
FROM notification_security_meetings;
INSERT INTO public.meeting_inbox(meeting_id,user_id,status)
SELECT meeting_id,(SELECT user_id FROM notification_security_users WHERE n=1),'pending' FROM notification_security_meetings WHERE n=1
ON CONFLICT(meeting_id,user_id) DO UPDATE SET status='pending';
-- Exercise this existing definer chain as owner with a FULL fixture JWT.
-- Its public invoker wrapper currently lacks the required private EXECUTE grant;
-- that independent pre-existing browser ACL issue is outside this migration.
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.assign_meeting_owner_delegate((SELECT meeting_id FROM notification_security_meetings WHERE n=0),
 (SELECT user_id FROM notification_security_users WHERE n=2));
 ASSERT (r->>'success') IS NOT DISTINCT FROM 'true','Owner delegation caller broke: '||r::text;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM notification_security_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; item record;
BEGIN
 SELECT id,updated_at INTO item FROM public.meeting_inbox
 WHERE meeting_id=(SELECT meeting_id FROM notification_security_meetings WHERE n=1) AND user_id=auth.uid();
 r:=public.assign_meeting_invitation_delegate(item.id,(SELECT user_id FROM notification_security_users WHERE n=2),item.updated_at);
 ASSERT (r->>'success') IS NOT DISTINCT FROM 'true','Invitation delegation caller broke: '||r::text;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.notifications WHERE user_id=(SELECT user_id FROM notification_security_users WHERE n=2)
 AND entity_id IN(SELECT meeting_id FROM notification_security_meetings)
 AND template_category='meeting' AND template_event_type='meeting_invitation_delegate_assigned'
 AND template_id IS NOT NULL)=2,'Delegation template notifications did not persist';
 ASSERT NOT EXISTS(SELECT FROM public.notifications WHERE title='Blocked notification fixture'),'Blocked write persisted';
 ASSERT NOT EXISTS(SELECT FROM notification_security_originals o JOIN public.notifications n USING(id) WHERE to_jsonb(n) IS DISTINCT FROM o.original),'Protected notification was changed';
END $test$;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $test$ BEGIN
 BEGIN PERFORM public.create_notification(p_user_id=>(SELECT user_id FROM notification_security_users WHERE n=1),
 p_title=>'Anonymous fixture',p_message=>'Fixture',p_type=>'system');
 RAISE EXCEPTION 'Anonymous notification accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'notification session gates, scoped retries, conflict rejection and delegation callers passed' result;
ROLLBACK;
