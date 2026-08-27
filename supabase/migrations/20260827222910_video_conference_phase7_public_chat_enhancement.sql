alter table public.conference_messages
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists conference_messages_room_created_idx
  on public.conference_messages(room_id,created_at,id);

create table if not exists public.conference_message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.conference_messages(id) on delete cascade,
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  user_id uuid not null,
  emoji text not null,
  created_at timestamptz not null default now(),
  constraint conference_message_reactions_emoji_check
    check (char_length(trim(emoji)) between 1 and 16),
  constraint conference_message_reactions_unique
    unique(message_id,user_id,emoji)
);

create index if not exists conference_message_reactions_room_message_idx
  on public.conference_message_reactions(room_id,message_id,created_at);

alter table public.conference_message_reactions enable row level security;
revoke all on table public.conference_message_reactions from public,anon;
grant select on table public.conference_message_reactions to authenticated,service_role;
grant insert,update,delete on table public.conference_message_reactions to service_role;

drop policy if exists "conference_message_reactions_select"
on public.conference_message_reactions;
create policy "conference_message_reactions_select"
on public.conference_message_reactions
for select to authenticated
using (
  exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_message_reactions.room_id
      and p.user_id=(select auth.uid())
  )
);

create table if not exists public.conference_message_mentions (
  message_id uuid not null references public.conference_messages(id) on delete cascade,
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  mentioned_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key(message_id,mentioned_user_id)
);

create index if not exists conference_message_mentions_room_user_idx
  on public.conference_message_mentions(room_id,mentioned_user_id,created_at desc);

alter table public.conference_message_mentions enable row level security;
revoke all on table public.conference_message_mentions from public,anon;
grant select on table public.conference_message_mentions to authenticated,service_role;
grant insert,update,delete on table public.conference_message_mentions to service_role;

drop policy if exists "conference_message_mentions_select"
on public.conference_message_mentions;
create policy "conference_message_mentions_select"
on public.conference_message_mentions
for select to authenticated
using (
  exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_message_mentions.room_id
      and p.user_id=(select auth.uid())
  )
);

create table if not exists private.conference_chat_rate_limits (
  room_id uuid not null,
  user_id uuid not null,
  window_started_at timestamptz not null,
  send_count integer not null,
  updated_at timestamptz not null default now(),
  primary key(room_id,user_id),
  constraint conference_chat_rate_limits_count_check
    check (send_count>=0)
);
alter table private.conference_chat_rate_limits enable row level security;
revoke all on table private.conference_chat_rate_limits from public,anon,authenticated;

create or replace function private.consume_conference_chat_rate_limit(
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
  v_row private.conference_chat_rate_limits%rowtype;
  v_window interval:=interval '10 seconds';
  v_limit integer:=8;
  v_retry_ms integer:=0;
begin
  if p_room_id is null or p_user_id is null then
    return jsonb_build_object('ok',false,'reason','invalid_rate_limit_key');
  end if;

  insert into private.conference_chat_rate_limits(
    room_id,user_id,window_started_at,send_count,updated_at
  )
  values(p_room_id,p_user_id,v_now,0,v_now)
  on conflict(room_id,user_id) do nothing;

  select * into v_row
  from private.conference_chat_rate_limits r
  where r.room_id=p_room_id and r.user_id=p_user_id
  for update;

  if v_row.window_started_at+v_window<=v_now then
    update private.conference_chat_rate_limits
    set window_started_at=v_now,
        send_count=1,
        updated_at=v_now
    where room_id=p_room_id and user_id=p_user_id;

    return jsonb_build_object(
      'ok',true,'remaining',v_limit-1,'retry_after_ms',0
    );
  end if;

  if v_row.send_count>=v_limit then
    v_retry_ms:=greatest(
      1,
      ceil(
        extract(epoch from ((v_row.window_started_at+v_window)-v_now))*1000
      )::integer
    );
    return jsonb_build_object(
      'ok',false,'reason','rate_limited',
      'remaining',0,'retry_after_ms',v_retry_ms
    );
  end if;

  update private.conference_chat_rate_limits
  set send_count=send_count+1,
      updated_at=v_now
  where room_id=p_room_id and user_id=p_user_id;

  return jsonb_build_object(
    'ok',true,
    'remaining',greatest(0,v_limit-(v_row.send_count+1)),
    'retry_after_ms',0
  );
end;
$$;

revoke execute on function private.consume_conference_chat_rate_limit(uuid,uuid)
from public,anon,authenticated;
grant execute on function private.consume_conference_chat_rate_limit(uuid,uuid)
to service_role;

create or replace function private.conference_chat_role_label(
  p_room_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select case private.conference_effective_role(p_room_id,p_user_id)
    when 'OWNER' then 'admin'
    when 'HOST' then 'admin'
    when 'CO_HOST' then 'admin'
    when 'MODERATOR' then 'moderator'
    else 'user'
  end
$$;

revoke execute on function private.conference_chat_role_label(uuid,uuid)
from public,anon;
grant execute on function private.conference_chat_role_label(uuid,uuid)
to authenticated,service_role;

create or replace function private.conference_chat_display_name(
  p_room_id uuid,
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path=''
as $$
  select coalesce(
    nullif(trim((
      select p.display_name
      from public.conference_participants p
      where p.room_id=p_room_id and p.user_id=p_user_id
      limit 1
    )), ''),
    'کاربر'
  )
$$;

revoke execute on function private.conference_chat_display_name(uuid,uuid)
from public,anon;
grant execute on function private.conference_chat_display_name(uuid,uuid)
to authenticated,service_role;

create or replace function private.conference_chat_action_allowed(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_message_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_message public.conference_messages%rowtype;
  v_room public.conference_rooms%rowtype;
  v_joined boolean:=false;
  v_can_send boolean:=false;
  v_can_delete_any boolean:=false;
begin
  if p_actor_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select * into v_room
  from public.conference_rooms r
  where r.id=p_room_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  select exists(
    select 1 from public.conference_participants p
    where p.room_id=p_room_id
      and p.user_id=p_actor_user_id
      and p.status='joined'
  ) into v_joined;

  if not v_joined then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  v_can_send:=private.has_conference_permission(
    p_room_id,'SEND_CHAT',p_actor_user_id
  );
  v_can_delete_any:=private.has_conference_permission(
    p_room_id,'DELETE_CHAT',p_actor_user_id
  );

  if v_action='send' then
    if not v_can_send then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
    if v_room.status='ended'
       or not coalesce(v_room.chat_enabled,false)
       or not coalesce(v_room.phase_allow_chat,true) then
      return jsonb_build_object('ok',false,'reason','chat_disabled');
    end if;
    return jsonb_build_object('ok',true);
  end if;

  if p_message_id is null then
    return jsonb_build_object('ok',false,'reason','message_required');
  end if;

  select * into v_message
  from public.conference_messages m
  where m.id=p_message_id and m.room_id=p_room_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','message_not_found');
  end if;

  if v_message.is_deleted then
    return jsonb_build_object('ok',false,'reason','message_deleted');
  end if;

  if v_action='edit' then
    if v_message.user_id<>p_actor_user_id then
      return jsonb_build_object('ok',false,'reason','not_message_owner');
    end if;
    if not v_can_send
       or v_room.status='ended'
       or not coalesce(v_room.chat_enabled,false)
       or not coalesce(v_room.phase_allow_chat,true) then
      return jsonb_build_object('ok',false,'reason','chat_disabled');
    end if;
    return jsonb_build_object('ok',true);
  elsif v_action='delete' then
    if v_message.user_id<>p_actor_user_id and not v_can_delete_any then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
    if v_room.status='ended' then
      return jsonb_build_object('ok',false,'reason','room_ended');
    end if;
    return jsonb_build_object(
      'ok',true,
      'moderator_delete',v_message.user_id<>p_actor_user_id
    );
  elsif v_action='react' then
    if not v_can_send
       or v_room.status='ended'
       or not coalesce(v_room.chat_enabled,false)
       or not coalesce(v_room.phase_allow_chat,true) then
      return jsonb_build_object('ok',false,'reason','chat_disabled');
    end if;
    return jsonb_build_object('ok',true);
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

revoke execute on function private.conference_chat_action_allowed(uuid,uuid,text,uuid)
from public,anon;
grant execute on function private.conference_chat_action_allowed(uuid,uuid,text,uuid)
to authenticated,service_role;

create or replace function private.validate_conference_message_mentions(
  p_room_id uuid,
  p_mentioned_user_ids uuid[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_ids uuid[]:=coalesce(p_mentioned_user_ids,'{}'::uuid[]);
  v_distinct_count integer;
  v_valid_count integer;
begin
  select count(distinct x) into v_distinct_count
  from unnest(v_ids) x;

  if v_distinct_count>10 then
    return jsonb_build_object('ok',false,'reason','too_many_mentions');
  end if;

  if v_distinct_count=0 then
    return jsonb_build_object('ok',true,'ids','[]'::jsonb);
  end if;

  select count(distinct p.user_id) into v_valid_count
  from public.conference_participants p
  where p.room_id=p_room_id
    and p.status='joined'
    and p.user_id=any(v_ids);

  if v_valid_count<>v_distinct_count then
    return jsonb_build_object('ok',false,'reason','invalid_mention');
  end if;

  return jsonb_build_object(
    'ok',true,
    'ids',(
      select coalesce(jsonb_agg(x order by x),'[]'::jsonb)
      from (select distinct unnest(v_ids) x) q
    )
  );
end;
$$;

revoke execute on function private.validate_conference_message_mentions(uuid,uuid[])
from public,anon;
grant execute on function private.validate_conference_message_mentions(uuid,uuid[])
to authenticated,service_role;

create or replace function public.authorize_conference_chat_action(
  p_room_id uuid,
  p_action text,
  p_message_id uuid default null
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

  return private.conference_chat_action_allowed(
    p_room_id,auth.uid(),p_action,p_message_id
  );
end;
$$;

revoke execute on function public.authorize_conference_chat_action(uuid,text,uuid)
from public,anon;
grant execute on function public.authorize_conference_chat_action(uuid,text,uuid)
to authenticated,service_role;

create or replace function private.apply_conference_chat_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_message_id uuid default null,
  p_body text default null,
  p_reply_to_id uuid default null,
  p_emoji text default null,
  p_mentioned_user_ids uuid[] default '{}'::uuid[],
  p_image_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_allowed jsonb;
  v_rate jsonb;
  v_mentions jsonb;
  v_message public.conference_messages%rowtype;
  v_reply public.conference_messages%rowtype;
  v_body text:=trim(coalesce(p_body,''));
  v_emoji text:=trim(coalesce(p_emoji,''));
  v_display_name text;
  v_role text;
  v_reaction public.conference_message_reactions%rowtype;
  v_active boolean:=false;
begin
  v_allowed:=private.conference_chat_action_allowed(
    p_room_id,p_actor_user_id,v_action,p_message_id
  );

  if coalesce((v_allowed->>'ok')::boolean,false) is not true then
    return v_allowed;
  end if;

  if v_action in ('send','edit') then
    if char_length(v_body)>4000 then
      return jsonb_build_object('ok',false,'reason','message_too_long');
    end if;

    v_mentions:=private.validate_conference_message_mentions(
      p_room_id,p_mentioned_user_ids
    );
    if coalesce((v_mentions->>'ok')::boolean,false) is not true then
      return v_mentions;
    end if;
  end if;

  if v_action='send' then
    if v_body='' and nullif(trim(coalesce(p_image_path,'')),'') is null then
      return jsonb_build_object('ok',false,'reason','message_empty');
    end if;

    if p_image_path is not null
       and p_image_path not like (
         'conf-chat/'||p_room_id::text||'/'||p_actor_user_id::text||'/%'
       ) then
      return jsonb_build_object('ok',false,'reason','invalid_image_path');
    end if;

    if p_reply_to_id is not null then
      select * into v_reply
      from public.conference_messages m
      where m.id=p_reply_to_id
        and m.room_id=p_room_id
        and not m.is_deleted;

      if not found then
        return jsonb_build_object('ok',false,'reason','invalid_reply_target');
      end if;
    end if;

    v_rate:=private.consume_conference_chat_rate_limit(
      p_room_id,p_actor_user_id
    );
    if coalesce((v_rate->>'ok')::boolean,false) is not true then
      return v_rate;
    end if;

    v_display_name:=private.conference_chat_display_name(
      p_room_id,p_actor_user_id
    );
    v_role:=private.conference_chat_role_label(
      p_room_id,p_actor_user_id
    );

    insert into public.conference_messages(
      room_id,user_id,display_name,body,role,
      reply_to_id,reply_to_body,reply_to_name,
      image_path,created_at,is_deleted
    )
    values(
      p_room_id,p_actor_user_id,v_display_name,v_body,v_role,
      p_reply_to_id,
      case when p_reply_to_id is null then null
        else left(coalesce(v_reply.body,''),500) end,
      case when p_reply_to_id is null then null
        else left(coalesce(v_reply.display_name,''),120) end,
      p_image_path,clock_timestamp(),false
    )
    returning * into v_message;

    insert into public.conference_message_mentions(
      message_id,room_id,mentioned_user_id
    )
    select v_message.id,p_room_id,x
    from (
      select distinct unnest(coalesce(p_mentioned_user_ids,'{}'::uuid[])) x
    ) q
    on conflict do nothing;

    return jsonb_build_object(
      'ok',true,
      'message',to_jsonb(v_message),
      'mentions',coalesce(v_mentions->'ids','[]'::jsonb),
      'rate_limit',v_rate
    );
  elsif v_action='edit' then
    select * into v_message
    from public.conference_messages m
    where m.id=p_message_id and m.room_id=p_room_id
    for update;

    if not found then
      return jsonb_build_object('ok',false,'reason','message_not_found');
    end if;

    if v_body='' and v_message.image_path is null and v_message.image_url is null then
      return jsonb_build_object('ok',false,'reason','message_empty');
    end if;

    update public.conference_messages
    set body=v_body,
        edited_at=clock_timestamp()
    where id=v_message.id
    returning * into v_message;

    delete from public.conference_message_mentions
    where message_id=v_message.id;

    insert into public.conference_message_mentions(
      message_id,room_id,mentioned_user_id
    )
    select v_message.id,p_room_id,x
    from (
      select distinct unnest(coalesce(p_mentioned_user_ids,'{}'::uuid[])) x
    ) q
    on conflict do nothing;

    return jsonb_build_object(
      'ok',true,
      'message',to_jsonb(v_message),
      'mentions',coalesce(v_mentions->'ids','[]'::jsonb)
    );
  elsif v_action='delete' then
    select * into v_message
    from public.conference_messages m
    where m.id=p_message_id and m.room_id=p_room_id
    for update;

    update public.conference_messages
    set body='',
        image_url=null,
        image_path=null,
        is_deleted=true,
        deleted_at=clock_timestamp(),
        deleted_by=p_actor_user_id
    where id=v_message.id
    returning * into v_message;

    delete from public.conference_message_mentions
    where message_id=v_message.id;
    delete from public.conference_message_reactions
    where message_id=v_message.id;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,v_message.user_id,
      'conference_chat_message_deleted',
      jsonb_build_object(
        'message_id',v_message.id,
        'moderator_delete',
          coalesce((v_allowed->>'moderator_delete')::boolean,false)
      )
    );

    return jsonb_build_object(
      'ok',true,'message',to_jsonb(v_message)
    );
  elsif v_action='react' then
    if v_emoji='' or char_length(v_emoji)>16 then
      return jsonb_build_object('ok',false,'reason','invalid_emoji');
    end if;

    delete from public.conference_message_reactions r
    where r.message_id=p_message_id
      and r.user_id=p_actor_user_id
      and r.emoji=v_emoji
    returning * into v_reaction;

    if found then
      v_active:=false;
    else
      insert into public.conference_message_reactions(
        message_id,room_id,user_id,emoji
      )
      values(p_message_id,p_room_id,p_actor_user_id,v_emoji)
      returning * into v_reaction;
      v_active:=true;
    end if;

    return jsonb_build_object(
      'ok',true,
      'active',v_active,
      'reaction',to_jsonb(v_reaction)
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.apply_conference_chat_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_message_id uuid default null,
  p_body text default null,
  p_reply_to_id uuid default null,
  p_emoji text default null,
  p_mentioned_user_ids uuid[] default '{}'::uuid[],
  p_image_path text default null
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.apply_conference_chat_action(
    p_room_id,p_actor_user_id,p_action,p_message_id,p_body,
    p_reply_to_id,p_emoji,p_mentioned_user_ids,p_image_path
  )
$$;

revoke execute on function private.apply_conference_chat_action(
  uuid,uuid,text,uuid,text,uuid,text,uuid[],text
) from public,anon,authenticated;
grant execute on function private.apply_conference_chat_action(
  uuid,uuid,text,uuid,text,uuid,text,uuid[],text
) to service_role;

revoke execute on function public.apply_conference_chat_action(
  uuid,uuid,text,uuid,text,uuid,text,uuid[],text
) from public,anon,authenticated;
grant execute on function public.apply_conference_chat_action(
  uuid,uuid,text,uuid,text,uuid,text,uuid[],text
) to service_role;

create or replace function private.enforce_conference_phase_chat_insert()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_chat_enabled boolean;
  v_phase_allow_chat boolean;
  v_status text;
  v_uid uuid:=auth.uid();
  v_rate jsonb;
  v_reply public.conference_messages%rowtype;
begin
  select r.chat_enabled,r.phase_allow_chat,r.status
  into v_chat_enabled,v_phase_allow_chat,v_status
  from public.conference_rooms r
  where r.id=new.room_id;

  if not found then
    raise exception using
      errcode='23503',
      message='conference room not found';
  end if;

  if v_status='ended'
     or not coalesce(v_chat_enabled,false)
     or not coalesce(v_phase_allow_chat,false) then
    raise exception using
      errcode='42501',
      message='conference chat is disabled for the current meeting phase';
  end if;

  if v_uid is null then
    return new;
  end if;

  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception using
      errcode='42501',
      message='anonymous conference chat is not allowed';
  end if;

  if new.user_id<>v_uid
     or not private.is_conference_joined_actor_in_room(new.room_id)
     or not private.has_conference_permission(new.room_id,'SEND_CHAT',v_uid) then
    raise exception using
      errcode='42501',
      message='conference chat send is not authorized';
  end if;

  new.body:=trim(coalesce(new.body,''));
  if char_length(new.body)>4000
     or (
       new.body=''
       and new.image_path is null
       and new.image_url is null
     ) then
    raise exception using
      errcode='22001',
      message='invalid conference chat message';
  end if;

  if new.image_path is not null
     and new.image_path not like (
       'conf-chat/'||new.room_id::text||'/'||v_uid::text||'/%'
     ) then
    raise exception using
      errcode='42501',
      message='invalid conference chat attachment path';
  end if;

  if new.reply_to_id is not null then
    select * into v_reply
    from public.conference_messages m
    where m.id=new.reply_to_id
      and m.room_id=new.room_id
      and not m.is_deleted;

    if not found then
      raise exception using
        errcode='23503',
        message='invalid conference chat reply target';
    end if;

    new.reply_to_body:=left(coalesce(v_reply.body,''),500);
    new.reply_to_name:=left(coalesce(v_reply.display_name,''),120);
  else
    new.reply_to_body:=null;
    new.reply_to_name:=null;
  end if;

  v_rate:=private.consume_conference_chat_rate_limit(
    new.room_id,v_uid
  );
  if coalesce((v_rate->>'ok')::boolean,false) is not true then
    raise exception using
      errcode='P0001',
      message='conference chat rate limit exceeded';
  end if;

  new.display_name:=private.conference_chat_display_name(
    new.room_id,v_uid
  );
  new.role:=private.conference_chat_role_label(
    new.room_id,v_uid
  );
  new.created_at:=clock_timestamp();
  new.is_deleted:=false;
  new.edited_at:=null;
  new.deleted_at:=null;
  new.deleted_by:=null;

  return new;
end;
$$;

revoke insert on table public.conference_messages from anon;
revoke update,delete,truncate,references,trigger
on table public.conference_messages from anon,authenticated;

drop policy if exists "conference_messages_room_read_boundary"
on public.conference_messages;

create policy "conference_messages_room_read_boundary"
on public.conference_messages
as restrictive
for select
to authenticated
using (
  exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_messages.room_id
      and p.user_id=(select auth.uid())
  )
);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_message_reactions'
  ) then
    alter publication supabase_realtime
      add table public.conference_message_reactions;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_message_mentions'
  ) then
    alter publication supabase_realtime
      add table public.conference_message_mentions;
  end if;
end
$$;

notify pgrst,'reload schema';
