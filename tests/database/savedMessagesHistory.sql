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
create temp table saved_test_conversations as select gen_random_uuid() id,n from generate_series(1,2)n;
grant select on saved_test_conversations to authenticated;
insert into public.chat_conversations(id,participant_a,participant_b,created_by)
select c.id,u.user_id,u.user_id,u.user_id from saved_test_conversations c join saved_test_users u using(n);
insert into public.chat_messages(conversation_id,sender_id,body)
select c.id,u.user_id,'Temporary saved message' from saved_test_conversations c join saved_test_users u using(n);
select set_config('request.jwt.claims',jsonb_build_object('sub',user_id,'session_id',session_id,'role','authenticated','aal','aal1')::text,true) from saved_test_users where n=1;
set local role authenticated;
do $$ begin
  assert private.is_current_session_fully_authorized(), 'fixture session must pass the full authorization gate';
  assert exists(select 1 from public.chat_messages where conversation_id=(select id from saved_test_conversations where n=1)), 'own saved message must initially be visible';
  perform public.clear_chat_for_user((select id from saved_test_conversations where n=1));
  assert not exists(select 1 from public.chat_messages where conversation_id=(select id from saved_test_conversations where n=1)), 'cleared saved history must disappear';
  perform public.clear_chat_for_user((select id from saved_test_conversations where n=1));
  begin
    perform public.clear_chat_for_user((select id from saved_test_conversations where n=2));
    raise exception 'test failed: another user saved history was cleared';
  exception when raise_exception then
    if sqlerrm <> 'Not authorized' then raise; end if;
  end;
end $$;
reset role;
-- New messages after clearing remain visible; the other user's history is intact.
insert into public.chat_messages(conversation_id,sender_id,body)
select c.id,u.user_id,'New saved message' from saved_test_conversations c join saved_test_users u using(n) where n=1;
set local role authenticated;
do $$ begin
  assert (select count(*)=1 from public.chat_messages where conversation_id=(select id from saved_test_conversations where n=1)), 'new saved messages remain visible';
end $$;
reset role;
do $$ begin
  assert (select count(*)=2 from public.chat_messages where conversation_id=(select id from saved_test_conversations where n=1)), 'clear retains physical records for existing audit behavior';
  assert (select count(*)=1 from public.chat_messages where conversation_id=(select id from saved_test_conversations where n=1) and not deleted_for_sender), 'explicit personal-history filter also hides cleared rows when RLS is bypassed';
  assert exists(select 1 from public.chat_messages where conversation_id=(select id from saved_test_conversations where n=2) and not deleted_for_sender), 'other user history unchanged';
end $$;
rollback;
