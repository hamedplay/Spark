create table if not exists private.conference_reaction_rate_limits (
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  user_id uuid not null,
  window_started_at timestamptz not null default clock_timestamp(),
  reaction_count integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(room_id,user_id),
  constraint conference_reaction_rate_limits_count_check
    check(reaction_count>=0)
);

alter table private.conference_reaction_rate_limits enable row level security;
revoke all on table private.conference_reaction_rate_limits
from public,anon,authenticated;

create or replace function private.get_conference_reaction_context(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_room public.conference_rooms%rowtype;
  v_display_name text;
  v_avatar_url text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms r
  where r.id=p_room_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_room.status='ended' then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;

  if not coalesce(v_room.allow_reactions,false) then
    return jsonb_build_object('ok',false,'reason','reactions_disabled');
  end if;

  select
    coalesce(
      nullif(trim(p.display_name),''),
      nullif(trim(pr.full_name),''),
      'شرکت‌کننده'
    ),
    nullif(trim(pr.avatar_url),'')
  into v_display_name,v_avatar_url
  from public.conference_participants p
  left join public.profiles pr on pr.user_id=p.user_id
  where p.room_id=p_room_id
    and p.user_id=p_user_id
    and p.status='joined'
  limit 1;

  if not found then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  if v_room.livekit_room_name is null
     or trim(v_room.livekit_room_name)='' then
    return jsonb_build_object('ok',false,'reason','livekit_room_missing');
  end if;

  return jsonb_build_object(
    'ok',true,
    'participant_identity',p_user_id,
    'display_name',left(v_display_name,120),
    'avatar_url',case
      when v_avatar_url is null then null
      else left(v_avatar_url,512)
    end,
    'livekit_room_name',v_room.livekit_room_name
  );
end;
$$;

revoke execute on function private.get_conference_reaction_context(
  uuid,uuid
) from public,anon;

grant execute on function private.get_conference_reaction_context(
  uuid,uuid
) to authenticated,service_role;

create or replace function public.authorize_conference_reaction(
  p_room_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  return private.get_conference_reaction_context(
    p_room_id,auth.uid()
  );
end;
$$;

revoke execute on function public.authorize_conference_reaction(uuid)
from public,anon;

grant execute on function public.authorize_conference_reaction(uuid)
to authenticated,service_role;

create or replace function private.consume_conference_reaction_rate_limit(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_now timestamptz:=clock_timestamp();
  v_window interval:=interval '5 seconds';
  v_limit integer:=5;
  v_row private.conference_reaction_rate_limits%rowtype;
  v_retry_after_ms integer;
begin
  if p_room_id is null or p_user_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_identity');
  end if;

  insert into private.conference_reaction_rate_limits(
    room_id,user_id,window_started_at,reaction_count,updated_at
  )
  values(p_room_id,p_user_id,v_now,0,v_now)
  on conflict(room_id,user_id) do nothing;

  select * into v_row
  from private.conference_reaction_rate_limits
  where room_id=p_room_id
    and user_id=p_user_id
  for update;

  if v_now-v_row.window_started_at>=v_window then
    update private.conference_reaction_rate_limits
    set window_started_at=v_now,
        reaction_count=1,
        updated_at=v_now
    where room_id=p_room_id
      and user_id=p_user_id;

    return jsonb_build_object(
      'ok',true,
      'remaining',v_limit-1,
      'retry_after_ms',0
    );
  end if;

  if v_row.reaction_count>=v_limit then
    v_retry_after_ms:=greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_row.window_started_at+v_window-v_now
          )
        )*1000
      )::integer
    );

    return jsonb_build_object(
      'ok',false,
      'reason','rate_limited',
      'remaining',0,
      'retry_after_ms',v_retry_after_ms
    );
  end if;

  update private.conference_reaction_rate_limits
  set reaction_count=reaction_count+1,
      updated_at=v_now
  where room_id=p_room_id
    and user_id=p_user_id;

  return jsonb_build_object(
    'ok',true,
    'remaining',greatest(0,v_limit-(v_row.reaction_count+1)),
    'retry_after_ms',0
  );
end;
$$;

create or replace function public.consume_conference_reaction_rate_limit(
  p_room_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.consume_conference_reaction_rate_limit(
    p_room_id,p_actor_user_id
  )
$$;

revoke execute on function private.consume_conference_reaction_rate_limit(
  uuid,uuid
) from public,anon,authenticated;

grant execute on function private.consume_conference_reaction_rate_limit(
  uuid,uuid
) to service_role;

revoke execute on function public.consume_conference_reaction_rate_limit(
  uuid,uuid
) from public,anon,authenticated;

grant execute on function public.consume_conference_reaction_rate_limit(
  uuid,uuid
) to service_role;

notify pgrst,'reload schema';
