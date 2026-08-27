create table if not exists public.conference_private_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  sender_id uuid not null,
  recipient_id uuid not null,
  sender_name text not null default '',
  recipient_name text not null default '',
  body text not null default '',
  reply_to_id uuid references public.conference_private_messages(id) on delete set null,
  reply_to_body text,
  reply_to_sender_name text,
  is_deleted boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conference_private_messages_distinct_users_check
    check(sender_id<>recipient_id),
  constraint conference_private_messages_body_length_check
    check(char_length(body)<=4000)
);

create index if not exists conference_private_messages_sender_pair_idx
  on public.conference_private_messages(
    room_id,sender_id,recipient_id,created_at,id
  );

create index if not exists conference_private_messages_recipient_pair_idx
  on public.conference_private_messages(
    room_id,recipient_id,sender_id,created_at,id
  );

create index if not exists conference_private_messages_unread_idx
  on public.conference_private_messages(room_id,recipient_id,created_at,id)
  where read_at is null and is_deleted=false;

create index if not exists conference_private_messages_reply_idx
  on public.conference_private_messages(reply_to_id)
  where reply_to_id is not null;

alter table public.conference_private_messages enable row level security;

revoke all on table public.conference_private_messages from public,anon,authenticated;
grant select on table public.conference_private_messages to authenticated,service_role;
grant insert,update,delete on table public.conference_private_messages to service_role;

drop policy if exists "conference_private_messages_participants_read"
on public.conference_private_messages;

create policy "conference_private_messages_participants_read"
on public.conference_private_messages
as restrictive
for select
to authenticated
using (
  (select private.is_current_session_fully_authorized())
  and (
    (select auth.uid())=sender_id
    or (select auth.uid())=recipient_id
  )
  and exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_private_messages.room_id
      and p.user_id=(select auth.uid())
  )
);

create or replace function private.conference_private_chat_action_allowed(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_message_id uuid default null,
  p_peer_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_room public.conference_rooms%rowtype;
  v_message public.conference_private_messages%rowtype;
  v_actor_joined boolean:=false;
  v_peer_joined boolean:=false;
  v_can_send boolean:=false;
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
    select 1
    from public.conference_participants p
    where p.room_id=p_room_id
      and p.user_id=p_actor_user_id
      and p.status='joined'
  ) into v_actor_joined;

  if not v_actor_joined then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  v_can_send:=private.has_conference_permission(
    p_room_id,'SEND_PRIVATE_CHAT',p_actor_user_id
  );

  if v_action='send' then
    if p_peer_user_id is null or p_peer_user_id=p_actor_user_id then
      return jsonb_build_object('ok',false,'reason','invalid_recipient');
    end if;

    select exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id
        and p.user_id=p_peer_user_id
        and p.status='joined'
    ) into v_peer_joined;

    if not v_peer_joined then
      return jsonb_build_object('ok',false,'reason','recipient_not_joined');
    end if;

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

  if v_action='read' then
    if p_peer_user_id is null or p_peer_user_id=p_actor_user_id then
      return jsonb_build_object('ok',false,'reason','invalid_peer');
    end if;

    return jsonb_build_object('ok',true);
  end if;

  if p_message_id is null then
    return jsonb_build_object('ok',false,'reason','message_required');
  end if;

  select * into v_message
  from public.conference_private_messages m
  where m.id=p_message_id and m.room_id=p_room_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','message_not_found');
  end if;

  if v_message.sender_id<>p_actor_user_id then
    return jsonb_build_object('ok',false,'reason','not_message_sender');
  end if;

  if v_action='delete' and v_message.is_deleted then
    return jsonb_build_object(
      'ok',true,'already_deleted',true
    );
  end if;

  if v_message.is_deleted then
    return jsonb_build_object('ok',false,'reason','message_deleted');
  end if;

  if v_action='edit' then
    if not v_can_send
       or v_room.status='ended'
       or not coalesce(v_room.chat_enabled,false)
       or not coalesce(v_room.phase_allow_chat,true) then
      return jsonb_build_object('ok',false,'reason','chat_disabled');
    end if;
    return jsonb_build_object('ok',true);
  elsif v_action='delete' then
    if v_room.status='ended' then
      return jsonb_build_object('ok',false,'reason','room_ended');
    end if;
    return jsonb_build_object('ok',true);
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

revoke execute on function private.conference_private_chat_action_allowed(
  uuid,uuid,text,uuid,uuid
) from public,anon;
grant execute on function private.conference_private_chat_action_allowed(
  uuid,uuid,text,uuid,uuid
) to authenticated,service_role;

create or replace function public.authorize_conference_private_chat_action(
  p_room_id uuid,
  p_action text,
  p_message_id uuid default null,
  p_peer_user_id uuid default null
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

  return private.conference_private_chat_action_allowed(
    p_room_id,auth.uid(),p_action,p_message_id,p_peer_user_id
  );
end;
$$;

revoke execute on function public.authorize_conference_private_chat_action(
  uuid,text,uuid,uuid
) from public,anon;
grant execute on function public.authorize_conference_private_chat_action(
  uuid,text,uuid,uuid
) to authenticated,service_role;

create or replace function private.apply_conference_private_chat_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_message_id uuid default null,
  p_peer_user_id uuid default null,
  p_body text default null,
  p_reply_to_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_allowed jsonb;
  v_body text:=trim(coalesce(p_body,''));
  v_message public.conference_private_messages%rowtype;
  v_reply public.conference_private_messages%rowtype;
  v_sender_name text;
  v_recipient_name text;
  v_updated integer:=0;
begin
  v_allowed:=private.conference_private_chat_action_allowed(
    p_room_id,p_actor_user_id,v_action,p_message_id,p_peer_user_id
  );

  if coalesce((v_allowed->>'ok')::boolean,false) is not true then
    return v_allowed;
  end if;

  if v_action='send' then
    if v_body='' then
      return jsonb_build_object('ok',false,'reason','message_empty');
    end if;
    if char_length(v_body)>4000 then
      return jsonb_build_object('ok',false,'reason','message_too_long');
    end if;

    if p_reply_to_id is not null then
      select * into v_reply
      from public.conference_private_messages m
      where m.id=p_reply_to_id
        and m.room_id=p_room_id
        and not m.is_deleted
        and (
          (
            m.sender_id=p_actor_user_id
            and m.recipient_id=p_peer_user_id
          )
          or (
            m.sender_id=p_peer_user_id
            and m.recipient_id=p_actor_user_id
          )
        );

      if not found then
        return jsonb_build_object('ok',false,'reason','invalid_reply_target');
      end if;
    end if;

    v_sender_name:=private.conference_chat_display_name(
      p_room_id,p_actor_user_id
    );
    v_recipient_name:=private.conference_chat_display_name(
      p_room_id,p_peer_user_id
    );

    insert into public.conference_private_messages(
      room_id,sender_id,recipient_id,
      sender_name,recipient_name,body,
      reply_to_id,reply_to_body,reply_to_sender_name,
      created_at,updated_at,is_deleted
    )
    values(
      p_room_id,p_actor_user_id,p_peer_user_id,
      v_sender_name,v_recipient_name,v_body,
      p_reply_to_id,
      case when p_reply_to_id is null then null
        else left(coalesce(v_reply.body,''),500) end,
      case when p_reply_to_id is null then null
        else left(coalesce(v_reply.sender_name,''),120) end,
      clock_timestamp(),clock_timestamp(),false
    )
    returning * into v_message;

    return jsonb_build_object('ok',true,'message',to_jsonb(v_message));
  elsif v_action='edit' then
    if v_body='' then
      return jsonb_build_object('ok',false,'reason','message_empty');
    end if;
    if char_length(v_body)>4000 then
      return jsonb_build_object('ok',false,'reason','message_too_long');
    end if;

    update public.conference_private_messages
    set body=v_body,
        edited_at=clock_timestamp(),
        updated_at=clock_timestamp()
    where id=p_message_id
      and room_id=p_room_id
      and sender_id=p_actor_user_id
      and not is_deleted
    returning * into v_message;

    if not found then
      return jsonb_build_object('ok',false,'reason','message_not_found');
    end if;

    return jsonb_build_object('ok',true,'message',to_jsonb(v_message));
  elsif v_action='delete' then
    if coalesce((v_allowed->>'already_deleted')::boolean,false) then
      select * into v_message
      from public.conference_private_messages
      where id=p_message_id and room_id=p_room_id;

      return jsonb_build_object(
        'ok',true,'already_deleted',true,'message',to_jsonb(v_message)
      );
    end if;

    update public.conference_private_messages
    set body='',
        is_deleted=true,
        deleted_at=clock_timestamp(),
        deleted_by=p_actor_user_id,
        updated_at=clock_timestamp()
    where id=p_message_id
      and room_id=p_room_id
      and sender_id=p_actor_user_id
      and not is_deleted
    returning * into v_message;

    if not found then
      return jsonb_build_object('ok',false,'reason','message_not_found');
    end if;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,v_message.recipient_id,
      'conference_private_message_deleted',
      jsonb_build_object('message_id',v_message.id)
    );

    return jsonb_build_object('ok',true,'message',to_jsonb(v_message));
  elsif v_action='read' then
    update public.conference_private_messages
    set read_at=coalesce(read_at,clock_timestamp()),
        updated_at=case
          when read_at is null then clock_timestamp()
          else updated_at
        end
    where room_id=p_room_id
      and sender_id=p_peer_user_id
      and recipient_id=p_actor_user_id
      and read_at is null
      and not is_deleted;

    get diagnostics v_updated=row_count;

    return jsonb_build_object(
      'ok',true,'updated_count',v_updated
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.apply_conference_private_chat_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_message_id uuid default null,
  p_peer_user_id uuid default null,
  p_body text default null,
  p_reply_to_id uuid default null
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.apply_conference_private_chat_action(
    p_room_id,p_actor_user_id,p_action,p_message_id,
    p_peer_user_id,p_body,p_reply_to_id
  )
$$;

revoke execute on function private.apply_conference_private_chat_action(
  uuid,uuid,text,uuid,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function private.apply_conference_private_chat_action(
  uuid,uuid,text,uuid,uuid,text,uuid
) to service_role;

revoke execute on function public.apply_conference_private_chat_action(
  uuid,uuid,text,uuid,uuid,text,uuid
) from public,anon,authenticated;
grant execute on function public.apply_conference_private_chat_action(
  uuid,uuid,text,uuid,uuid,text,uuid
) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_private_messages'
  ) then
    alter publication supabase_realtime
      add table public.conference_private_messages;
  end if;
end
$$;

notify pgrst,'reload schema';
