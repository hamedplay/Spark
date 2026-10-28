-- Real public RPCs/roles, including persisted effects; all changes roll back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE boundary_users AS
SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,6)n;
GRANT SELECT ON boundary_users TO anon,authenticated;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}','{}' FROM boundary_users;
INSERT INTO public.profiles(user_id,full_name,is_admin,is_security_admin,organization,account_status,is_active,is_hidden,profile_completion_status,registration_source)
SELECT user_id,'Role phone share fixture '||n,n=0,n IN(0,2),
 CASE WHEN n=3 THEN 'Boundary org B' WHEN n=6 THEN NULL ELSE 'Boundary org A' END,
 CASE WHEN n=4 THEN 'SUSPENDED' ELSE 'ACTIVE' END,n<>4,n=5,'COMPLETE','imported'
FROM boundary_users;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM boundary_users;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM boundary_users u JOIN public.profiles p USING(user_id);
UPDATE public.auth_security_settings SET session_management_enabled=true,mfa_policy='disabled' WHERE id=1;
CREATE TEMP TABLE boundary_target AS
SELECT security_role_version::integer version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2);
GRANT SELECT ON boundary_target TO authenticated;
INSERT INTO public.system_config(section,key,value,value_type)
VALUES('security','phone_login_canonical_enabled','true','boolean'),
 ('security','phone_password_recovery_canonical_enabled','true','boolean')
ON CONFLICT(section,key) DO UPDATE SET value=EXCLUDED.value;
INSERT INTO public.session_security_grants(user_id,session_id,grant_type,purpose,factor_type,assurance_level,expires_at)
SELECT user_id,session_id,'mfa_stepup','account_security_change','totp','aal2',now()+interval '4 minutes'
FROM boundary_users WHERE n=0;

CREATE FUNCTION pg_temp.assert_boundary_rpcs_blocked() RETURNS void LANGUAGE plpgsql AS $test$
DECLARE r jsonb; target uuid:=(SELECT user_id FROM boundary_users WHERE n=2);
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Expected blocked session: '||current_setting('boundary.test_case');
 r:=public.set_user_security_admin(target,false,(SELECT version FROM boundary_target),'Boundary regression reason');
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'AUTH_ACCESS_RESTRICTED','Blocked role mutation accepted: '||r::text;
 r:=public.set_phone_auth_canonical_flags(false,false);
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'AUTH_ACCESS_RESTRICTED','Blocked phone flags accepted: '||r::text;
 BEGIN PERFORM public.share_note_to_user('Boundary denied note','Fixture','text',target,auth.uid());
 RAISE EXCEPTION 'Blocked note share accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='AUTH_ACCESS_RESTRICTED'; END;
 BEGIN PERFORM public.share_contact_to_user('Boundary denied contact','','','',target);
 RAISE EXCEPTION 'Blocked contact share accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='AUTH_ACCESS_RESTRICTED'; END;
END $test$;

-- revoked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=now() WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','revoked',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;

-- locked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.profiles SET locked_until=now()+interval '1 hour' WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','locked',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;

-- suspended
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.profiles SET account_status='SUSPENDED' WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','suspended',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;

-- idle expired
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET idle_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','idle expired',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;

-- absolute expired
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET absolute_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','absolute expired',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;

-- epoch mismatch
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET auth_epoch=auth_epoch+1 WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','epoch mismatch',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;

-- MFA restricted
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
UPDATE public.profiles SET mfa_enrollment_required=true WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
SELECT set_config('boundary.test_case','MFA restricted',true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_boundary_rpcs_blocked();
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.session_security_grants WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0) AND consumed_at IS NULL)=1,'Blocked request consumed step-up';
 ASSERT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Blocked request changed role';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version FROM boundary_target),'Blocked request changed role version';
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='true')=2,'Blocked request changed flags';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted note';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE user_id IN(SELECT user_id FROM boundary_users)),'Blocked request inserted contact';
END $test$;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET account_status='ACTIVE',locked_until=NULL,mfa_enrollment_required=false WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0);
UPDATE public.session_security_state SET revoked_at=NULL,idle_expiry_at=now()+interval '1 hour',
 absolute_expiry_at=now()+interval '2 hours',auth_epoch=(SELECT auth_epoch FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=0))
WHERE session_id=(SELECT session_id FROM boundary_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; target uuid:=(SELECT user_id FROM boundary_users WHERE n=2);
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Healthy admin not FULL';
 r:=public.set_phone_auth_canonical_flags(false,false);
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'STEPUP_REQUIRED','Phone flags no longer require the correct step-up: '||r::text;
 r:=public.set_user_security_admin(target,false,(SELECT version FROM boundary_target),'Boundary regression reason');
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true','Valid legacy role change failed: '||r::text;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT NOT (SELECT is_security_admin FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2)),'Valid role change did not persist';
 ASSERT (SELECT security_role_version FROM public.profiles WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2))=(SELECT version+1 FROM boundary_target),'Valid role version did not advance';
 ASSERT EXISTS(SELECT FROM public.security_admin_role_history WHERE actor_user_id=(SELECT user_id FROM boundary_users WHERE n=0)
 AND target_user_id=(SELECT user_id FROM boundary_users WHERE n=2) AND new_value=false),'Valid role history missing';
END $test$;
INSERT INTO public.session_security_grants(user_id,session_id,grant_type,purpose,factor_type,assurance_level,expires_at)
SELECT user_id,session_id,'mfa_stepup','auth_settings_change','totp','aal2',now()+interval '4 minutes'
FROM boundary_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb;
BEGIN
 r:=public.set_phone_auth_canonical_flags(false,false);
 ASSERT (r->>'ok') IS NOT DISTINCT FROM 'true','Canonical flags still fail with a valid settings step-up: '||r::text;
 r:=public.set_phone_auth_canonical_flags(true,NULL);
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'STEPUP_REQUIRED','Consumed step-up reused';
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.system_config WHERE section='security'
 AND key IN('phone_login_canonical_enabled','phone_password_recovery_canonical_enabled') AND value='false')=2,'Valid flags did not persist';
 ASSERT EXISTS(SELECT FROM public.security_audit_events WHERE actor_user_id=(SELECT user_id FROM boundary_users WHERE n=0)
 AND event_type='phone_auth_canonical_flags_changed'),'Flags audit missing';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE r jsonb; target uuid; recipient_case integer;
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Healthy sender not FULL';
 r:=public.set_phone_auth_canonical_flags(false,NULL);
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SECURITY_ADMIN_REQUIRED','Ordinary sender changed auth flags';
 r:=public.set_user_security_admin((SELECT user_id FROM boundary_users WHERE n=2),true,
 (SELECT version+1 FROM boundary_target),'Boundary regression reason');
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'SECURITY_ADMIN_REQUIRED','Ordinary sender changed security role';
 target:=(SELECT user_id FROM boundary_users WHERE n=2);
 PERFORM public.share_note_to_user('Boundary allowed note','Valid content','text',target,auth.uid());
 PERFORM public.share_contact_to_user('Boundary allowed contact','fixture@example.invalid','123','Fixture company',target);
 -- Different organization, suspended recipient, hidden recipient and missing recipient.
 FOR recipient_case IN 3..5 LOOP
 target:=(SELECT user_id FROM boundary_users WHERE boundary_users.n=recipient_case);
 BEGIN PERFORM public.share_note_to_user('Boundary forbidden note','Fixture','text',target,auth.uid());
 RAISE EXCEPTION 'Ineligible note recipient accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='RECIPIENT_NOT_ALLOWED'; END;
 BEGIN PERFORM public.share_contact_to_user('Boundary forbidden contact','','','',target);
 RAISE EXCEPTION 'Ineligible contact recipient accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='RECIPIENT_NOT_ALLOWED'; END;
 END LOOP;
 target:=gen_random_uuid();
 BEGIN PERFORM public.share_note_to_user('Boundary forbidden note','Fixture','text',target,auth.uid());
 RAISE EXCEPTION 'Missing note recipient accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='RECIPIENT_NOT_ALLOWED'; END;
 BEGIN PERFORM public.share_contact_to_user('Boundary forbidden contact','','','',target);
 RAISE EXCEPTION 'Missing contact recipient accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='RECIPIENT_NOT_ALLOWED'; END;
 BEGIN PERFORM public.share_contact_to_user('Boundary self contact','','','',auth.uid());
 RAISE EXCEPTION 'Self contact rule lost';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'Cannot share contact to yourself' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT (SELECT count(*) FROM public.notes WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2) AND title='Boundary allowed note')=1,'Allowed note did not persist';
 ASSERT (SELECT count(*) FROM public.contacts_email WHERE user_id=(SELECT user_id FROM boundary_users WHERE n=2) AND name='Boundary allowed contact')=1,'Allowed contact did not persist';
 ASSERT NOT EXISTS(SELECT FROM public.notes WHERE title='Boundary forbidden note'),'Denied note persisted';
 ASSERT NOT EXISTS(SELECT FROM public.contacts_email WHERE name='Boundary forbidden contact'),'Denied contact persisted';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM boundary_users WHERE n=6;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 BEGIN PERFORM public.share_note_to_user('Boundary no-org note','Fixture','text',(SELECT user_id FROM boundary_users WHERE n=2),auth.uid());
 RAISE EXCEPTION 'Sender without organization accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='RECIPIENT_NOT_ALLOWED'; END;
 BEGIN PERFORM public.share_contact_to_user('Boundary no-org contact','','','',(SELECT user_id FROM boundary_users WHERE n=2));
 RAISE EXCEPTION 'Sender without organization accepted';
 EXCEPTION WHEN insufficient_privilege THEN ASSERT SQLERRM='RECIPIENT_NOT_ALLOWED'; END;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SET LOCAL ROLE anon;
DO $test$
DECLARE r jsonb;
BEGIN
 BEGIN
 r:=public.set_phone_auth_canonical_flags(false,NULL);
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'UNAUTHORIZED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 r:=public.set_user_security_admin((SELECT user_id FROM boundary_users WHERE n=2),true,1,'Boundary regression reason');
 ASSERT (r->>'error') IS NOT DISTINCT FROM 'UNAUTHORIZED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.share_note_to_user('Boundary anonymous note','Fixture','text',(SELECT user_id FROM boundary_users WHERE n=2),NULL);
 RAISE EXCEPTION 'Anonymous note accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.share_contact_to_user('Boundary anonymous contact','','','',(SELECT user_id FROM boundary_users WHERE n=2));
 RAISE EXCEPTION 'Anonymous contact accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'legacy role, canonical phone flags and organization sharing boundaries passed' result;
ROLLBACK;
