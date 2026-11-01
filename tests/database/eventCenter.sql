-- Non-production verification. Every fixture and temporary permission stub rolls back.
begin;
do $test$
begin
  if has_table_privilege('authenticated','public.audit_log','DELETE')
    or has_table_privilege('authenticated','public.audit_log','INSERT')
    or has_table_privilege('authenticated','public.security_audit_events','UPDATE')
    or has_table_privilege('anon','public.security_audit_events','TRUNCATE') then
    raise exception 'Evidence mutation privilege is exposed';
  end if;
  if has_function_privilege('authenticated','public.record_access_denial_service_v1(uuid,text,text)','EXECUTE')
    or has_function_privilege('anon','public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer)','EXECUTE') then
    raise exception 'Privileged endpoint exposed';
  end if;
  begin
    perform public.get_event_center_v1();
    raise exception 'Anonymous investigation unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $test$;
-- Isolate page mechanics from the separately enforced production FULL-session evaluator.
create or replace function private.current_user_has_permission_v1(p_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select p_key='config_users.group_events';
$$;

do $test$
declare
  group_id uuid;
  actor_id uuid := gen_random_uuid();
  event_id uuid;
  page jsonb;
  next_page jsonb;
  snapshot jsonb;
begin
  insert into public.user_groups(name,display_name,permissions)
  values ('audit_test_'||gen_random_uuid()::text,'Audit test','{}'::jsonb) returning id into group_id;
  update public.user_groups set permissions='{"config_users.users_list":true}'::jsonb where id=group_id;
  delete from public.user_groups where id=group_id;
  if (select count(*) from public.security_audit_events where metadata->>'entity_id'=group_id::text and metadata->>'source'='database_trigger')<>3 then
    raise exception 'Group INSERT/UPDATE/DELETE missing server evidence'; end if;
  select after_state into snapshot from public.security_audit_events where metadata->>'entity_id'=group_id::text and event_type='user_groups.update';
  if snapshot->'permissions'->>'config_users.users_list'<>'true' then raise exception 'Change values missing'; end if;
  perform public.record_access_denial_service_v1(actor_id,'admin-users','ADMIN_REQUIRED');
  perform public.record_access_denial_service_v1(actor_id,'admin-users','ADMIN_REQUIRED');
  select id,metadata into event_id,snapshot from public.security_audit_events where actor_user_id=actor_id and event_type='access.denied';
  if snapshot->>'attempt_count'<>'2' or snapshot->>'last_seen_at' is null then raise exception 'Repeated attempts not counted'; end if;
  page:=public.get_event_center_v1(p_search=>actor_id::text,p_result=>'denied');
  if jsonb_array_length(page->'events')<>1 or page->'events'->0->>'id'<>event_id::text then raise exception 'Search/result filtering failed'; end if;
  page:=public.get_event_center_v1(p_limit=>1);
  if not (page->>'has_more')::boolean then raise exception 'Missing pagination'; end if;
  next_page:=public.get_event_center_v1(p_limit=>1,p_before_time=>(page->'next_cursor'->>'time')::timestamptz,p_before_key=>page->'next_cursor'->>'key');
  if page->'events'->0->>'event_key'=next_page->'events'->0->>'event_key' then raise exception 'Duplicate cursor row'; end if;
  page:=public.get_event_center_v1(p_search=>group_id::text,p_source=>'security');
  if jsonb_array_length(page->'events')<>3 then raise exception 'Source or entity search failed'; end if;
  if public.sanitize_audit_metadata('{"token":"not-a-real-token","nested":{"password":"not-a-real-password"}}'::jsonb)::text like '%not-a-real-%' then raise exception 'Secret redaction failed'; end if;
  begin
    perform public.get_event_center_v1(p_limit=>101);
    raise exception 'Unbounded page accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.get_event_center_v1(p_from=>now()-interval '100 days');
    raise exception 'Unbounded time accepted';
  exception when invalid_parameter_value then null; end;
end $test$;
rollback;
