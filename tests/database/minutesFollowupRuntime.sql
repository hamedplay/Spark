-- Run as the migration owner against a disposable/migrated test database.
-- Real role/RPC/RLS assertions; every fixture and setting change rolls back.
BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE authorization_test_users AS
SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,1)n;
GRANT SELECT ON authorization_test_users TO authenticated;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}','{}' FROM authorization_test_users;
INSERT INTO public.profiles(user_id,full_name,account_status,is_active,profile_completion_status,registration_source)
SELECT user_id,'Authorization regression '||n,'ACTIVE',true,'COMPLETE','imported' FROM authorization_test_users;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM authorization_test_users;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id);
UPDATE public.auth_security_settings SET session_management_enabled=true,mfa_policy='disabled' WHERE id=1;
CREATE TEMP TABLE authorization_test_objects AS
SELECT gen_random_uuid() meeting_id,NULL::uuid minute_id,gen_random_uuid() decision_id,
 jsonb_build_object('meeting_title_snapshot','Authorization regression','meeting_date_snapshot','2026-10-28',
 'secretary_name_snapshot','Secretary','chair_name_snapshot','Chair','confidentiality','organizational',
 'internal_participants','[]'::jsonb,'external_participants','[]'::jsonb,'agenda_results','[]'::jsonb) payload;
GRANT SELECT,UPDATE ON authorization_test_objects TO authenticated;
INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,calendar_id,request_date,start_time,end_time,status_type)
SELECT o.meeting_id,'Authorization fixture','Room','','',u.user_id,
 (SELECT id FROM public.calendars WHERE user_id=u.user_id AND type='private' LIMIT 1),'2026-10-28','09:00','10:00','scheduled'
FROM authorization_test_objects o CROSS JOIN authorization_test_users u WHERE n=0;
UPDATE authorization_test_objects SET payload=payload||jsonb_build_object('meeting_id',meeting_id);
CREATE TEMP TABLE authorization_test_chats AS
SELECT n,gen_random_uuid() conversation_id,gen_random_uuid() message_id FROM generate_series(0,2)n;
GRANT SELECT ON authorization_test_chats TO authenticated,anon;
INSERT INTO public.chat_conversations(id,participant_a,participant_b,created_by,type)
SELECT c.conversation_id,u.user_id,u.user_id,u.user_id,CASE WHEN c.n=2 THEN 'group' ELSE 'direct' END
FROM authorization_test_chats c JOIN authorization_test_users u ON u.n=CASE WHEN c.n=1 THEN 1 ELSE 0 END;
INSERT INTO public.chat_group_members(conversation_id,user_id)
SELECT c.conversation_id,u.user_id FROM authorization_test_chats c CROSS JOIN authorization_test_users u WHERE c.n=2 AND u.n=1;
INSERT INTO public.chat_messages(id,conversation_id,sender_id,body)
SELECT c.message_id,c.conversation_id,u.user_id,'Authorization fixture'
FROM authorization_test_chats c JOIN authorization_test_users u ON u.n=CASE WHEN c.n=1 THEN 1 ELSE 0 END;

DO $test$ BEGIN
 ASSERT NOT has_function_privilege('anon','public._sync_minutes_decisions(uuid,jsonb,uuid[])','EXECUTE');
 ASSERT NOT has_function_privilege('anon','public.chat_message_conv_id(uuid)','EXECUTE');
 ASSERT has_function_privilege('authenticated','public._sync_minutes_decisions(uuid,jsonb,uuid[])','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public._sync_minutes_decisions_legacy_periodic_v1(uuid,jsonb,uuid[])','EXECUTE');
END $test$;
SET LOCAL ROLE anon;
DO $test$ BEGIN
 BEGIN PERFORM public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0));
 RAISE EXCEPTION 'Anonymous conversation lookup accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public._sync_minutes_decisions(gen_random_uuid(),'[]','{}');
 RAISE EXCEPTION 'Anonymous mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb; version timestamptz; decisions jsonb;
BEGIN
 ASSERT private.is_current_session_fully_authorized(),'Healthy session must be FULL';
 SELECT * INTO o FROM authorization_test_objects;
 decisions:=jsonb_build_array(jsonb_build_object('id',o.decision_id,'title','Real decision','responsible_party_type','external',
 'external_responsible_name_snapshot','External owner','requires_followup',false,'followup_recurrence','none'));
 r:=public.create_minutes_draft(o.payload,decisions);
 ASSERT (r->>'success') IS NOT DISTINCT FROM 'true','Create failed: '||r::text;
 UPDATE authorization_test_objects SET minute_id=(r->>'minute_id')::uuid;
 SELECT * INTO o FROM authorization_test_objects;
 SELECT updated_at INTO version FROM public.minutes WHERE id=o.minute_id;
 r:=public.update_minutes_draft(o.minute_id,version,o.payload,decisions,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'success') IS NOT DISTINCT FROM 'true','Six-argument update failed: '||r::text;
 SELECT updated_at INTO version FROM public.minutes WHERE id=o.minute_id;
 r:=public.update_minutes_draft(o.minute_id,version,o.payload,decisions);
 ASSERT (r->>'success') IS NOT DISTINCT FROM 'true','Four-argument invoker update failed: '||r::text;
 PERFORM public._sync_minutes_decisions(o.minute_id,
 jsonb_build_array((decisions->0)||'{"followup_recurrence":"weekly","followup_recipient_type":"secretary"}'::jsonb),'{}');
 BEGIN
 PERFORM public._sync_minutes_decisions(o.minute_id,
 jsonb_build_array((decisions->0)||'{"followup_recurrence":"invalid"}'::jsonb),'{}');
 RAISE EXCEPTION 'Invalid recurrence accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'INVALID_FOLLOWUP_RECURRENCE' THEN RAISE; END IF; END;
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NOT DISTINCT FROM
 (SELECT conversation_id FROM authorization_test_chats WHERE n=0),'Direct participant lookup failed';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=2)) IS NOT DISTINCT FROM
 (SELECT conversation_id FROM authorization_test_chats WHERE n=2),'Group creator lookup failed';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=1)) IS NULL,'Outsider conversation ID disclosed';
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT FROM public.minutes_decisions WHERE id=(SELECT decision_id FROM authorization_test_objects)
 AND primary_owner_user_id IS NULL AND external_responsible_name_snapshot='External owner' AND followup_recurrence='weekly'),'External decision must actually persist';
END $test$;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=2)) IS NOT DISTINCT FROM
 (SELECT conversation_id FROM authorization_test_chats WHERE n=2),'Group member lookup failed';
 BEGIN PERFORM public._sync_minutes_decisions((SELECT minute_id FROM authorization_test_objects),'[]','{}');
 RAISE EXCEPTION 'Outsider decision mutation accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'MINUTES_NO_PERMISSION' THEN RAISE; END IF; END;
END $test$;
RESET ROLE;

-- temporary lock
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
UPDATE public.profiles SET locked_until=now()+interval '1 hour' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;


-- suspended
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
UPDATE public.profiles SET account_status='SUSPENDED' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;


-- revoked
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
UPDATE public.session_security_state SET revoked_at=now() WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;


-- idle expiry
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
UPDATE public.session_security_state SET idle_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;


-- absolute expiry
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
UPDATE public.session_security_state SET absolute_expiry_at=now()-interval '1 minute' WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;


-- epoch mismatch
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
UPDATE public.session_security_state SET auth_epoch=auth_epoch+1 WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;


-- missing session
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb;
BEGIN
 ASSERT NOT private.is_current_session_fully_authorized(),'Blocked session passed shared gate';
 ASSERT NOT EXISTS(SELECT FROM public.chat_messages WHERE id=(SELECT message_id FROM authorization_test_chats WHERE n=0)),'Blocked session passed message RLS';
 ASSERT public.chat_message_conv_id((SELECT message_id FROM authorization_test_chats WHERE n=0)) IS NULL,'Blocked session disclosed conversation ID';
 SELECT * INTO o FROM authorization_test_objects;
 BEGIN PERFORM public._sync_minutes_decisions(o.minute_id,'[]','{}');
 RAISE EXCEPTION 'Blocked decision mutation accepted'; EXCEPTION WHEN insufficient_privilege THEN
 ASSERT SQLERRM='AUTH_FULL_ACCESS_REQUIRED'; END;
 r:=public.create_minutes_draft(o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked create accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL,'{}'::uuid[],'{}'::uuid[]);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked six-argument update accepted: '||r::text;
 r:=public.update_minutes_draft(o.minute_id,now(),o.payload,NULL);
 ASSERT (r->>'error_code') IS NOT DISTINCT FROM 'AUTH_FULL_ACCESS_REQUIRED','Blocked four-argument update accepted: '||r::text;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.profiles SET locked_until=NULL,account_status='ACTIVE' WHERE user_id=(SELECT user_id FROM authorization_test_users WHERE n=0);
DELETE FROM public.session_security_state WHERE session_id=(SELECT session_id FROM authorization_test_users WHERE n=0);
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM authorization_test_users u JOIN public.profiles p USING(user_id) WHERE n=0;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM authorization_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN ASSERT private.is_current_session_fully_authorized(),'Restored session failed'; END $test$;
RESET ROLE;
ROLLBACK;
