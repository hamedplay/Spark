drop policy if exists "conference_messages_room_read_boundary"
on public.conference_messages;

create policy "conference_messages_room_read_boundary"
on public.conference_messages
as restrictive
for select
to authenticated
using (
  (select private.is_current_session_fully_authorized())
  and exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_messages.room_id
      and p.user_id=(select auth.uid())
  )
);

drop policy if exists "conference_message_reactions_select"
on public.conference_message_reactions;

create policy "conference_message_reactions_select"
on public.conference_message_reactions
for select to authenticated
using (
  (select private.is_current_session_fully_authorized())
  and exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_message_reactions.room_id
      and p.user_id=(select auth.uid())
  )
);

drop policy if exists "conference_message_mentions_select"
on public.conference_message_mentions;

create policy "conference_message_mentions_select"
on public.conference_message_mentions
for select to authenticated
using (
  (select private.is_current_session_fully_authorized())
  and exists(
    select 1
    from public.conference_participants p
    where p.room_id=conference_message_mentions.room_id
      and p.user_id=(select auth.uid())
  )
);

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

  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  return private.conference_chat_action_allowed(
    p_room_id,auth.uid(),p_action,p_message_id
  );
end;
$$;

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

  if coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.is_current_session_fully_authorized() then
    raise exception using
      errcode='42501',
      message='conference chat session is not fully authorized';
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

notify pgrst,'reload schema';
