-- Test only: all identities, sessions, notifications and updates roll back.
begin;
create temp table notification_test_users as
select gen_random_uuid() as user_id, gen_random_uuid() as session_id, gen_random_uuid() as notification_id, n
from generate_series(1,2) as n;
grant select on notification_test_users to authenticated;
insert into auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select user_id,now(),now(),'{}'::jsonb,'{}'::jsonb from notification_test_users;
insert into public.profiles(user_id,full_name,account_status,is_active,profile_completion_status,registration_source)
select user_id,'Temporary notification action fixture','ACTIVE',true,'COMPLETE','imported' from notification_test_users;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
select session_id,user_id,now(),now(),'aal1' from notification_test_users;
insert into public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
select session_id,user_id,1,now()+interval '1 hour',now()+interval '2 hours' from notification_test_users;
insert into public.notifications(id,user_id,title,message,type,read)
select notification_id,user_id,'Action fixture','No real recipients','system',false from notification_test_users;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from notification_test_users where n=1;
set local role authenticated;
do $$ declare v_count integer; begin
  assert private.is_current_session_fully_authorized(), 'fixture session must be FULL';
  update public.notifications set read=true where id=(select notification_id from notification_test_users where n=1) and user_id=auth.uid();
  get diagnostics v_count=row_count;
  assert v_count=1, 'own notification can be marked read';
  assert exists(select 1 from public.notifications where id=(select notification_id from notification_test_users where n=1) and read=true), 'read persists';
  update public.notifications set read=true where id=(select notification_id from notification_test_users where n=2);
  get diagnostics v_count=row_count;
  assert v_count=0, 'cannot mark another user notification read';
  delete from public.notifications where id=(select notification_id from notification_test_users where n=2);
  get diagnostics v_count=row_count;
  assert v_count=0, 'cannot delete another user notification';
  delete from public.notifications where id=(select notification_id from notification_test_users where n=1) and user_id=auth.uid();
  get diagnostics v_count=row_count;
  assert v_count=1, 'own notification can be deleted';
end $$;
reset role;
do $$ begin
  assert exists(select 1 from public.notifications where id=(select notification_id from notification_test_users where n=2) and read=false), 'other recipient remains untouched';
  assert not exists(select 1 from public.notifications where id=(select notification_id from notification_test_users where n=1)), 'deletion persists';
end $$;
rollback;
