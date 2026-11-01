-- Unified investigation endpoint; evidence stays in the existing audit stores.
-- Restrict evidence mutation to trusted server writers/retention jobs.
revoke insert, update, delete, truncate, references, trigger on public.audit_log from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.security_audit_events from anon, authenticated;

create index if not exists audit_log_created_id_idx on public.audit_log(created_at desc,id desc);

create or replace function private.capture_access_change_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  old_doc jsonb := '{}'::jsonb;
  new_doc jsonb := '{}'::jsonb;
  before_doc jsonb := '{}'::jsonb;
  after_doc jsonb := '{}'::jsonb;
  field_name text;
  fields text[];
  target_doc jsonb;
begin
  if TG_OP <> 'INSERT' then old_doc := to_jsonb(OLD); end if;
  if TG_OP <> 'DELETE' then new_doc := to_jsonb(NEW); end if;
  -- Explicit allowlist: never persist profile tokens, password, phone or email.
  fields := case TG_TABLE_NAME
    when 'profiles' then array['is_admin','is_security_admin','is_active','account_status','can_broadcast','is_hidden','mfa_enrollment_required','mfa_method','locked_until']
    when 'user_groups' then array['name','display_name','is_system','is_public','permissions']
    else array['group_id','user_id','added_by'] end;
  foreach field_name in array fields loop
    if (old_doc->field_name) is distinct from (new_doc->field_name) then
      before_doc := before_doc || jsonb_build_object(field_name,old_doc->field_name);
      after_doc := after_doc || jsonb_build_object(field_name,new_doc->field_name);
    end if;
  end loop;
  if before_doc = '{}'::jsonb then return null; end if;
  target_doc := case when TG_OP='DELETE' then old_doc else new_doc end;
  insert into public.security_audit_events(actor_user_id,target_user_id,event_type,event_category,severity,result,before_state,after_state,metadata)
  values(auth.uid(),case when TG_TABLE_NAME in ('profiles','user_group_members') then (target_doc->>'user_id')::uuid else null end,
    TG_TABLE_NAME||'.'||lower(TG_OP),'access','warning','success',
    public.sanitize_audit_metadata(before_doc),public.sanitize_audit_metadata(after_doc),
    jsonb_build_object('source','database_trigger','table',TG_TABLE_NAME,'entity_id',target_doc->>'id','actor_context',case when auth.uid() is null then 'service_or_database' else 'user_session' end));
  return null;
end $$;
revoke all on function private.capture_access_change_v1() from public,anon,authenticated;
create trigger audit_access_change_v1 after insert or update or delete on public.profiles for each row execute function private.capture_access_change_v1();
create trigger audit_access_change_v1 after insert or update or delete on public.user_groups for each row execute function private.capture_access_change_v1();
create trigger audit_access_change_v1 after insert or update or delete on public.user_group_members for each row execute function private.capture_access_change_v1();

-- Called only by Edge code after validating identity; never accept an actor from a browser payload.
create or replace function public.record_access_denial_service_v1(p_actor uuid,p_resource text,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_actor is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||left(p_resource,100)||left(p_code,80),0));
  -- Bound repeated attempts without hiding them: aggregate a 30-second burst.
  update public.security_audit_events set metadata=jsonb_set(metadata,'{attempt_count}',to_jsonb(coalesce((metadata->>'attempt_count')::integer,1)+1)) || jsonb_build_object('last_seen_at',clock_timestamp())
  where id=(select id from public.security_audit_events where actor_user_id=p_actor and event_type='access.denied'
    and metadata->>'resource'=left(p_resource,100) and error_code=left(p_code,80)
    and created_at>clock_timestamp()-interval '30 seconds' order by created_at desc limit 1);
  if not found then
    insert into public.security_audit_events(actor_user_id,event_type,event_category,severity,result,error_code,request_id,metadata)
    values(p_actor,'access.denied','access','warning','denied',left(p_code,80),gen_random_uuid(),
      jsonb_build_object('source','edge_authorization','resource',left(p_resource,100),'attempt_count',1,'last_seen_at',clock_timestamp()));
  end if;
end $$;
revoke all on function public.record_access_denial_service_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_access_denial_service_v1(uuid,text,text) to service_role;

create or replace function private.get_event_center_v1(
  p_from timestamptz default null,p_to timestamptz default null,p_source text default null,
  p_severity text default null,p_result text default null,p_search text default null,
  p_before_time timestamptz default null,p_before_key text default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  rows_json jsonb;
  more_rows boolean;
  from_time timestamptz := coalesce(p_from,now()-interval '7 days');
  to_time timestamptz := coalesce(p_to,now());
  search_text text := nullif(btrim(p_search),'');
begin
  if not (private.current_user_has_permission_v1('config_users.group_events')
    or private.current_user_has_permission_v1('config_audit.audit_log')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or to_time<from_time or to_time-from_time>interval '93 days'
    or (p_before_time is null)<>(p_before_key is null) or length(coalesce(search_text,''))>200
    or (p_source is not null and p_source not in ('application','security')) then
    raise exception 'INVALID_FILTER' using errcode='22023';
  end if;
  with combined as (
    select 'application:'||a.id::text event_key,a.id,a.created_at,'application'::text source,
      a.action event_type,coalesce(a.module,'application') category,a.severity,null::text result,
      a.user_id actor_user_id,a.user_name actor_name,null::uuid target_user_id,
      a.ip_address,null::text ip_hash,null::uuid session_id,null::uuid request_id,null::text error_code,
      jsonb_build_object('entity_name',a.entity_name,'entity_id',a.entity_id,
        'details',left(a.details,4000),'user_agent',left(a.user_agent,512),
        'url',split_part(split_part(a.url,'?',1),'#',1),'referrer',split_part(split_part(a.referrer,'?',1),'#',1)) metadata,
      null::jsonb before_state,null::jsonb after_state
    from public.audit_log a where a.created_at>=from_time and a.created_at<=to_time and (p_source is null or p_source='application')
    union all
    select 'security:'||e.id::text,e.id,e.created_at,'security',e.event_type,e.event_category,e.severity,e.result,
      coalesce(e.actor_user_id,e.user_id),p.full_name,e.target_user_id,e.ip_address,e.ip_hash,e.session_id,e.request_id,e.error_code,
      public.sanitize_audit_metadata(e.metadata),public.sanitize_audit_metadata(e.before_state),public.sanitize_audit_metadata(e.after_state)
    from public.security_audit_events e left join public.profiles p on p.user_id=coalesce(e.actor_user_id,e.user_id)
    where e.created_at>=from_time and e.created_at<=to_time and (p_source is null or p_source='security')
  ), filtered as (
    select * from combined c where (p_severity is null or c.severity=p_severity)
      and (p_result is null or c.result=p_result)
      and (search_text is null or strpos(lower(concat_ws(' ',c.event_type,c.category,c.actor_name,c.actor_user_id::text,
        c.target_user_id::text,c.request_id::text,c.session_id::text,c.ip_address,c.ip_hash,c.error_code,c.metadata::text)),lower(search_text))>0)
      and (p_before_time is null or (c.created_at,c.event_key)<(p_before_time,p_before_key))
    order by c.created_at desc,c.event_key desc limit p_limit+1
  ), page as (select * from filtered order by created_at desc,event_key desc limit p_limit)
  select coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,event_key desc) from page),'[]'::jsonb),
    (select count(*)>p_limit from filtered) into rows_json,more_rows;
  return jsonb_build_object('events',rows_json,'has_more',more_rows,
    'next_cursor',case when more_rows then jsonb_build_object('time',rows_json->-1->>'created_at','key',rows_json->-1->>'event_key') else null end);
end $$;
revoke all on function private.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer) from public,anon,authenticated;

create or replace function public.get_event_center_v1(
  p_from timestamptz default null,p_to timestamptz default null,p_source text default null,
  p_severity text default null,p_result text default null,p_search text default null,
  p_before_time timestamptz default null,p_before_key text default null,p_limit integer default 50)
returns jsonb language sql security definer set search_path='' as $$
  select private.get_event_center_v1(p_from,p_to,p_source,p_severity,p_result,p_search,p_before_time,p_before_key,p_limit);
$$;
revoke all on function public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer) from public,anon;
grant execute on function public.get_event_center_v1(timestamptz,timestamptz,text,text,text,text,timestamptz,text,integer) to authenticated;
