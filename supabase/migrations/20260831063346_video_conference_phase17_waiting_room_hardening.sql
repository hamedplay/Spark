
alter table public.conference_waiting_room
  add column if not exists expires_at timestamptz;

update public.conference_waiting_room
set requested_at=coalesce(requested_at,now());

update public.conference_waiting_room
set expires_at=coalesce(expires_at,requested_at + interval '5 minutes');

alter table public.conference_waiting_room
  alter column requested_at set not null,
  alter column expires_at set default (now() + interval '5 minutes'),
  alter column expires_at set not null;

update public.conference_waiting_room
set status='expired',
    resolved_at=coalesce(resolved_at,now())
where status='waiting'
  and expires_at<=now();

with ranked as (
  select id,
         row_number() over(
           partition by room_id,user_id
           order by requested_at desc,id desc
         ) as rn
  from public.conference_waiting_room
)
delete from public.conference_waiting_room w
using ranked r
where w.id=r.id and r.rn>1;

alter table public.conference_waiting_room
  drop constraint if exists conference_waiting_room_status_check;

alter table public.conference_waiting_room
  add constraint conference_waiting_room_status_check
  check (status in ('waiting','admitted','rejected','expired'));

alter table public.conference_waiting_room
  drop constraint if exists conference_waiting_room_room_user_key;

alter table public.conference_waiting_room
  add constraint conference_waiting_room_room_user_key
  unique(room_id,user_id);

drop index if exists public.idx_conf_waiting_room;
create index idx_conf_waiting_room
  on public.conference_waiting_room(room_id,status,expires_at,requested_at);

alter table public.conference_waiting_room enable row level security;

revoke insert,update,delete,truncate,references,trigger
  on table public.conference_waiting_room
  from anon,authenticated;

revoke all on table public.conference_waiting_room from anon;
grant select on table public.conference_waiting_room to authenticated;
grant all on table public.conference_waiting_room to service_role;

drop policy if exists "RBAC managers can update waiting room"
  on public.conference_waiting_room;
drop policy if exists delete_waiting_authenticated
  on public.conference_waiting_room;

create or replace function private.get_livekit_waiting_room_state(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_row public.conference_waiting_room%rowtype;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  update public.conference_waiting_room
  set status='expired',
      resolved_at=coalesce(resolved_at,now())
  where room_id=p_room_id
    and user_id=v_uid
    and status='waiting'
    and expires_at<=now();

  select * into v_row
  from public.conference_waiting_room
  where room_id=p_room_id and user_id=v_uid;

  if not found then
    return jsonb_build_object(
      'ok',true,
      'status',null,
      'requestedAt',null,
      'expiresAt',null,
      'resolvedAt',null,
      'serverTime',now()
    );
  end if;

  return jsonb_build_object(
    'ok',true,
    'status',v_row.status,
    'requestedAt',v_row.requested_at,
    'expiresAt',v_row.expires_at,
    'resolvedAt',v_row.resolved_at,
    'serverTime',now()
  );
end;
$$;

create or replace function private.get_livekit_waiting_room_snapshot(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.has_conference_permission(
       p_room_id,'MANAGE_WAITING_ROOM',auth.uid()
     ) then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  update public.conference_waiting_room
  set status='expired',
      resolved_at=coalesce(resolved_at,now())
  where room_id=p_room_id
    and status='waiting'
    and expires_at<=now();

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'user_id',user_id,
        'display_name',display_name,
        'status',status,
        'requested_at',requested_at,
        'expires_at',expires_at,
        'resolved_at',resolved_at
      )
      order by requested_at,id
    ),
    '[]'::jsonb
  )
  into v_rows
  from public.conference_waiting_room
  where room_id=p_room_id
    and status='waiting'
    and expires_at>now();

  return jsonb_build_object(
    'ok',true,
    'rows',v_rows,
    'serverTime',now()
  );
end;
$$;

create or replace function private.admit_livekit_conference_participant(
  p_room_id uuid,
  p_target_user_id uuid,
  p_admit boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.conference_rooms%rowtype;
  v_row public.conference_waiting_room%rowtype;
  v_joined integer:=0;
  v_reserved integer:=0;
  v_capacity integer:=20;
  v_status text;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.has_conference_permission(
       p_room_id,'MANAGE_WAITING_ROOM',v_uid
     ) then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_room.status='ended'
     or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;

  update public.conference_waiting_room
  set status='expired',
      resolved_at=coalesce(resolved_at,now())
  where room_id=p_room_id
    and status='waiting'
    and expires_at<=now();

  select * into v_row
  from public.conference_waiting_room
  where room_id=p_room_id
    and user_id=p_target_user_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','request_not_found');
  end if;

  if p_admit then
    if v_row.status='admitted' then
      return jsonb_build_object(
        'ok',true,'status','admitted','idempotent',true
      );
    end if;

    if v_row.status='rejected' then
      return jsonb_build_object(
        'ok',false,'reason','already_rejected','status',v_row.status
      );
    end if;

    if v_row.status='expired' then
      return jsonb_build_object(
        'ok',false,'reason','request_expired','status',v_row.status
      );
    end if;

    if v_row.status<>'waiting' then
      return jsonb_build_object(
        'ok',false,'reason','request_not_waiting','status',v_row.status
      );
    end if;

    v_capacity:=least(greatest(v_room.max_participants,1),20);

    select count(*) into v_joined
    from public.conference_participants p
    where p.room_id=p_room_id and p.status='joined';

    select count(*) into v_reserved
    from public.conference_waiting_room w
    where w.room_id=p_room_id
      and w.status='admitted'
      and not exists(
        select 1
        from public.conference_participants p
        where p.room_id=p_room_id
          and p.user_id=w.user_id
          and p.status='joined'
      );

    if v_joined+v_reserved>=v_capacity then
      return jsonb_build_object(
        'ok',false,
        'reason','room_full',
        'capacity',v_capacity,
        'joined',v_joined,
        'reserved',v_reserved
      );
    end if;

    v_status:='admitted';
  else
    if v_row.status='rejected' then
      return jsonb_build_object(
        'ok',true,'status','rejected','idempotent',true
      );
    end if;

    if v_row.status='admitted' then
      return jsonb_build_object(
        'ok',false,'reason','already_admitted','status',v_row.status
      );
    end if;

    if v_row.status='expired' then
      return jsonb_build_object(
        'ok',false,'reason','request_expired','status',v_row.status
      );
    end if;

    if v_row.status<>'waiting' then
      return jsonb_build_object(
        'ok',false,'reason','request_not_waiting','status',v_row.status
      );
    end if;

    v_status:='rejected';
  end if;

  update public.conference_waiting_room
  set status=v_status,
      resolved_at=now()
  where id=v_row.id
    and status='waiting';

  if not found then
    return jsonb_build_object(
      'ok',false,'reason','concurrent_resolution'
    );
  end if;

  insert into public.conference_audit_events(
    room_id,actor_user_id,target_user_id,event_type
  )
  values(
    p_room_id,
    v_uid,
    p_target_user_id,
    case when p_admit
      then 'participant_admitted'
      else 'participant_rejected'
    end
  );

  return jsonb_build_object(
    'ok',true,
    'status',v_status,
    'idempotent',false
  );
end;
$$;

create or replace function private.admit_all_livekit_conference_participants(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.conference_rooms%rowtype;
  v_capacity integer:=20;
  v_joined integer:=0;
  v_reserved integer:=0;
  v_available integer:=0;
  v_admitted integer:=0;
  v_remaining integer:=0;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.has_conference_permission(
       p_room_id,'MANAGE_WAITING_ROOM',v_uid
     ) then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_room.status='ended'
     or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;

  update public.conference_waiting_room
  set status='expired',
      resolved_at=coalesce(resolved_at,now())
  where room_id=p_room_id
    and status='waiting'
    and expires_at<=now();

  v_capacity:=least(greatest(v_room.max_participants,1),20);

  select count(*) into v_joined
  from public.conference_participants p
  where p.room_id=p_room_id and p.status='joined';

  select count(*) into v_reserved
  from public.conference_waiting_room w
  where w.room_id=p_room_id
    and w.status='admitted'
    and not exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id
        and p.user_id=w.user_id
        and p.status='joined'
    );

  v_available:=greatest(v_capacity-v_joined-v_reserved,0);

  if v_available>0 then
    with targets as (
      select w.id
      from public.conference_waiting_room w
      where w.room_id=p_room_id
        and w.status='waiting'
        and w.expires_at>now()
      order by w.requested_at,w.id
      limit v_available
      for update
    ),
    updated as (
      update public.conference_waiting_room w
      set status='admitted',
          resolved_at=now()
      from targets t
      where w.id=t.id
        and w.status='waiting'
      returning w.user_id
    )
    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type
    )
    select
      p_room_id,
      v_uid,
      u.user_id,
      'participant_admitted'
    from updated u;

    get diagnostics v_admitted = row_count;
  end if;

  select count(*) into v_remaining
  from public.conference_waiting_room
  where room_id=p_room_id
    and status='waiting'
    and expires_at>now();

  return jsonb_build_object(
    'ok',true,
    'admitted_count',v_admitted,
    'remaining_waiting_count',v_remaining,
    'capacity',v_capacity,
    'joined',v_joined,
    'reserved_before',v_reserved
  );
end;
$$;

create or replace function private.check_conference_join(
  p_room_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid;
  v_room public.conference_rooms%rowtype;
  v_count int;
  v_ban public.banned_users%rowtype;
  v_waiting_status text;
  v_waiting_expires_at timestamptz;
begin
  v_uid:=auth.uid();

  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('allowed',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id;

  if not found then
    return jsonb_build_object('allowed',false,'reason','room_not_found');
  end if;

  if v_room.status='ended'
     or coalesce(v_room.expires_at,now()+interval '1 hour')<=now() then
    return jsonb_build_object('allowed',false,'reason','room_ended');
  end if;

  if v_room.is_locked and v_room.host_id<>v_uid then
    if v_room.media_topology='sfu' then
      select w.status,w.expires_at
      into v_waiting_status,v_waiting_expires_at
      from public.conference_waiting_room w
      where w.room_id=p_room_id and w.user_id=v_uid;

      if v_waiting_status='rejected' then
        return jsonb_build_object('allowed',false,'reason','rejected');
      end if;

      if not (
        v_waiting_status='admitted'
        or (
          v_waiting_status='waiting'
          and v_waiting_expires_at>now()
        )
      ) then
        return jsonb_build_object('allowed',false,'reason','room_locked');
      end if;
    else
      return jsonb_build_object('allowed',false,'reason','room_locked');
    end if;
  end if;

  select * into v_ban
  from public.banned_users
  where room_id=p_room_id
    and user_id=v_uid
    and (expires_at is null or expires_at>now())
  limit 1;

  if found then
    return jsonb_build_object(
      'allowed',false,
      'reason','banned',
      'ban_reason',v_ban.reason,
      'ban_expires_at',v_ban.expires_at
    );
  end if;

  select count(*) into v_count
  from public.conference_participants
  where room_id=p_room_id
    and status='joined'
    and user_id<>v_uid;

  if v_count>=v_room.max_participants then
    return jsonb_build_object('allowed',false,'reason','room_full');
  end if;

  return jsonb_build_object('allowed',true,'reason','ok');
end;
$$;

create or replace function private.join_conference_authenticated(
  p_room_id uuid,
  p_peer_id text,
  p_display_name text,
  p_is_muted boolean default false,
  p_is_video_off boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid;
  v_room public.conference_rooms%rowtype;
  v_count int;
  v_role text;
  v_rbac_role text;
  v_waiting_status text;
  v_waiting_expires_at timestamptz;
begin
  v_uid:=auth.uid();

  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('allowed',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id
  for update;

  if not found then
    return jsonb_build_object('allowed',false,'reason','room_not_found');
  end if;

  if v_room.status='ended'
     or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('allowed',false,'reason','room_ended');
  end if;

  if v_room.is_locked and v_room.host_id<>v_uid then
    if v_room.media_topology='sfu' then
      select w.status,w.expires_at
      into v_waiting_status,v_waiting_expires_at
      from public.conference_waiting_room w
      where w.room_id=p_room_id and w.user_id=v_uid;

      if v_waiting_status='rejected' then
        return jsonb_build_object('allowed',false,'reason','rejected');
      end if;

      if not (
        v_waiting_status='admitted'
        or (
          v_waiting_status='waiting'
          and v_waiting_expires_at>now()
        )
      ) then
        return jsonb_build_object('allowed',false,'reason','room_locked');
      end if;
    else
      return jsonb_build_object('allowed',false,'reason','room_locked');
    end if;
  end if;

  if exists(
    select 1
    from public.banned_users b
    where b.room_id=p_room_id
      and b.user_id=v_uid
      and (b.expires_at is null or b.expires_at>now())
  ) then
    return jsonb_build_object('allowed',false,'reason','banned');
  end if;

  v_rbac_role:=private.conference_effective_role(p_room_id,v_uid);

  if v_rbac_role is null and v_room.meeting_id is null then
    v_rbac_role:='PARTICIPANT';
  end if;

  if v_rbac_role is null
     or not exists(
       select 1
       from private.conference_role_permissions rp
       where rp.role=v_rbac_role
         and rp.permission='JOIN_ROOM'
     ) then
    return jsonb_build_object('allowed',false,'reason','permission_denied');
  end if;

  select p.role into v_role
  from public.conference_participants p
  where p.room_id=p_room_id and p.user_id=v_uid;

  if v_room.host_id=v_uid then
    v_role:='host';
  elsif v_role not in ('admin','moderator') then
    v_role:='member';
  end if;

  if v_room.media_topology='sfu'
     and v_room.livekit_room_name is not null then
    return jsonb_build_object(
      'allowed',true,
      'reason','sfu_token_gate',
      'role',coalesce(v_role,'member'),
      'rbac_role',v_rbac_role
    );
  end if;

  select count(*) into v_count
  from public.conference_participants p
  where p.room_id=p_room_id
    and p.status='joined'
    and p.user_id<>v_uid;

  if v_count>=least(v_room.max_participants,6) then
    return jsonb_build_object('allowed',false,'reason','room_full');
  end if;

  insert into public.conference_participants(
    room_id,user_id,display_name,role,status,joined_at,left_at,
    is_muted,is_video_off,peer_id,last_seen
  )
  values(
    p_room_id,
    v_uid,
    left(trim(p_display_name),60),
    coalesce(v_role,'member'),
    'joined',
    now(),
    null,
    coalesce(p_is_muted,false),
    coalesce(p_is_video_off,false),
    left(coalesce(p_peer_id,''),200),
    now()
  )
  on conflict(room_id,user_id) do update
  set display_name=excluded.display_name,
      role=excluded.role,
      status='joined',
      joined_at=now(),
      left_at=null,
      is_muted=excluded.is_muted,
      is_video_off=excluded.is_video_off,
      peer_id=excluded.peer_id,
      last_seen=now();

  return jsonb_build_object(
    'allowed',true,
    'reason','ok',
    'role',coalesce(v_role,'member'),
    'rbac_role',v_rbac_role
  );
end;
$$;

create or replace function private.prepare_livekit_conference_join(
  p_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_room public.conference_rooms%rowtype;
  v_role text;
  v_display_name text:='';
  v_joined_count integer;
  v_waiting_status text;
  v_waiting_expires_at timestamptz;
  v_meeting_allowed boolean:=false;
  v_recording_active boolean:=false;
  v_consent_ok boolean:=false;
begin
  if v_uid is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id
  for update;

  if not found
     or v_room.media_topology<>'sfu'
     or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_room.status='ended'
     or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;

  select w.status,w.expires_at
  into v_waiting_status,v_waiting_expires_at
  from public.conference_waiting_room w
  where w.room_id=p_room_id and w.user_id=v_uid
  for update;

  if found
     and v_waiting_status='waiting'
     and v_waiting_expires_at<=now() then
    update public.conference_waiting_room
    set status='expired',
        resolved_at=coalesce(resolved_at,now())
    where room_id=p_room_id
      and user_id=v_uid
      and status='waiting';

    v_waiting_status:='expired';
  end if;

  if v_room.is_locked and v_room.host_id<>v_uid then
    if v_waiting_status='admitted' then
      null;
    elsif v_waiting_status='waiting' then
      return jsonb_build_object(
        'ok',false,
        'reason','waiting_for_admission',
        'waiting_status','waiting',
        'expires_at',v_waiting_expires_at
      );
    elsif v_waiting_status='rejected' then
      return jsonb_build_object('ok',false,'reason','rejected');
    else
      return jsonb_build_object('ok',false,'reason','room_locked');
    end if;
  end if;

  if exists(
    select 1
    from public.banned_users b
    where b.room_id=p_room_id
      and b.user_id=v_uid
      and (b.expires_at is null or b.expires_at>now())
  ) then
    return jsonb_build_object('ok',false,'reason','banned');
  end if;

  if v_room.meeting_id is not null then
    select exists(
      select 1
      from public.meetings m
      where m.id=v_room.meeting_id
        and (
          m.user_id=v_uid
          or m.meeting_manager=v_uid
          or v_uid=any(
            coalesce(m.participant_user_ids,'{}'::uuid[])
          )
        )
    ) into v_meeting_allowed;
  else
    v_meeting_allowed:=v_room.host_id=v_uid or exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id and p.user_id=v_uid
    );
  end if;

  if not v_meeting_allowed then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  if not private.has_conference_permission(
    p_room_id,'JOIN_ROOM',v_uid
  ) then
    return jsonb_build_object('ok',false,'reason','permission_denied');
  end if;

  if v_room.host_id=v_uid then
    v_role:='host';
  else
    select p.role,p.display_name
    into v_role,v_display_name
    from public.conference_participants p
    where p.room_id=p_room_id and p.user_id=v_uid;

    if v_role not in ('admin','moderator') then
      v_role:='member';
    end if;
  end if;

  if (
    v_room.waiting_room_enabled
    or v_room.require_approval
  ) and v_room.host_id<>v_uid then
    if v_waiting_status='admitted' then
      null;
    elsif v_waiting_status='rejected' then
      return jsonb_build_object('ok',false,'reason','rejected');
    elsif v_waiting_status='waiting' then
      return jsonb_build_object(
        'ok',false,
        'reason','waiting_for_admission',
        'waiting_status','waiting',
        'expires_at',v_waiting_expires_at
      );
    elsif v_waiting_status='expired' then
      update public.conference_waiting_room
      set status='waiting',
          requested_at=now(),
          expires_at=now()+interval '5 minutes',
          resolved_at=null,
          display_name=coalesce(nullif(v_display_name,''),display_name)
      where room_id=p_room_id and user_id=v_uid;

      select expires_at into v_waiting_expires_at
      from public.conference_waiting_room
      where room_id=p_room_id and user_id=v_uid;

      return jsonb_build_object(
        'ok',false,
        'reason','waiting_for_admission',
        'waiting_status','waiting',
        'expires_at',v_waiting_expires_at
      );
    else
      insert into public.conference_waiting_room(
        room_id,user_id,display_name,status,requested_at,expires_at,resolved_at
      )
      values(
        p_room_id,
        v_uid,
        coalesce(v_display_name,''),
        'waiting',
        now(),
        now()+interval '5 minutes',
        null
      )
      on conflict(room_id,user_id) do nothing;

      select status,expires_at
      into v_waiting_status,v_waiting_expires_at
      from public.conference_waiting_room
      where room_id=p_room_id and user_id=v_uid;

      if v_waiting_status='admitted' then
        null;
      elsif v_waiting_status='rejected' then
        return jsonb_build_object('ok',false,'reason','rejected');
      else
        return jsonb_build_object(
          'ok',false,
          'reason','waiting_for_admission',
          'waiting_status',coalesce(v_waiting_status,'waiting'),
          'expires_at',v_waiting_expires_at
        );
      end if;
    end if;
  end if;

  select count(*) into v_joined_count
  from public.conference_participants p
  where p.room_id=p_room_id
    and p.status='joined'
    and p.user_id<>v_uid;

  if v_joined_count>=least(v_room.max_participants,20) then
    return jsonb_build_object('ok',false,'reason','room_full');
  end if;

  select exists(
    select 1
    from public.conference_recordings r
    where r.room_id=p_room_id
      and r.status in (
        'queued','starting','recording','stopping','processing'
      )
  ) into v_recording_active;

  if v_recording_active
     and coalesce(v_room.recording_consent_required,true) then
    select exists(
      select 1
      from public.conference_recording_consents c
      where c.room_id=p_room_id
        and c.user_id=v_uid
        and c.status='accepted'
        and c.policy_version=1
    ) into v_consent_ok;

    if not v_consent_ok then
      return jsonb_build_object(
        'ok',false,
        'reason','recording_consent_required',
        'recording_active',true,
        'consent_policy_version',1
      );
    end if;
  end if;

  insert into public.conference_participants(
    room_id,user_id,display_name,role,status,
    joined_at,left_at,peer_id,last_seen
  )
  values(
    p_room_id,
    v_uid,
    coalesce(v_display_name,''),
    coalesce(v_role,'member'),
    'joined',
    now(),
    null,
    '',
    now()
  )
  on conflict(room_id,user_id) do update
  set role=excluded.role,
      status='joined',
      joined_at=now(),
      left_at=null,
      last_seen=now();

  insert into public.conference_audit_events(
    room_id,actor_user_id,event_type
  )
  values(
    p_room_id,v_uid,'participant_joined'
  );

  return jsonb_build_object(
    'ok',true,
    'reason','ok',
    'room_id',v_room.id,
    'meeting_id',v_room.meeting_id,
    'livekit_room_name',v_room.livekit_room_name,
    'role',coalesce(v_role,'member'),
    'rbac_role',private.conference_effective_role(p_room_id,v_uid),
    'display_name',coalesce(v_display_name,''),
    'max_participants',least(v_room.max_participants,20)
  );
end;
$$;

create or replace function public.get_livekit_waiting_room_state(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select private.get_livekit_waiting_room_state(p_room_id)
$$;

create or replace function public.get_livekit_waiting_room_snapshot(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select private.get_livekit_waiting_room_snapshot(p_room_id)
$$;

create or replace function public.admit_livekit_conference_participant(
  p_room_id uuid,
  p_target_user_id uuid,
  p_admit boolean
)
returns jsonb
language sql
set search_path=''
as $$
  select private.admit_livekit_conference_participant(
    p_room_id,p_target_user_id,p_admit
  )
$$;

create or replace function public.admit_all_livekit_conference_participants(
  p_room_id uuid
)
returns jsonb
language sql
set search_path=''
as $$
  select private.admit_all_livekit_conference_participants(p_room_id)
$$;

revoke all on function public.get_livekit_waiting_room_state(uuid)
  from public,anon;
revoke all on function public.get_livekit_waiting_room_snapshot(uuid)
  from public,anon;
revoke all on function public.admit_livekit_conference_participant(uuid,uuid,boolean)
  from public,anon;
revoke all on function public.admit_all_livekit_conference_participants(uuid)
  from public,anon;

grant execute on function public.get_livekit_waiting_room_state(uuid)
  to authenticated,service_role;
grant execute on function public.get_livekit_waiting_room_snapshot(uuid)
  to authenticated,service_role;
grant execute on function public.admit_livekit_conference_participant(uuid,uuid,boolean)
  to authenticated,service_role;
grant execute on function public.admit_all_livekit_conference_participants(uuid)
  to authenticated,service_role;
