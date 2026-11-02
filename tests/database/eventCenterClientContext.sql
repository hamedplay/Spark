-- Non-production, rolled-back fixtures. Auth and permission stubs isolate writer/projection mechanics.
begin;
do $test$ begin
  if has_table_privilege('authenticated','private.event_session_context','SELECT')
    or has_table_privilege('authenticated','private.event_session_context','INSERT')
    or has_function_privilege('anon','public.record_my_session_context_v1()','EXECUTE')
    or has_function_privilege('authenticated','private.event_client_ip_v1(text)','EXECUTE') then
    raise exception 'Private context/privileged helper exposed';
  end if;
  begin perform public.record_my_session_context_v1(); raise exception 'Anonymous context write allowed';
  exception when insufficient_privilege then null; end;
  if private.event_client_ip_v1('192.0.2.42')<>'192.0.2.42'
    or private.event_client_ip_v1('2001:db8::42')<>'2001:db8::42' then raise exception 'IPv4/IPv6 host parsing failed'; end if;
  if exists(select 1 from unnest(array['0.0.0.0','::','bad','192.0.2.1:443','192.0.2.0/24','192.0.2.1, 192.0.2.2']) x
    where private.event_client_ip_v1(x) is not null) then raise exception 'Invalid/sentinel IP accepted'; end if;
end $test$;

create or replace function private.get_my_auth_access_state_v3()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('access_level',current_setting('spark.test.access',true),'user_id',auth.uid(),
    'session_id',auth.jwt()->>'session_id');
$$;
create or replace function private.current_user_has_permission_v1(p_key text)
returns boolean language sql stable security definer set search_path='' as $$ select p_key='config_users.group_events'; $$;

do $test$
declare
  actor uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); other_sid uuid:=gen_random_uuid();
  event_id uuid:=gen_random_uuid(); other_event uuid:=gen_random_uuid(); login_id uuid:=gen_random_uuid();
  ctx private.event_session_context%rowtype; page jsonb; event jsonb; first_time timestamptz;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',sid)::text,true);
  perform set_config('spark.test.access','MFA_REQUIRED',true);
  begin perform public.record_my_session_context_v1(); raise exception 'Limited session recorded as FULL';
  exception when insufficient_privilege then null; end;
  perform set_config('spark.test.access','FULL',true);
  perform set_config('request.headers',jsonb_build_object('x-spark-client-ip','2001:db8::42','x-forwarded-for','192.0.2.99',
    'user-agent',repeat('A',700),'authorization','secret-fixture-must-not-leak','cookie','secret-fixture-must-not-leak')::text,true);
  perform public.record_my_session_context_v1();
  select * into strict ctx from private.event_session_context where session_id=sid;
  first_time:=ctx.created_at;
  if ctx.user_id<>actor or host(ctx.ip_address)<>'2001:db8::42' or ctx.ip_source<>'proxy_header' or length(ctx.user_agent)<>512 then
    raise exception 'Context identity, proxy precedence or bounds failed'; end if;
  perform set_config('request.headers','{"x-spark-client-ip":"192.0.2.2","user-agent":"Changed device"}',true);
  perform public.record_my_session_context_v1();
  if (select count(*) from private.event_session_context where session_id=sid)<>1
    or (select host(ip_address) from private.event_session_context where session_id=sid)<>'2001:db8::42' then
    raise exception 'Refresh overwrote/duplicated original context'; end if;

  insert into public.security_audit_events(id,actor_user_id,event_type,event_category,severity,session_id,metadata)
    values(event_id,actor,'context_test','session','info',sid,'{"token":"secret-fixture-must-not-leak"}'),
      (other_event,gen_random_uuid(),'context_test','session','info',sid,'{}');
  insert into auth.audit_log_entries(id,created_at,ip_address,payload) values(login_id,now(),'192.0.2.8',
    json_build_object('action','login','actor_id',actor,'password','secret-fixture-must-not-leak'));
  page:=public.get_event_center_v1(p_search=>sid::text,p_source=>'security');
  if jsonb_array_length(page->'events')<>3 or page::text like '%secret-fixture-must-not-leak%' then
    raise exception 'Session search projection/redaction failed'; end if;
  select value into event from jsonb_array_elements(page->'events') where value->>'id'=event_id::text;
  if event->>'ip_address' is not null or event->'metadata'->'session_context'->>'ip_address'<>'2001:db8::42' then
    raise exception 'Session context missing or passed off as event IP'; end if;
  select value into event from jsonb_array_elements(page->'events') where value->>'id'=other_event::text;
  if event->'metadata' ? 'session_context' then raise exception 'Another actor inherited session context'; end if;
  page:=public.get_event_center_v1(p_search=>actor::text);
  select value into event from jsonb_array_elements(page->'events') where value->>'id'=login_id::text;
  if event->>'ip_address'<>'192.0.2.8' or event->'metadata' ? 'session_context' or event->'metadata' ? 'user_agent' then
    raise exception 'Auth IP not exposed or unrelated session device falsely attached'; end if;
  select value into event from jsonb_array_elements(page->'events') where value->>'event_type'='session.first_full_access';
  if event->'metadata'->>'verification_scope'<>'full_session' or event->>'session_id'<>sid::text
    or (event->>'created_at')::timestamptz<>first_time then raise exception 'FULL first-observation provenance failed'; end if;

  insert into public.session_security_state(session_id,user_id,idle_expiry_at,absolute_expiry_at,device_summary)
    values(other_sid,actor,now()+interval '1 hour',now()+interval '1 day','Mozilla/5.0 (Android 16; Mobile) Firefox/158.0');
  insert into public.security_audit_events(id,actor_user_id,event_type,event_category,severity,session_id,metadata)
    values(gen_random_uuid(),actor,'context_registry_test','session','info',other_sid,'{}');
  page:=public.get_event_center_v1(p_search=>other_sid::text);
  event:=page->'events'->0;
  if event->'metadata'->'session_device'->>'source'<>'session_registry'
    or event->>'ip_address' is not null then raise exception 'Legacy session registry projection failed'; end if;

  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated','session_id',other_sid)::text,true);
  perform set_config('request.headers','{"x-forwarded-for":"192.0.2.6, 127.0.0.1","user-agent":"Fixture"}',true);
  perform public.record_my_session_context_v1();
  select * into strict ctx from private.event_session_context where session_id=other_sid;
  if ctx.ip_source<>'forwarded_header' or host(ctx.ip_address)<>'192.0.2.6' then raise exception 'Fallback source lost provenance'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',gen_random_uuid())::text,true);
  perform set_config('request.headers','malformed JSON',true);
  perform public.record_my_session_context_v1();
  select * into strict ctx from private.event_session_context where session_id=(auth.jwt()->>'session_id')::uuid;
  if ctx.ip_address is not null or ctx.user_agent is not null then raise exception 'Missing context invented'; end if;
end $test$;
rollback;
select 'event_client_context_tests_passed_and_rolled_back' as result;
