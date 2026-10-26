-- Only temporary fixtures; all data changes roll back.
begin;
create temp table saved_test_users as select gen_random_uuid() user_id, gen_random_uuid() session_id,n from generate_series(1,2)n;
grant select on saved_test_users to authenticated;
insert into auth.users(id,created_at,updated_at,raw_app_meta_data,raw_user_meta_data)
select user_id,now(),now(),'{}','{}' from saved_test_users;
insert into public.profiles(user_id,full_name,account_status,is_active,profile_completion_status,registration_source)
select user_id,'Temporary saved messages fixture','ACTIVE',true,'COMPLETE','imported' from saved_test_users;
insert into auth.sessions(id,user_id,created_at,updated_at,aal)
select session_id,user_id,now(),now(),'aal1' from saved_test_users;
insert into public.session_security_state(session_id,user_id,auth_epoch,idle_expiry_at,absolute_expiry_at)
select s.session_id,s.user_id,p.auth_epoch,now()+interval '1 hour',now()+interval '2 hours'
from saved_test_users s join public.profiles p on p.user_id=s.user_id;

select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from saved_test_users where n=1;
set local role authenticated;
do $$ declare endpoint text := 'https://push.example.invalid/'||(select user_id from saved_test_users where n=1)::text; begin
  perform public.upsert_my_pwa_push_subscription(endpoint,'temporary-p256dh','temporary-auth','SQL test browser');
  assert exists(select 1 from public.pwa_push_subscriptions where user_id=auth.uid() and disabled_at is null), 'own endpoint registered';
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from saved_test_users where n=2;
set local role authenticated;
do $$ begin
  assert not exists(select 1 from public.pwa_push_subscriptions where user_id=(select user_id from saved_test_users where n=1)), 'another user endpoint is private';
  perform public.disable_my_pwa_push_subscription('https://push.example.invalid/'||(select user_id from saved_test_users where n=1)::text);
end $$;
reset role;
do $$ begin
  assert exists(select 1 from public.pwa_push_subscriptions where user_id=(select user_id from saved_test_users where n=1) and disabled_at is null), 'cannot disable another user endpoint';
end $$;
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from saved_test_users where n=1;
set local role authenticated;
do $$ begin
  perform public.disable_my_pwa_push_subscription('https://push.example.invalid/'||auth.uid()::text);
  assert exists(select 1 from public.pwa_push_subscriptions where user_id=auth.uid() and disabled_at is not null), 'own endpoint can be disabled';
end $$;
reset role;
rollback;
