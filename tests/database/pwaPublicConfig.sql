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
set local role authenticated;
do $$ declare c jsonb; begin
 c:=public.get_my_pwa_push_config();
 assert c ? 'publicKey' and length(c->>'publicKey')>20,'FULL session receives configured public key';
 assert (select count(*) from jsonb_object_keys(c))=1,'private key must never be returned';
 assert not has_function_privilege('anon','public.get_my_pwa_push_config()','execute'),'anonymous callers denied';
 assert not has_function_privilege('authenticated','public.get_pwa_vapid_config_service()','execute'),'private-key service RPC remains denied';
end $$;
reset role;
update public.session_security_state set idle_expiry_at=now()-interval '1 hour' where session_id in(select session_id from series_test_users);
set local role authenticated;
do $$ begin
 begin perform public.get_my_pwa_push_config(); raise exception 'Expired session was accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
