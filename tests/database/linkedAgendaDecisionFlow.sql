-- Copy/disposable DB only. Real authenticated RPCs; all fixtures/settings roll back.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL plpgsql.check_asserts=on;
CREATE TEMP TABLE agenda_flow_users AS
 SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,2)n;
GRANT SELECT ON agenda_flow_users TO authenticated;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
 SELECT user_id,now(),now(),'{}','{}' FROM agenda_flow_users;
INSERT INTO public.profiles(user_id,full_name,is_admin,account_status,is_active,profile_completion_status,registration_source)
 SELECT user_id,'Agenda flow fixture '||n,n=2,'ACTIVE',true,'COMPLETE','imported' FROM agenda_flow_users;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
 SELECT session_id,user_id,now(),now(),'aal1' FROM agenda_flow_users;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
 SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
 FROM agenda_flow_users u JOIN public.profiles p USING(user_id);
INSERT INTO private.password_gateway_session_authorizations(session_id,user_id,login_method,identifier_hash,ip_hash,auth_session_created_at)
 SELECT session_id,user_id,'email',encode(extensions.digest('agenda-flow-fixture','sha256'),'hex'),
 encode(extensions.digest('fixture','sha256'),'hex'),now() FROM agenda_flow_users;
UPDATE public.auth_security_settings SET session_management_enabled=true,mfa_policy='disabled' WHERE id=1;
CREATE TEMP TABLE agenda_flow_objects AS SELECT gen_random_uuid() source_meeting,gen_random_uuid() target_meeting,
 gen_random_uuid() source_minute,gen_random_uuid() target_minute,gen_random_uuid() decision_id,
 gen_random_uuid() agenda_id,gen_random_uuid() manual_id,gen_random_uuid() result_id;
GRANT SELECT ON agenda_flow_objects TO authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,
 'role','authenticated','aal','aal1')::text,true) FROM agenda_flow_users WHERE n=0;
INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,request_date,start_time,end_time,status_type)
 SELECT id,'Agenda flow fixture','Room','','',u.user_id,'2026-11-04','09:00','10:00','scheduled'
 FROM agenda_flow_objects CROSS JOIN agenda_flow_users u CROSS JOIN LATERAL
 (VALUES(source_meeting),(target_meeting)) ids(id) WHERE u.n=0;
INSERT INTO public.minutes(id,meeting_id,meeting_title_snapshot,meeting_date_snapshot,
 secretary_name_snapshot,chair_name_snapshot,created_by_user_id,secretary_user_id,chair_user_id,
 status,published_at,secretary_confirmed_at,chair_confirmed_at)
 SELECT id,meeting,'Agenda flow fixture','2026-11-04','Secretary','Chair',u.user_id,u.user_id,u.user_id,
 'published',now(),now(),now() FROM agenda_flow_objects CROSS JOIN agenda_flow_users u
 CROSS JOIN LATERAL (VALUES(source_minute,source_meeting),(target_minute,target_meeting)) ids(id,meeting) WHERE u.n=0;
INSERT INTO public.minutes_decisions(id,minute_id,title,created_by_user_id,primary_owner_user_id)
 SELECT decision_id,source_minute,'agenda-flow-'||decision_id,u.user_id,u.user_id
 FROM agenda_flow_objects CROSS JOIN agenda_flow_users u WHERE n=0;

SET LOCAL ROLE authenticated;
DO $test$
DECLARE o record; r jsonb; payload jsonb;
BEGIN
 SELECT * INTO o FROM agenda_flow_objects;
 r:=public.pick_meeting_agenda_decisions_v1(p_search=>'agenda-flow-'||o.decision_id);
 ASSERT (r->>'total')::integer=1,'Authorized picker must include source';
 ASSERT r->'items'->0->>'meeting_date'='2026-11-04','Picker date contract';
 ASSERT (public.get_linked_agenda_decision_v1(o.decision_id)->>'id')::uuid=o.decision_id,'Details visible';
 payload:=jsonb_build_array(jsonb_build_object('id',o.agenda_id,'title','Editable agenda title','source_decision_id',o.decision_id),
   jsonb_build_object('id',o.manual_id,'title','Manual agenda'));
 ASSERT public.sync_linked_meeting_agenda_v1(o.target_meeting,payload)=2,'Mixed agenda saved';
 ASSERT public.sync_linked_meeting_agenda_v1(o.target_meeting,jsonb_build_array(payload->1,
   (payload->0)||jsonb_build_object('title','Custom edited title')))=2,'Reorder/edit preserve identities';
 BEGIN
  PERFORM public.sync_linked_meeting_agenda_v1(o.target_meeting,
    payload||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title','Duplicate','source_decision_id',o.decision_id)));
  RAISE EXCEPTION 'Duplicate source accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  PERFORM public.set_minutes_agenda_official_references_v1(o.decision_id,'should-fail','should-fail');
  RAISE EXCEPTION 'Non-admin references accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ DECLARE o record; BEGIN
 SELECT * INTO o FROM agenda_flow_objects;
 ASSERT EXISTS(SELECT FROM public.meeting_agenda_items WHERE id=o.agenda_id
   AND source_decision_id=o.decision_id AND sort_order=1 AND title='Custom edited title'),'Stable UUID/source/title/order';
 ASSERT (SELECT title FROM public.minutes_decisions WHERE id=o.decision_id)='agenda-flow-'||o.decision_id,'Original title unchanged';
END $test$;
INSERT INTO public.minutes_agenda_results(id,minute_id,meeting_agenda_item_id,agenda_title_snapshot)
 SELECT result_id,target_minute,agenda_id,'Custom edited title' FROM agenda_flow_objects;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT FROM public.minutes_agenda_results a JOIN agenda_flow_objects o ON a.id=o.result_id
   WHERE a.source_decision_id=o.decision_id),'Independent result source snapshot';
END $test$;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
 ASSERT (public.record_linked_agenda_followup_v1((SELECT result_id FROM agenda_flow_objects),'Result of the new meeting')->>'success')='true',
   'Authorized published followup';
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT FROM public.minutes_decision_updates u JOIN agenda_flow_objects o ON u.decision_id=o.decision_id
   WHERE u.event_type='followup' AND u.update_text='Result of the new meeting'
   AND u.event_metadata->>'agenda_result_id'=o.result_id::text),'Result in original decision history';
END $test$;

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,
 'role','authenticated','aal','aal1')::text,true) FROM agenda_flow_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE o record; BEGIN
 SELECT * INTO o FROM agenda_flow_objects;
 ASSERT (public.pick_meeting_agenda_decisions_v1(p_search=>'agenda-flow-'||o.decision_id)->>'total')::integer=0,'Outsider picker excludes source';
 BEGIN PERFORM public.get_linked_agenda_decision_v1(o.decision_id); RAISE EXCEPTION 'Outsider details accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.sync_linked_meeting_agenda_v1(o.target_meeting,'[]'); RAISE EXCEPTION 'Outsider edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.record_linked_agenda_followup_v1(o.result_id,'Unauthorized result'); RAISE EXCEPTION 'Outsider followup accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,
 'role','authenticated','aal','aal1')::text,true) FROM agenda_flow_users WHERE n=2;
SET LOCAL ROLE authenticated;
DO $test$ DECLARE r jsonb; BEGIN
 r:=public.set_minutes_agenda_official_references_v1((SELECT decision_id FROM agenda_flow_objects),'official-minute-125','official-decision-3');
 ASSERT r->>'minute_number'='official-minute-125' AND r->>'decision_number'='official-decision-3','Admin references saved';
END $test$;
RESET ROLE;
DO $test$ BEGIN
 ASSERT EXISTS(SELECT FROM public.audit_log a JOIN agenda_flow_objects o ON a.entity_id=o.decision_id::text
   WHERE a.action='official_references.update'),'Official references audited';
END $test$;
DELETE FROM public.meeting_agenda_items WHERE id=(SELECT agenda_id FROM agenda_flow_objects);
DO $test$ BEGIN
 ASSERT EXISTS(SELECT FROM public.minutes_agenda_results a JOIN agenda_flow_objects o ON a.id=o.result_id
   WHERE a.meeting_agenda_item_id IS NULL AND a.source_decision_id=o.decision_id),'Deletion retains result source';
END $test$;
ROLLBACK;
SELECT 'PASS: authorized picker/edit, date contract, stable UUID/source/order, duplicate guard, result snapshot/history, outsider denial, admin numbering/audit, deletion retention; all rolled back' AS linked_agenda_validation;
