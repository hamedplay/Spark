-- New audit/relationship/counter/date regressions. All fixtures are rolled back.
BEGIN;
SET LOCAL statement_timeout='20s';
CREATE TEMP TABLE repair_test_users AS
SELECT n,gen_random_uuid() user_id,gen_random_uuid() session_id FROM generate_series(0,2)n;
GRANT SELECT ON repair_test_users TO authenticated;
INSERT INTO auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
SELECT user_id,now(),now(),'{}','{}' FROM repair_test_users;
INSERT INTO public.profiles(user_id,full_name,is_admin,is_security_admin,account_status,is_active,profile_completion_status,registration_source)
SELECT user_id,'Repair regression '||n,n=0,n=2,'ACTIVE',true,'COMPLETE','imported' FROM repair_test_users;
INSERT INTO auth.sessions(id,user_id,created_at,updated_at,aal)
SELECT session_id,user_id,now(),now(),'aal1' FROM repair_test_users;
INSERT INTO public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
SELECT u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
FROM repair_test_users u JOIN public.profiles p USING(user_id);
INSERT INTO private.password_gateway_session_authorizations(session_id,user_id,login_method,identifier_hash,ip_hash,auth_session_created_at)
SELECT session_id,user_id,'email',encode(extensions.digest('repair-fixture','sha256'),'hex'),encode(extensions.digest('fixture','sha256'),'hex'),now()
FROM repair_test_users;
CREATE TEMP TABLE repair_test_input AS SELECT gen_random_uuid() request_id;
GRANT SELECT ON repair_test_input TO authenticated;
INSERT INTO public.security_audit_events(event_type,event_category,severity,result,request_id,created_at,metadata)
SELECT 'repair-regression','auth','info','success',request_id,now(),jsonb_build_object('password','must-be-redacted')
FROM repair_test_input CROSS JOIN generate_series(1,7);

SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM repair_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$
DECLARE page1 jsonb; page2 jsonb; request uuid:=(SELECT request_id FROM repair_test_input);
BEGIN
  page1:=public.get_security_audit_page_v2(p_request_id=>request,p_limit=>3);
  ASSERT (page1->>'ok')::boolean,'Admin audit read failed';
  ASSERT (page1->>'total')::integer=7 AND jsonb_array_length(page1->'events')=3,'Limit must apply before aggregation';
  ASSERT (page1->>'has_more')::boolean,'More-page marker missing';
  page2:=public.get_security_audit_page_v2(p_request_id=>request,p_limit=>3,
    p_before_created_at=>(page1->'next_cursor'->>'before_created_at')::timestamptz,
    p_before_id=>(page1->'next_cursor'->>'before_id')::uuid);
  ASSERT jsonb_array_length(page2->'events')=3 AND (page2->>'total')::integer=7,'Second page incorrect';
  ASSERT NOT EXISTS(SELECT FROM jsonb_array_elements(page1->'events')a CROSS JOIN jsonb_array_elements(page2->'events')b WHERE a->>'id'=b->>'id'),'Pages overlap';
  ASSERT (public.get_security_audit_page_v2(p_limit=>0)->>'error')='INVALID_LIMIT';
  ASSERT (public.get_security_audit_page_v2(p_before_id=>gen_random_uuid())->>'error')='INVALID_CURSOR';
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM repair_test_users WHERE n=1;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  ASSERT public.get_security_audit_page_v2()->>'error'='FORBIDDEN','Normal user saw security audit';
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM repair_test_users WHERE n=2;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  ASSERT (public.get_security_audit_page_v2(p_request_id=>(SELECT request_id FROM repair_test_input))->>'ok')::boolean,'Security admin was denied';
END $test$;
RESET ROLE;
UPDATE public.session_security_state SET revoked_at=now() WHERE session_id=(SELECT session_id FROM repair_test_users WHERE n=2);
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  ASSERT public.get_security_audit_page_v2()->>'error'='AUTH_ACCESS_RESTRICTED','Revoked session saw audit';
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);

-- Temporary login locks are enforced by the canonical v3 access evaluator.
UPDATE public.profiles SET locked_until=now()+interval '10 minutes'
WHERE user_id=(SELECT user_id FROM repair_test_users WHERE n=0);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true)
FROM repair_test_users WHERE n=0;
SET LOCAL ROLE authenticated;
DO $test$ BEGIN
  ASSERT public.get_security_audit_page_v2()->>'error'='AUTH_ACCESS_RESTRICTED','Temporarily locked admin saw audit';
END $test$;
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);

DO $test$
DECLARE owner uuid:=(SELECT user_id FROM repair_test_users WHERE n=0);
  member uuid:=(SELECT user_id FROM repair_test_users WHERE n=1);
  c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); mid uuid:=gen_random_uuid(); cal uuid:=gen_random_uuid();
BEGIN
  INSERT INTO public.channels(id,name,type,created_by) VALUES(c1,'Counter A','group',owner),(c2,'Counter B','group',owner);
  INSERT INTO public.channel_members(channel_id,user_id,role) VALUES(c1,member,'member');
  ASSERT (SELECT member_count FROM public.channels WHERE id=c1)=1,'Insert double-counted';
  UPDATE public.channel_members SET channel_id=c2 WHERE channel_id=c1 AND user_id=member;
  ASSERT (SELECT member_count FROM public.channels WHERE id=c1)=0 AND (SELECT member_count FROM public.channels WHERE id=c2)=1,'Membership move drifted';
  DELETE FROM public.channel_members WHERE channel_id=c2;
  ASSERT (SELECT member_count FROM public.channels WHERE id=c2)=0,'Delete count drifted';
  INSERT INTO public.calendars(id,name,color,type,user_id) VALUES(cal,'Repair fixture','#000000','personal',owner);
  INSERT INTO public.meetings(id,subject,location,representative,phone,user_id,calendar_id,request_date,start_time,end_time)
    VALUES(mid,'Repair fixture','Room','','',owner,cal,'2026-10-27T20:30:00.000Z','09:00','10:00');
  ASSERT (SELECT request_local_date FROM public.meetings WHERE id=mid)='2026-10-28'::date,'UTC timestamp day is wrong';
  UPDATE public.meetings SET request_date='2026-10-28' WHERE id=mid;
  ASSERT (SELECT request_local_date FROM public.meetings WHERE id=mid)='2026-10-28'::date,'Date-only day changed';
  BEGIN
    UPDATE public.meetings SET request_date='not a date' WHERE id=mid;
    RAISE EXCEPTION 'Invalid date accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  DELETE FROM public.calendars WHERE id=cal;
  ASSERT (SELECT calendar_id IS NULL FROM public.meetings WHERE id=mid),'Calendar delete left a broken reference';
  INSERT INTO public.meeting_inbox(meeting_id,user_id) VALUES(mid,member) ON CONFLICT(meeting_id,user_id) DO NOTHING;
  DELETE FROM public.meetings WHERE id=mid;
  ASSERT NOT EXISTS(SELECT FROM public.meeting_inbox WHERE meeting_id=mid),'Meeting delete left inbox records';
  BEGIN
    INSERT INTO public.meeting_inbox(meeting_id,user_id) VALUES(NULL,member);
    RAISE EXCEPTION 'Null meeting accepted';
  EXCEPTION WHEN not_null_violation THEN NULL; END;
END $test$;
SELECT 'audit pagination, role gates, counters, relationships and Tehran dates passed' AS result;
ROLLBACK;
