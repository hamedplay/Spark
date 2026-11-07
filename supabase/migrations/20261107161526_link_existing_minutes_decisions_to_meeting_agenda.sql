-- New migration for meeting-agenda structured decision linking.
-- Applied to connected non-production Spark database as 20261107161526.
-- Do not synthesize formal minute/decision reference numbers for historic rows.
alter table public.minutes add column if not exists official_number text;
alter table public.minutes_decisions add column if not exists official_number text;
alter table public.meeting_agenda_items add column if not exists source_decision_id uuid references public.minutes_decisions(id) on delete restrict;
alter table public.minutes_agenda_results add column if not exists source_decision_id uuid references public.minutes_decisions(id) on delete restrict;
create unique index if not exists meeting_agenda_one_source_per_meeting_idx on public.meeting_agenda_items(meeting_id,source_decision_id) where source_decision_id is not null;
create index if not exists minutes_agenda_results_source_decision_idx on public.minutes_agenda_results(source_decision_id) where source_decision_id is not null;
create unique index if not exists minutes_decisions_official_number_idx on public.minutes_decisions(minute_id,official_number) where official_number is not null;
create unique index if not exists minutes_official_number_idx on public.minutes(official_number) where official_number is not null;

CREATE OR REPLACE FUNCTION private.agenda_validate_source_decision_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_source_minute uuid;
declare v_source_meeting uuid;
begin
  if new.source_decision_id is null or
     (tg_op='UPDATE' and new.source_decision_id is not distinct from old.source_decision_id)
  then return new; end if;
  if auth.uid() is null or not private.is_current_session_fully_authorized() then
    raise exception 'AGENDA_NOT_AUTHORIZED' using errcode='42501';
  end if;
  select d.minute_id,m.meeting_id into v_source_minute,v_source_meeting
  from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
  where d.id=new.source_decision_id and m.status='published' and m.published_at is not null;
  if v_source_minute is null or not private._user_can_view_minute(v_source_minute) then
    raise exception 'SOURCE_DECISION_NOT_AVAILABLE' using errcode='42501';
  end if;
  if new.meeting_id=v_source_meeting then
    raise exception 'CANNOT_LINK_DECISION_TO_ORIGINAL_MEETING' using errcode='23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists agenda_validate_source_decision_v1 on public.meeting_agenda_items;
create trigger agenda_validate_source_decision_v1 before insert or update of source_decision_id
on public.meeting_agenda_items for each row execute function private.agenda_validate_source_decision_v1();

CREATE OR REPLACE FUNCTION private.minutes_agenda_source_snapshot_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_source uuid;
begin
  if new.meeting_agenda_item_id is null then
    if tg_op='INSERT' and new.source_decision_id is not null then
      raise exception 'UNLINKED_AGENDA_SOURCE_NOT_ALLOWED' using errcode='23514';
    end if;
    if tg_op='UPDATE' and new.source_decision_id is distinct from old.source_decision_id then
      raise exception 'SOURCE_SNAPSHOT_IMMUTABLE' using errcode='23514';
    end if;
    return new;
  end if;
  select a.source_decision_id into v_source from public.meeting_agenda_items a
  where a.id=new.meeting_agenda_item_id
    and a.meeting_id=(select m.meeting_id from public.minutes m where m.id=new.minute_id);
  if not found then raise exception 'AGENDA_SOURCE_MEETING_MISMATCH' using errcode='23514'; end if;
  new.source_decision_id := v_source;
  return new;
end;
$function$;

drop trigger if exists minutes_agenda_source_snapshot_v1 on public.minutes_agenda_results;
create trigger minutes_agenda_source_snapshot_v1 before insert or update of meeting_agenda_item_id,source_decision_id
on public.minutes_agenda_results for each row execute function private.minutes_agenda_source_snapshot_v1();

CREATE OR REPLACE FUNCTION private.pick_meeting_agenda_decisions_v1(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_owner_user_id uuid DEFAULT NULL::uuid, p_date_from text DEFAULT NULL::text, p_date_to text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.is_current_session_fully_authorized() then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0
    or length(coalesce(p_search,''))>180 then
    raise exception 'INVALID_PAGINATION_OR_SEARCH' using errcode='22023';
  end if;
  with scoped as (
    select d.id, d.minute_id, d.parent_decision_id, d.clause_order,
      d.title, d.description, d.official_number as decision_number,
      m.official_number as minute_number,m.meeting_title_snapshot as minute_title,
      m.meeting_date_snapshot as meeting_date,d.status,d.priority,
      d.primary_owner_user_id,d.responsible_unit_name_snapshot,d.progress_percent,
      coalesce(p.full_name,p.username,'') as owner_name
    from public.minutes_decisions d
    join public.minutes m on m.id=d.minute_id
    left join public.profiles_public p on p.user_id=d.primary_owner_user_id
    where m.status='published' and m.published_at is not null
      and private._user_can_view_minute(m.id)
      and (d.parent_decision_id is not null or not exists (
        select 1 from public.minutes_decisions child where child.parent_decision_id=d.id
      ))
      and (p_status is null or p_status='' or d.status=p_status)
      and (p_owner_user_id is null or d.primary_owner_user_id=p_owner_user_id)
      and (p_date_from is null or m.meeting_date_snapshot >= p_date_from)
      and (p_date_to is null or m.meeting_date_snapshot <= p_date_to)
      and (p_search is null or btrim(p_search)='' or
        d.title ilike '%'||p_search||'%' or
        m.meeting_title_snapshot ilike '%'||p_search||'%' or
        m.meeting_date_snapshot ilike '%'||p_search||'%' or
        coalesce(m.official_number,'') ilike '%'||p_search||'%' or
        coalesce(d.official_number,'') ilike '%'||p_search||'%' or
        coalesce(p.full_name,p.username,'') ilike '%'||p_search||'%'
        or (d.clause_order is not null and d.clause_order::text=p_search)
      )
  ),paged as (
    select * from scoped order by minute_id,id limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from scoped),
    'items',coalesce((select jsonb_agg(to_jsonb(paged)) from paged),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pick_meeting_agenda_decisions_v1(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_owner_user_id uuid DEFAULT NULL::uuid, p_date_from text DEFAULT NULL::text, p_date_to text DEFAULT NULL::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
select private.pick_meeting_agenda_decisions_v1(p_search,p_status,p_owner_user_id,p_date_from,p_date_to,p_limit,p_offset);
$function$;

CREATE OR REPLACE FUNCTION private.get_linked_agenda_decision_v1(p_decision_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not private.is_current_session_fully_authorized() then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  select jsonb_build_object(
     'id',d.id,'title',d.title,'description',d.description,'status',d.status,
     'progress_percent',d.progress_percent,'minute_id',m.id,'minute_title',m.meeting_title_snapshot,
     'minute_date',m.meeting_date_snapshot,'minute_number',m.official_number,
     'decision_number',d.official_number,'clause_order',d.clause_order,
     'owner_name',coalesce(p.full_name,p.username,''),
     'updates',coalesce((select jsonb_agg(jsonb_build_object(
         'created_at',u.created_at,'event_type',u.event_type,'update_text',u.update_text,
         'new_status',u.new_status) order by u.created_at desc)
       from (select created_at,event_type,update_text,new_status from public.minutes_decision_updates
             where decision_id=d.id order by created_at desc limit 40) u),'[]'::jsonb)
   ) into v_result
  from public.minutes_decisions d
  join public.minutes m on m.id=d.minute_id
  left join public.profiles_public p on p.user_id=d.primary_owner_user_id
  where d.id=p_decision_id and m.status='published' and m.published_at is not null
    and private._user_can_view_minute(m.id);
  if v_result is null then raise exception 'DECISION_NOT_VISIBLE' using errcode='42501'; end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_linked_agenda_decision_v1(p_decision_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$select private.get_linked_agenda_decision_v1(p_decision_id);$function$;

CREATE OR REPLACE FUNCTION private.sync_linked_meeting_agenda_v1(p_meeting_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid:=auth.uid();
  v_item jsonb;
  v_id uuid;
  v_source uuid;
  v_seen uuid[]:='{}'::uuid[];
  v_sources uuid[]:='{}'::uuid[];
  v_index integer:=0;
  v_existing_meeting uuid;
begin
  if v_user is null or not private.is_current_session_fully_authorized() then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>100 then
    raise exception 'INVALID_AGENDA_ITEMS' using errcode='22023';
  end if;
  perform 1 from public.meetings m where m.id=p_meeting_id and
    (m.user_id=v_user or private.is_current_user_admin()) for update;
  if not found then raise exception 'MEETING_NOT_EDITABLE' using errcode='42501'; end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item)<>'object' or length(btrim(coalesce(v_item->>'title','')))=0
       or length(v_item->>'title')>2000 then
      raise exception 'INVALID_AGENDA_ITEM_TITLE' using errcode='22023';
    end if;
    v_id:=coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid());
    v_source:=nullif(v_item->>'source_decision_id','')::uuid;
    if v_id=any(v_seen) or (v_source is not null and v_source=any(v_sources)) then
      raise exception 'DUPLICATE_AGENDA_ITEM_OR_DECISION' using errcode='23505';
    end if;
    v_seen:=array_append(v_seen,v_id);
    if v_source is not null then v_sources:=array_append(v_sources,v_source); end if;
    select meeting_id into v_existing_meeting from public.meeting_agenda_items where id=v_id;
    if found and v_existing_meeting<>p_meeting_id then
      raise exception 'AGENDA_ID_BELONGS_TO_OTHER_MEETING' using errcode='42501';
    end if;
  end loop;
  delete from public.meeting_agenda_items a where a.meeting_id=p_meeting_id
    and not (a.id=any(v_seen));

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_id:=coalesce(nullif(v_item->>'id','')::uuid,gen_random_uuid());
    v_source:=nullif(v_item->>'source_decision_id','')::uuid;
    insert into public.meeting_agenda_items (
      id,meeting_id,title,presenter,duration_minutes,description,sort_order,source_decision_id
    ) values (
      v_id,p_meeting_id,btrim(v_item->>'title'),nullif(v_item->>'presenter',''),
      nullif(v_item->>'duration_minutes','')::integer,nullif(v_item->>'description',''),v_index,v_source
    )
    on conflict(id) do update set
      title=excluded.title,presenter=excluded.presenter,duration_minutes=excluded.duration_minutes,
      description=excluded.description,sort_order=excluded.sort_order,
      source_decision_id=excluded.source_decision_id
    where public.meeting_agenda_items.meeting_id=p_meeting_id;
    v_index:=v_index+1;
  end loop;
  return v_index;
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_linked_meeting_agenda_v1(p_meeting_id uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.sync_linked_meeting_agenda_v1(p_meeting_id,p_items);$function$;

CREATE OR REPLACE FUNCTION private.record_linked_agenda_followup_v1(p_agenda_result_id uuid, p_report_text text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_decision uuid;
declare v_meeting uuid;
declare v_minute uuid;
declare v_updated timestamptz;
declare v_out jsonb;
begin
  if auth.uid() is null or not private.is_current_session_fully_authorized() then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  if length(btrim(coalesce(p_report_text,'')))<3 or length(p_report_text)>4000 then
    raise exception 'REPORT_TEXT_REQUIRED' using errcode='22023';
  end if;
  select a.source_decision_id,m.meeting_id,m.id into v_decision,v_meeting,v_minute
    from public.minutes_agenda_results a join public.minutes m on m.id=a.minute_id
    where a.id=p_agenda_result_id and m.status='published' and m.published_at is not null
      and private._user_can_view_minute(m.id);
  if v_decision is null then raise exception 'PUBLISHED_LINKED_AGENDA_NOT_AVAILABLE' using errcode='42501'; end if;
  select updated_at into v_updated from public.minutes_decisions where id=v_decision;
  select private.manage_minutes_decision(v_decision,v_updated,'followup',null,'نتیجه بررسی در جلسه بعدی',
    btrim(p_report_text),jsonb_build_object('source','linked_agenda','meeting_id',v_meeting,
    'minute_id',v_minute,'agenda_result_id',p_agenda_result_id),null,null)
    into v_out;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_linked_agenda_followup_v1(p_agenda_result_id uuid, p_report_text text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$select private.record_linked_agenda_followup_v1(p_agenda_result_id,p_report_text);$function$;

revoke all on function private.agenda_validate_source_decision_v1() from public,anon,authenticated;

revoke all on function private.minutes_agenda_source_snapshot_v1() from public,anon,authenticated;

revoke all on function private.pick_meeting_agenda_decisions_v1(text,text,uuid,text,text,integer,integer) from public,anon,authenticated;

revoke all on function public.pick_meeting_agenda_decisions_v1(text,text,uuid,text,text,integer,integer) from public,anon,authenticated;

revoke all on function private.get_linked_agenda_decision_v1(uuid) from public,anon,authenticated;

revoke all on function public.get_linked_agenda_decision_v1(uuid) from public,anon,authenticated;

revoke all on function private.sync_linked_meeting_agenda_v1(uuid,jsonb) from public,anon,authenticated;

revoke all on function public.sync_linked_meeting_agenda_v1(uuid,jsonb) from public,anon,authenticated;

revoke all on function private.record_linked_agenda_followup_v1(uuid,text) from public,anon,authenticated;

revoke all on function public.record_linked_agenda_followup_v1(uuid,text) from public,anon,authenticated;

grant execute on function public.pick_meeting_agenda_decisions_v1(text,text,uuid,text,text,integer,integer) to authenticated;

grant execute on function public.get_linked_agenda_decision_v1(uuid) to authenticated;

grant execute on function public.sync_linked_meeting_agenda_v1(uuid,jsonb) to authenticated;

grant execute on function public.record_linked_agenda_followup_v1(uuid,text) to authenticated;

notify pgrst,'reload schema';
