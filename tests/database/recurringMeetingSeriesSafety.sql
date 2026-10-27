-- Transactional integration tests: no SMS/Push job or fixture is committed.
begin;
create temp table series_test_users as select gen_random_uuid() user_id,gen_random_uuid() session_id,n from generate_series(0,11)n;
grant select on series_test_users to authenticated;
insert into auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data) select user_id,now(),now(),'{}','{}' from series_test_users;
insert into public.profiles(user_id,full_name,is_admin,account_status,is_active,profile_completion_status,registration_source)
select user_id,'Temporary series fixture '||n,n=0,'ACTIVE',true,'COMPLETE','imported' from series_test_users;
insert into public.user_preferences(user_id,notifications_enabled) select user_id,false from series_test_users;
insert into auth.sessions(id,user_id,created_at,updated_at,aal) select session_id,user_id,now(),now(),'aal1' from series_test_users;
insert into public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
select u.session_id,u.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours' from series_test_users u join public.profiles p on p.user_id=u.user_id;
insert into private.password_gateway_session_authorizations(session_id,user_id,login_method,identifier_hash,ip_hash,auth_session_created_at)
select session_id,user_id,'email',encode(extensions.digest('series-fixture','sha256'),'hex'),encode(extensions.digest('fixture','sha256'),'hex'),now() from series_test_users;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from series_test_users where n=0;

-- Resolve duplicate external contacts to a single phone and avoid sending both
-- internal and external SMS to the same person.
update public.profiles set phone='09000000001' where user_id=(select user_id from series_test_users where n=1);
insert into public.contacts_email(user_id,name,phone) values
((select user_id from series_test_users where n=0),'Internal duplicate','+989000000001'),
((select user_id from series_test_users where n=0),'External A','09000000002'),
((select user_id from series_test_users where n=0),'External alias','+989000000002');
create temp table series_test_input as select gen_random_uuid() operation_id,gen_random_uuid() failure_id,
(select jsonb_agg(jsonb_build_object('user_id',u.user_id,'subject','Same title','location','Test room','representative','','phone','','status','archived','status_type','scheduled','request_date',('2027-01-03'::date+d.n*7)::text,'start_time','09:00','end_time','10:00','repeat_type','weekly','repeat_interval',1,'send_sms',true,'participant_user_ids',(select jsonb_agg(user_id) from series_test_users where n between 1 and 2),'notify_users',(select jsonb_agg(user_id) from series_test_users where n=1),'external_participants',jsonb_build_array('Internal duplicate','External A','External alias'))) from generate_series(0,1)d(n) cross join series_test_users u where u.n=0) records;
grant select on series_test_input to authenticated;
set local role authenticated;
do $$ begin
 perform public.create_meeting_series((select operation_id from series_test_input),(select records from series_test_input),'[]','هر هفته یکشنبه');
 begin
  perform public.create_meeting_series((select failure_id from series_test_input),(select records from series_test_input),'[{"presenter":"missing title"}]','هر هفته یکشنبه');
  raise exception 'invalid agenda unexpectedly committed';
 exception when not_null_violation then null; end;
end $$;
reset role;
do $$ begin
 assert (select count(*) from private.meeting_notification_jobs where series_id=(select operation_id from series_test_input))=4,'3 unique internal identities plus one unique external phone';
 assert (select count(*) from private.meeting_notification_jobs where series_id=(select operation_id from series_test_input) and target_phone='09000000002')=1,'external phone normalization';
 assert not exists(select 1 from private.meeting_series_batches where id=(select failure_id from series_test_input)),'failed details roll back series ledger';
 assert not exists(select 1 from public.meetings where series_id=(select failure_id from series_test_input)),'failed details roll back every occurrence';
end $$;
-- Same title is never a series identifier.
set local role authenticated;
do $$ begin perform public.create_meeting_series(gen_random_uuid(),(select records from series_test_input),'[]','هر هفته یکشنبه'); end $$;
reset role;
do $$ begin assert (select count(distinct series_id) from public.meetings where user_id=(select user_id from series_test_users where n=0))=2,'same title creates distinct series'; end $$;
-- Re-encoding a date within the same Tehran day must not notify retained people.
delete from private.meeting_notification_jobs where series_id=(select operation_id from series_test_input);
update public.meetings set request_date=((private.meeting_local_date(request_date)::timestamp at time zone 'Asia/Tehran')+interval '3 hours')::text where series_id=(select operation_id from series_test_input);
do $$ begin assert not exists(select 1 from private.meeting_notification_jobs where series_id=(select operation_id from series_test_input)),'same local day is not a schedule change'; end $$;
-- Worker RPCs are unavailable to signed-in browser clients.
do $$ begin
 assert not has_function_privilege('authenticated','public.claim_meeting_notification_jobs(integer)','EXECUTE'),'browser cannot claim jobs';
 assert not has_function_privilege('anon','public.verify_meeting_worker_token(text)','EXECUTE'),'anonymous cannot probe token';
 assert has_function_privilege('service_role','public.claim_meeting_notification_jobs(integer)','EXECUTE'),'worker can claim jobs';
end $$;
rollback;
