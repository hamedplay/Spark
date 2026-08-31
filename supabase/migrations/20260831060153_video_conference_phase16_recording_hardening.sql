
alter table public.conference_rooms
  add column if not exists recording_consent_required boolean not null default true;

alter table public.conference_recordings
  add column if not exists provider_status integer,
  add column if not exists last_webhook_event_id text,
  add column if not exists reconciled_at timestamptz,
  add column if not exists consent_policy_version integer not null default 1;

update public.conference_recordings
set status = case
  when status = 'ready' then 'completed'
  when status = 'cancelled' then 'failed'
  else status
end
where status in ('ready','cancelled');

alter table public.conference_recordings
  drop constraint if exists conference_recordings_status_check;

alter table public.conference_recordings
  add constraint conference_recordings_status_check
  check (status in ('queued','starting','recording','stopping','processing','completed','failed'));

alter table public.conference_recordings
  drop constraint if exists conference_recordings_provider_status_check;

alter table public.conference_recordings
  add constraint conference_recordings_provider_status_check
  check (provider_status is null or provider_status between 0 and 6);

drop index if exists public.conference_recordings_active_room_uidx;
create unique index conference_recordings_active_room_uidx
  on public.conference_recordings(room_id)
  where status in ('queued','starting','recording','stopping','processing');

create table if not exists public.conference_recording_consents (
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  user_id uuid not null,
  status text not null check (status in ('accepted','declined')),
  policy_version integer not null default 1 check (policy_version > 0),
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id,user_id)
);

alter table public.conference_recording_consents enable row level security;
revoke all on table public.conference_recording_consents from anon, authenticated;
grant all on table public.conference_recording_consents to service_role;

alter table public.conference_recordings enable row level security;
revoke insert, update, delete, truncate, references, trigger
  on table public.conference_recordings from anon, authenticated;
revoke all on table public.conference_recordings from anon;
grant select on table public.conference_recordings to authenticated;

alter table public.livekit_webhook_events enable row level security;
revoke all on table public.livekit_webhook_events from anon, authenticated;
grant all on table public.livekit_webhook_events to service_role;

create or replace function private.recording_status_rank(p_status text)
returns integer
language sql
immutable
set search_path=''
as $$
  select case p_status
    when 'queued' then 0
    when 'starting' then 10
    when 'recording' then 20
    when 'stopping' then 30
    when 'processing' then 40
    when 'completed' then 100
    when 'failed' then 100
    else -1
  end
$$;

create or replace function private.livekit_ns_to_timestamptz(p_value text)
returns timestamptz
language plpgsql
stable
set search_path=''
as $$
declare
  v numeric;
begin
  if nullif(p_value,'') is null then return null; end if;
  begin
    v := p_value::numeric;
  exception when others then
    return null;
  end;
  if v <= 0 then return null; end if;
  if v > 1000000000000 then
    return to_timestamp((v / 1000000000)::double precision);
  end if;
  return to_timestamp(v::double precision);
end;
$$;

create or replace function private.apply_livekit_recording_state(
  p_room_name text,
  p_egress_id text,
  p_provider_status integer,
  p_payload jsonb,
  p_event_id text default null,
  p_source text default 'reconcile'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room_id uuid;
  v_recording_id uuid;
  v_current_status text;
  v_next_status text;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_duration_seconds integer;
  v_size_bytes bigint;
  v_storage_path text;
  v_error text;
begin
  select id into v_room_id
  from public.conference_rooms
  where livekit_room_name = coalesce(
    nullif(p_room_name,''),
    nullif(p_payload #>> '{egressInfo,roomName}','')
  )
  limit 1;

  if v_room_id is null or nullif(p_egress_id,'') is null then
    return jsonb_build_object('ok',true,'ignored',true,'reason','room_or_egress_missing');
  end if;

  select id,status into v_recording_id,v_current_status
  from public.conference_recordings
  where room_id=v_room_id and provider_egress_id=p_egress_id
  order by created_at desc
  limit 1
  for update;

  if v_recording_id is null then
    select id,status into v_recording_id,v_current_status
    from public.conference_recordings
    where room_id=v_room_id
      and provider_egress_id is null
      and status in ('queued','starting')
      and created_at >= now() - interval '10 minutes'
    order by created_at desc
    limit 1
    for update;

    if v_recording_id is not null then
      update public.conference_recordings
      set provider_egress_id=p_egress_id, updated_at=now()
      where id=v_recording_id and provider_egress_id is null;
    end if;
  end if;

  if v_recording_id is null then
    return jsonb_build_object('ok',true,'ignored',true,'reason','recording_not_found','room_id',v_room_id);
  end if;

  v_next_status := case p_provider_status
    when 0 then 'starting'
    when 1 then 'recording'
    when 2 then 'processing'
    when 3 then 'completed'
    when 4 then 'failed'
    when 5 then 'failed'
    when 6 then 'failed'
    else v_current_status
  end;

  v_started_at := private.livekit_ns_to_timestamptz(p_payload #>> '{egressInfo,startedAt}');
  v_ended_at := private.livekit_ns_to_timestamptz(p_payload #>> '{egressInfo,endedAt}');
  v_storage_path := nullif(p_payload #>> '{egressInfo,fileResults,0,filename}','');
  v_error := nullif(left(coalesce(p_payload #>> '{egressInfo,error}',''),500),'');

  begin
    v_duration_seconds := round(
      nullif(p_payload #>> '{egressInfo,fileResults,0,duration}','')::numeric / 1000000000
    )::integer;
  exception when others then
    v_duration_seconds := null;
  end;

  begin
    v_size_bytes := nullif(p_payload #>> '{egressInfo,fileResults,0,size}','')::bigint;
  exception when others then
    v_size_bytes := null;
  end;

  update public.conference_recordings r
  set
    provider_egress_id = coalesce(r.provider_egress_id,p_egress_id),
    provider_status = coalesce(p_provider_status,r.provider_status),
    status = case
      when r.status in ('completed','failed') then r.status
      when private.recording_status_rank(v_next_status) >= private.recording_status_rank(r.status) then v_next_status
      else r.status
    end,
    started_at = coalesce(r.started_at,v_started_at),
    ended_at = case
      when v_next_status in ('completed','failed')
        then coalesce(r.ended_at,v_ended_at,now())
      else r.ended_at
    end,
    duration_seconds = coalesce(v_duration_seconds,r.duration_seconds),
    size_bytes = coalesce(v_size_bytes,r.size_bytes),
    storage_path = coalesce(v_storage_path,r.storage_path),
    error_message = case
      when v_next_status='failed' then coalesce(v_error,r.error_message,'LIVEKIT_EGRESS_FAILED')
      when v_next_status in ('recording','processing','completed') then null
      else r.error_message
    end,
    last_webhook_event_id = case
      when p_source='webhook' then coalesce(p_event_id,r.last_webhook_event_id)
      else r.last_webhook_event_id
    end,
    reconciled_at = case
      when p_source='reconcile' then now()
      else r.reconciled_at
    end,
    updated_at = now()
  where r.id=v_recording_id;

  return jsonb_build_object(
    'ok',true,
    'room_id',v_room_id,
    'recording_id',v_recording_id,
    'egress_id',p_egress_id,
    'provider_status',p_provider_status,
    'status',(select status from public.conference_recordings where id=v_recording_id)
  );
end;
$$;

create or replace function private.get_conference_recording_consent_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.conference_rooms%rowtype;
  v_status text;
  v_allowed boolean := false;
  v_join jsonb;
  v_active boolean := false;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room from public.conference_rooms where id=p_room_id;
  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  v_allowed := v_room.host_id=v_uid
    or exists(
      select 1 from public.conference_participants
      where room_id=p_room_id and user_id=v_uid
    );

  if not v_allowed then
    v_join := private.check_conference_join(p_room_id);
    v_allowed := coalesce((v_join->>'allowed')::boolean,false);
  end if;

  if not v_allowed then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select status into v_status
  from public.conference_recording_consents
  where room_id=p_room_id and user_id=v_uid;

  select exists(
    select 1 from public.conference_recordings
    where room_id=p_room_id
      and status in ('queued','starting','recording','stopping','processing')
  ) into v_active;

  return jsonb_build_object(
    'ok',true,
    'required',coalesce(v_room.record_enabled,false) and coalesce(v_room.recording_consent_required,true),
    'recordingEnabled',coalesce(v_room.record_enabled,false),
    'myStatus',coalesce(v_status,'pending'),
    'accepted',v_status='accepted',
    'recordingActive',v_active,
    'policyVersion',1
  );
end;
$$;

create or replace function private.set_conference_recording_consent(
  p_room_id uuid,
  p_consented boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid := auth.uid();
  v_room public.conference_rooms%rowtype;
  v_allowed boolean := false;
  v_join jsonb;
  v_status text;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room from public.conference_rooms where id=p_room_id;
  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  v_allowed := v_room.host_id=v_uid
    or exists(
      select 1 from public.conference_participants
      where room_id=p_room_id and user_id=v_uid
    );

  if not v_allowed then
    v_join := private.check_conference_join(p_room_id);
    v_allowed := coalesce((v_join->>'allowed')::boolean,false);
  end if;

  if not v_allowed then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  v_status := case when coalesce(p_consented,false) then 'accepted' else 'declined' end;

  insert into public.conference_recording_consents(
    room_id,user_id,status,policy_version,decided_at,updated_at
  )
  values(p_room_id,v_uid,v_status,1,now(),now())
  on conflict(room_id,user_id) do update
    set status=excluded.status,
        policy_version=excluded.policy_version,
        decided_at=now(),
        updated_at=now();

  return jsonb_build_object(
    'ok',true,
    'roomId',p_room_id,
    'userId',v_uid,
    'status',v_status,
    'accepted',v_status='accepted',
    'policyVersion',1
  );
end;
$$;

create or replace function public.get_conference_recording_consent_state(p_room_id uuid)
returns jsonb
language sql
stable
set search_path=''
as $$
  select private.get_conference_recording_consent_state(p_room_id)
$$;

create or replace function public.set_conference_recording_consent(p_room_id uuid,p_consented boolean)
returns jsonb
language sql
set search_path=''
as $$
  select private.set_conference_recording_consent(p_room_id,p_consented)
$$;

revoke all on function public.get_conference_recording_consent_state(uuid) from public,anon;
revoke all on function public.set_conference_recording_consent(uuid,boolean) from public,anon;
grant execute on function public.get_conference_recording_consent_state(uuid) to authenticated;
grant execute on function public.set_conference_recording_consent(uuid,boolean) to authenticated;

create or replace function private.authorize_livekit_recording(p_room_id uuid,p_action text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.conference_rooms%rowtype;
  v_permission text;
  v_role text;
  v_missing_consent integer := 0;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room from public.conference_rooms where id=p_room_id;
  if not found or v_room.media_topology<>'sfu' or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;
  if v_room.status='ended' then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;
  if not coalesce(v_room.record_enabled,false) then
    return jsonb_build_object('ok',false,'reason','recording_disabled');
  end if;

  v_permission:=case p_action
    when 'start' then 'START_RECORDING'
    when 'stop' then 'STOP_RECORDING'
    else null
  end;

  if v_permission is null
     or not private.has_conference_permission(p_room_id,v_permission,v_uid) then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  if p_action='start' and coalesce(v_room.recording_consent_required,true) then
    select count(*) into v_missing_consent
    from (
      select v_room.host_id as user_id
      union
      select user_id from public.conference_participants
      where room_id=p_room_id and status='joined'
    ) actors
    left join public.conference_recording_consents c
      on c.room_id=p_room_id
     and c.user_id=actors.user_id
     and c.status='accepted'
     and c.policy_version=1
    where c.user_id is null;

    if v_missing_consent > 0 then
      return jsonb_build_object(
        'ok',false,
        'reason','recording_consent_required',
        'missing_consent_count',v_missing_consent
      );
    end if;
  end if;

  v_role:=private.conference_effective_role(p_room_id,v_uid);
  return jsonb_build_object(
    'ok',true,
    'room_id',v_room.id,
    'meeting_id',v_room.meeting_id,
    'livekit_room_name',v_room.livekit_room_name,
    'role',v_role,
    'permission',v_permission,
    'recording_consent_required',coalesce(v_room.recording_consent_required,true),
    'consent_policy_version',1
  );
end;
$$;

create or replace function public.apply_livekit_recording_reconcile_v1(
  p_room_name text,
  p_egress_id text,
  p_provider_status integer,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select private.apply_livekit_recording_state(
    p_room_name,p_egress_id,p_provider_status,p_payload,null,'reconcile'
  )
$$;

revoke all on function public.apply_livekit_recording_reconcile_v1(text,text,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_livekit_recording_reconcile_v1(text,text,integer,jsonb)
  to service_role;

create or replace function private.apply_livekit_webhook_event(
  p_event_type text,
  p_event_id text,
  p_room_name text,
  p_participant_identity text,
  p_egress_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room_id uuid;
  v_user_id uuid;
  v_row_id uuid;
  v_egress_status integer;
  v_recording_result jsonb;
begin
  insert into public.livekit_webhook_events(
    event_type,event_id,room_name,participant_identity,egress_id,payload
  )
  values(
    p_event_type,p_event_id,p_room_name,p_participant_identity,p_egress_id,coalesce(p_payload,'{}'::jsonb)
  )
  on conflict(event_id) where event_id is not null do nothing
  returning id into v_row_id;

  if v_row_id is null and p_event_id is not null then
    return jsonb_build_object('ok',true,'duplicate',true);
  end if;

  select id into v_room_id
  from public.conference_rooms
  where livekit_room_name=coalesce(
    nullif(p_room_name,''),
    nullif(p_payload #>> '{egressInfo,roomName}','')
  )
  limit 1;

  if p_participant_identity is not null then
    begin
      v_user_id := p_participant_identity::uuid;
    exception when others then
      v_user_id := null;
    end;
  end if;

  if v_room_id is not null then
    if p_event_type='room_started' then
      update public.conference_rooms
      set status='active'
      where id=v_room_id and status<>'ended';
    elsif p_event_type='room_finished' then
      update public.conference_rooms
      set status='ended',
          ended_at=coalesce(ended_at,now()),
          ended_reason=coalesce(ended_reason,'livekit_room_finished')
      where id=v_room_id;

      update public.conference_participants
      set status='left',
          left_at=coalesce(left_at,now()),
          last_seen=now()
      where room_id=v_room_id and status='joined';
    elsif p_event_type='participant_joined' and v_user_id is not null then
      update public.conference_participants
      set status='joined',
          joined_at=coalesce(joined_at,now()),
          left_at=null,
          last_seen=now()
      where room_id=v_room_id and user_id=v_user_id;
    elsif p_event_type='participant_left' and v_user_id is not null then
      update public.conference_participants
      set status='left',
          left_at=now(),
          last_seen=now()
      where room_id=v_room_id and user_id=v_user_id;
    end if;
  end if;

  if p_event_type in ('egress_started','egress_updated','egress_ended')
     and nullif(p_egress_id,'') is not null then
    begin
      v_egress_status := nullif(p_payload #>> '{egressInfo,status}','')::integer;
    exception when others then
      v_egress_status := null;
    end;

    v_recording_result := private.apply_livekit_recording_state(
      p_room_name,
      p_egress_id,
      v_egress_status,
      p_payload,
      p_event_id,
      'webhook'
    );
  end if;

  update public.livekit_webhook_events
  set processed_at=now(),processing_error=null
  where id=v_row_id;

  return jsonb_build_object(
    'ok',true,
    'room_id',v_room_id,
    'recording',v_recording_result
  );
exception when others then
  if v_row_id is not null then
    update public.livekit_webhook_events
    set processing_error=left(sqlerrm,500),processed_at=now()
    where id=v_row_id;
  end if;
  raise;
end;
$$;

create or replace function public.apply_livekit_webhook_event_v1(
  p_event_type text,
  p_event_id text,
  p_room_name text,
  p_participant_identity text,
  p_egress_id text,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path=''
as $$
  select private.apply_livekit_webhook_event(
    p_event_type,p_event_id,p_room_name,p_participant_identity,p_egress_id,p_payload
  )
$$;

revoke all on function public.apply_livekit_webhook_event_v1(text,text,text,text,text,jsonb)
  from public,anon,authenticated;
grant execute on function public.apply_livekit_webhook_event_v1(text,text,text,text,text,jsonb)
  to service_role;
