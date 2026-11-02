-- Verify event-center Auth integration without creating real users/sessions or sending messages.
-- All fixtures and temporary authorization stubs are rolled back.
begin;
do $test$
begin
  if has_table_privilege('authenticated','auth.audit_log_entries','SELECT') then
    raise exception 'Auth audit table exposed directly to clients';
  end if;
  if has_function_privilege('authenticated','private.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)','EXECUTE') then
    raise exception 'Private implementation exposed';
  end if;
  begin
    perform public.get_event_center_v1();
    raise exception 'Unauthenticated event-center read allowed';
  exception when insufficient_privilege then null; end;
end $test$;

create or replace function private.current_user_has_permission_v1(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_key='config_users.group_events';
$$;

do $test$
declare
  actor_id uuid := gen_random_uuid();
  login_id uuid := gen_random_uuid();
  logout_id uuid := gen_random_uuid();
  refresh_id uuid := gen_random_uuid();
  malformed_id uuid := gen_random_uuid();
  app_id uuid := gen_random_uuid();
  stamp timestamptz := now()+interval '1 day';
  page jsonb;
  next_page jsonb;
  event jsonb;
begin
  insert into auth.audit_log_entries(id,payload,created_at) values
    (login_id,json_build_object('action','login','actor_id',actor_id,'actor_name','private-email-fixture',
      'traits',json_build_object('provider','email','access_token','secret-fixture-must-not-leak'),'password','secret-fixture-must-not-leak'),stamp),
    (logout_id,json_build_object('action','logout','actor_id',actor_id),stamp),
    (refresh_id,json_build_object('action','token_refreshed','actor_id',actor_id),stamp),
    (malformed_id,json_build_object('action','login','actor_id','invalid-uuid'),stamp);
  insert into public.audit_log(id,user_id,module,action,severity,created_at,details)
    values(app_id,null,'auth','logout','info',stamp,'Client-reported fixture');

  page:=public.get_event_center_v1(p_from=>stamp,p_to=>stamp+interval '1 second',p_limit=>100);
  if jsonb_array_length(page->'events')<>4 then raise exception 'Wrong merged sources or refresh classified as login: %',page; end if;
  if page::text like '%secret-fixture-must-not-leak%' or page::text like '%private-email-fixture%' then
    raise exception 'Raw Auth payload leaked'; end if;
  select value into event from jsonb_array_elements(page->'events') where value->>'id'=login_id::text;
  if event->>'event_type'<>'auth.login' or event->>'actor_user_id'<>actor_id::text
    or event->>'source'<>'security' or event->'metadata'->>'source'<>'auth_service'
    or event->>'result'<>'success' then raise exception 'Login not projected correctly'; end if;
  select value into event from jsonb_array_elements(page->'events') where value->>'id'=malformed_id::text;
  if event is null or event->>'actor_user_id' is not null then raise exception 'Malformed actor lost event or crashed cast'; end if;

  page:=public.get_event_center_v1(p_from=>stamp,p_to=>stamp+interval '1 second',p_search=>actor_id::text,p_source=>'security',p_result=>'success');
  if jsonb_array_length(page->'events')<>2 then raise exception 'Auth source/outcome/actor filter failed'; end if;
  page:=public.get_event_center_v1(p_from=>stamp,p_to=>stamp+interval '1 second',p_source=>'application');
  if jsonb_array_length(page->'events')<>1 then raise exception 'Application filter unexpectedly includes Auth rows'; end if;
  page:=public.get_event_center_v1(p_from=>stamp,p_to=>stamp+interval '1 second',p_search=>'ورود');
  if jsonb_array_length(page->'events')<>2 then raise exception 'Persian login search missing records'; end if;

  page:=public.get_event_center_v1(p_from=>stamp,p_to=>stamp+interval '1 second',p_limit=>2);
  next_page:=public.get_event_center_v1(p_from=>stamp,p_to=>stamp+interval '1 second',p_limit=>2,
    p_before_time=>(page->'next_cursor'->>'time')::timestamptz,p_before_key=>page->'next_cursor'->>'key');
  if not (page->>'has_more')::boolean or (next_page->>'has_more')::boolean then raise exception 'Merged pagination boundaries incorrect'; end if;
  if exists(select 1 from jsonb_array_elements(page->'events') a cross join jsonb_array_elements(next_page->'events') b
    where a->>'event_key'=b->>'event_key') then raise exception 'Duplicate merged cursor row'; end if;
end $test$;

-- The pre-existing legacy audit read grant must still reach the same source.
create or replace function private.current_user_has_permission_v1(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_key='config_audit.audit_log';
$$;
select public.get_event_center_v1(p_search=>'auth.login',p_limit=>1) is not null as legacy_permission_read_ok;
rollback;
