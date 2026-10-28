-- Execute as the migration owner on a migrated non-production database.
-- All fixture data, settings, grants and temporary helpers roll back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE rpc_security_users AS
SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,3)n;
GRANT SELECT ON rpc_security_users TO anon,authenticated,service_role;
INSERT INTO auth.users(id,email,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,CASE WHEN n=3 THEN user_id::text||'@example.invalid' ELSE NULL END,now(),now(),'{}','{}' FROM rpc_security_users;
INSERT INTO public.profiles(user_id,full_name,is_admin,is_security_admin,account_status,is_active,profile_completion_status,registration_source,locked_until)
SELECT user_id,'Admin RPC regression '||n,n=0,n=0,'ACTIVE',true,'COMPLETE','imported',
 CASE WHEN n=2 THEN now()+interval '1 hour' ELSE NULL END FROM rpc_security_users WHERE n<3;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM rpc_security_users WHERE n<3;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM rpc_security_users u JOIN public.profiles p USING(user_id);
UPDATE public.auth_security_settings SET session_management_enabled=true,mfa_policy='disabled' WHERE id=1;
UPDATE public.system_config SET value='true' WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode');
CREATE TEMP TABLE rpc_security_meetings AS SELECT gen_random_uuid() meeting_id;
GRANT SELECT ON rpc_security_meetings TO authenticated;
INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,request_date,notify_users)
SELECT m.meeting_id,'Admin RPC informee fixture','Room','','',u.user_id,'2026-10-28',
 ARRAY[(SELECT user_id FROM rpc_security_users WHERE n=0)]
FROM rpc_security_meetings m CROSS JOIN rpc_security_users u WHERE n=1;
CREATE TEMP TABLE rpc_security_config AS
SELECT settings_version,session_heartbeat_interval_seconds FROM public.auth_security_settings WHERE id=1;
GRANT SELECT ON rpc_security_config TO authenticated;
INSERT INTO public.session_security_grants(user_id,session_id,grant_type,purpose,factor_type,assurance_level,expires_at)
SELECT u.user_id,u.session_id,'mfa_stepup',purpose,'totp','aal2',now()+interval '4 minutes'
FROM rpc_security_users u CROSS JOIN (VALUES('account_security_change'),('auth_settings_change'))p(purpose) WHERE n=0;

-- Real role ACL denials and the existing server enqueue path.
DO $test$ BEGIN
 ASSERT NOT has_function_privilege('anon','public.create_avatar_job(uuid,text)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.create_avatar_job(uuid,text)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.create_avatar_job(uuid,text)','EXECUTE');
END $test$;
SET LOCAL ROLE anon;
DO $test$ BEGIN
 BEGIN PERFORM public.create_avatar_job((SELECT user_id FROM rpc_security_users WHERE n=1),
 (SELECT user_id::text||'/rpc-regression.png' FROM rpc_security_users WHERE n=1));
 RAISE EXCEPTION 'Anonymous enqueue accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 BEGIN PERFORM public.create_avatar_job((SELECT user_id FROM rpc_security_users WHERE n=1),
 (SELECT user_id::text||'/rpc-regression.png' FROM rpc_security_users WHERE n=1));
 RAISE EXCEPTION 'Browser enqueue accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $test$
DECLARE r record;
BEGIN
 SELECT * INTO r FROM public.create_avatar_job((SELECT user_id FROM rpc_security_users WHERE n=1),
 (SELECT user_id::text||'/rpc-regression.png' FROM rpc_security_users WHERE n=1));
 ASSERT r.id IS NOT NULL AND r.status='pending','Server enqueue path failed';
END $test$;
RESET ROLE;

CREATE FUNCTION pg_temp.assert_admin_rpcs_blocked() RETURNS void LANGUAGE plpgsql AS $test$
DECLARE r jsonb; b boolean; e text;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Fixture must be blocked/restricted: '||current_setting('audit.test_case');
 BEGIN PERFORM public.list_locked_accounts(); RAISE EXCEPTION 'Blocked lock listing accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='SESSION_NOT_FULLY_AUTHORIZED'; END;
 BEGIN PERFORM public.list_malformed_phone_records(); RAISE EXCEPTION 'Blocked orphan listing accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='SESSION_NOT_FULLY_AUTHORIZED'; END;
 r:=public.security_admin_unlock_account((SELECT user_id FROM rpc_security_users WHERE n=2));
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SESSION_NOT_FULLY_AUTHORIZED','Blocked unlock accepted: '||r::text;
 r:=public.clear_malformed_phone_record((SELECT user_id FROM rpc_security_users WHERE n=3));
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SESSION_NOT_FULLY_AUTHORIZED','Blocked deletion accepted: '||r::text;
 r:=public.set_auth_security_settings_patch((SELECT settings_version FROM rpc_security_config),
 '{"session_heartbeat_interval_seconds":90}','Regression test change');
 ASSERT COALESCE(r->>'error','') IN ('SESSION_NOT_FULLY_AUTHORIZED','SECURITY_ADMIN_REQUIRED'),'Blocked settings patch accepted: '||r::text;
 SELECT success,error INTO b,e FROM public.set_phone_password_recovery_config(false);
 ASSERT b IS FALSE AND e IS NOT DISTINCT FROM 'SESSION_NOT_FULLY_AUTHORIZED','Blocked recovery change accepted';
 SELECT success,error INTO b,e FROM public.set_phone_password_recovery_test_mode(false,NULL);
 ASSERT b IS FALSE AND e IS NOT DISTINCT FROM 'SESSION_NOT_FULLY_AUTHORIZED','Blocked test-mode change accepted';
 ASSERT NOT EXISTS(SELECT FROM public.get_my_informee_meetings_v1() WHERE id=(SELECT meeting_id FROM rpc_security_meetings)),
 'Blocked informee read accepted';
END $test$;

-- revoked session
SELECT set_config('audit.test_case','revoked session',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=now() WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;

-- temporary account lock
SELECT set_config('audit.test_case','temporary account lock',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.profiles SET locked_until=now()+interval '1 hour' WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;

-- suspended account
SELECT set_config('audit.test_case','suspended account',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.profiles SET account_status='SUSPENDED' WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;

-- idle timeout
SELECT set_config('audit.test_case','idle timeout',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET idle_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;

-- absolute timeout
SELECT set_config('audit.test_case','absolute timeout',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET absolute_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;

-- auth epoch mismatch
SELECT set_config('audit.test_case','auth epoch mismatch',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET auth_epoch=auth_epoch+1 WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;

-- MFA enrollment restriction
SELECT set_config('audit.test_case','MFA enrollment restriction',true);
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
UPDATE public.profiles SET mfa_enrollment_required=true WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_admin_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='true')=2,'Denied request changed recovery configuration';
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version FROM rpc_security_config),'Denied request patched settings';
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0) AND consumed_at IS NULL)=2,'Denied request consumed a step-up grant';
 ASSERT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Denied request deleted auth user';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until>now()),'Denied request unlocked target';
END $test$;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',is_active=true,locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM rpc_security_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; b boolean; e text; c record;
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Healthy admin session not FULL';
 ASSERT EXISTS(SELECT FROM public.list_locked_accounts() WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2)),'Valid lock list denied';
 ASSERT EXISTS(SELECT FROM public.list_malformed_phone_records() WHERE auth_user_id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Valid orphan list denied';
 ASSERT EXISTS(SELECT FROM public.get_my_informee_meetings_v1() WHERE id=(SELECT meeting_id FROM rpc_security_meetings)),'Valid informee list denied';
 r:=public.security_admin_unlock_account((SELECT user_id FROM rpc_security_users WHERE n=2));
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true','Valid step-up unlock failed: '||r::text;
 r:=public.clear_malformed_phone_record((SELECT user_id FROM rpc_security_users WHERE n=3));
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true','Valid step-up orphan deletion failed: '||r::text;
 -- Orphan cleanup used the settings grant. A second settings operation needs fresh step-up.
 SELECT * INTO c FROM rpc_security_config;
 r:=public.set_auth_security_settings_patch(c.settings_version,'{"session_heartbeat_interval_seconds":90}','Regression test change');
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'STEPUP_REQUIRED','Settings step-up gate was lost: '||r::text;
 SELECT success,error INTO b,e FROM public.set_phone_password_recovery_config(false);
 ASSERT b IS TRUE AND e IS NULL,'Valid recovery disable failed';
 SELECT success,error INTO b,e FROM public.set_phone_password_recovery_test_mode(false,NULL);
 ASSERT b IS TRUE AND e IS NULL,'Valid test-mode disable failed';
END $test$;
RESET ROLE;
-- Verify actual mutation effects outside browser RLS.
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security' AND key IN ('phone_password_recovery_enabled','phone_password_recovery_test_mode') AND value='false')=2,'Valid disable did not persist';
 ASSERT NOT EXISTS(SELECT FROM auth.users WHERE id=(SELECT user_id FROM rpc_security_users WHERE n=3)),'Orphan deletion did not persist';
 ASSERT EXISTS(SELECT FROM public.profiles WHERE user_id=(SELECT user_id FROM rpc_security_users WHERE n=2) AND locked_until IS NULL),'Unlock did not persist';
END $test$;
INSERT INTO public.session_security_grants(user_id,session_id,grant_type,purpose,factor_type,assurance_level,expires_at)
SELECT user_id,session_id,'mfa_stepup','auth_settings_change','totp','aal2',now()+interval '4 minutes' FROM rpc_security_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; c record;
BEGIN
 SELECT * INTO c FROM rpc_security_config;
 r:=public.set_auth_security_settings_patch(c.settings_version,
 jsonb_build_object('session_heartbeat_interval_seconds',CASE WHEN c.session_heartbeat_interval_seconds=90 THEN 120 ELSE 90 END),
 'Regression test change');
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true','Valid settings patch failed: '||r::text;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT settings_version FROM public.auth_security_settings WHERE id=1)=(SELECT settings_version+1 FROM rpc_security_config),
 'Settings version did not advance';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM rpc_security_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; b boolean; e text;
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Ordinary fixture must be FULL';
 BEGIN PERFORM public.list_locked_accounts(); RAISE EXCEPTION 'Non-admin lock list accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='SECURITY_ADMIN_REQUIRED'; END;
 BEGIN PERFORM public.list_malformed_phone_records(); RAISE EXCEPTION 'Non-admin orphan list accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='SECURITY_ADMIN_REQUIRED'; END;
 r:=public.security_admin_unlock_account((SELECT user_id FROM rpc_security_users WHERE n=2));
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SECURITY_ADMIN_REQUIRED';
 r:=public.clear_malformed_phone_record((SELECT user_id FROM rpc_security_users WHERE n=3));
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SECURITY_ADMIN_REQUIRED';
 r:=public.set_auth_security_settings_patch((SELECT settings_version FROM rpc_security_config),'{}','Regression test change');
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SECURITY_ADMIN_REQUIRED';
 SELECT success,error INTO b,e FROM public.set_phone_password_recovery_config(false);
 ASSERT b IS FALSE AND e IS NOT DISTINCT FROM 'NOT_ADMIN','Ordinary user recovery change accepted';
 SELECT success,error INTO b,e FROM public.set_phone_password_recovery_test_mode(false,NULL);
 ASSERT b IS FALSE AND e IS NOT DISTINCT FROM 'NOT_ADMIN','Ordinary user test-mode change accepted';
 ASSERT NOT EXISTS(SELECT FROM public.get_my_informee_meetings_v1() WHERE id=(SELECT meeting_id FROM rpc_security_meetings)),'Non-informee read accepted';
END $test$;
RESET ROLE;
SELECT 'admin session gates, avatar server ACL and informee access passed' result;
ROLLBACK;
