-- Run on the connected test database. All fixtures and profile/session changes roll back.
begin;
create temp table chat_test_users as
select gen_random_uuid() as user_id, gen_random_uuid() as session_id, n
from generate_series(1,3) as n;
grant select on chat_test_users to authenticated;
insert into auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select user_id,now(),now(),'{}'::jsonb,'{}'::jsonb from chat_test_users;
insert into public.profiles(user_id,full_name,account_status,is_active,profile_completion_status,registration_source)
select user_id,'Temporary call history SQL fixture','ACTIVE',true,'COMPLETE','imported' from chat_test_users;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
select session_id,user_id,now(),now(),'aal1' from chat_test_users;
insert into public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
select t.session_id,t.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
from chat_test_users t join public.profiles p on p.user_id=t.user_id;
create temp table chat_test_calls (id uuid, label text);
insert into chat_test_calls values (gen_random_uuid(),'ended'),(gen_random_uuid(),'missed'),(gen_random_uuid(),'active'),(gen_random_uuid(),'outsider'),(gen_random_uuid(),'new');
grant select on chat_test_calls to authenticated;
insert into public.call_sessions(id,caller_id,callee_id,status)
select c.id,(select user_id from chat_test_users where n=1),
  (select user_id from chat_test_users where n=2),c.label
from chat_test_calls c where label in ('ended','missed','active');
insert into public.call_sessions(id,caller_id,callee_id,status)
select c.id,(select user_id from chat_test_users where n=2),
  (select user_id from chat_test_users where n=3),'ended'
from chat_test_calls c where label='outsider';

select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from chat_test_users where n=1;
set local role authenticated;
do $$ begin
  assert private.is_current_session_fully_authorized(), 'real auth gate fixture must be FULL';
  assert (select count(*)=2 from public.get_my_call_history() where id in(select id from chat_test_calls)), 'only terminal participant calls visible';
  perform public.clear_my_call_history();
  assert (select count(*)=0 from public.get_my_call_history() where id in(select id from chat_test_calls)), 'history must disappear for clearing user';
  assert public.clear_my_call_history()=0, 'clear must be idempotent';
  assert not has_table_privilege('authenticated','private.chat_call_history_hidden','INSERT'), 'cannot forge another user history';
  assert not has_function_privilege('anon','public.clear_my_call_history()','EXECUTE'), 'anonymous clear forbidden';
  assert not has_function_privilege('anon','public.get_my_call_history(integer)','EXECUTE'), 'anonymous history forbidden';
end $$;
reset role;
-- Clearing must not change calls, active sessions, or the other participant's view.
do $$ begin
  assert (select count(*)=4 from public.call_sessions where id in(select id from chat_test_calls)), 'call records must remain';
  assert not exists(select 1 from private.chat_call_history_hidden h join chat_test_calls c on c.id=h.call_id where c.label in ('active','outsider')), 'active and unrelated calls protected';
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from chat_test_users where n=2;
set local role authenticated;
do $$ begin
  assert (select count(*)=3 from public.get_my_call_history() where id in(select id from chat_test_calls)), 'other participant history must remain';
  assert not exists(select 1 from private.chat_call_history_hidden), 'other user cannot see clearing user markers';
end $$;
reset role;
-- New completed calls after a clear must still be listed.
insert into public.call_sessions(id,caller_id,callee_id,status)
select c.id,(select user_id from chat_test_users where n=1),(select user_id from chat_test_users where n=2),'ended'
from chat_test_calls c where label='new';
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from chat_test_users where n=1;
set local role authenticated;
do $$ begin
  assert exists(select 1 from public.get_my_call_history() where id=(select id from chat_test_calls where label='new')), 'new calls remain visible';
end $$;
reset role;
-- A user id without an actual valid session cannot invoke the definer clear RPC.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from chat_test_users where n=3),'session_id',gen_random_uuid(),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  assert not exists(select 1 from public.get_my_call_history()), 'invalid session cannot list history';
  begin
    perform public.clear_my_call_history();
    raise exception 'test failed: invalid session accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
