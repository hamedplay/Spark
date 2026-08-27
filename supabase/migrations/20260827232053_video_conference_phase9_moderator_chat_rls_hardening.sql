create or replace function private.can_access_conference_moderator_chat(
  p_room_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    p_user_id is not null
    and private.has_conference_permission(
      p_room_id,'ACCESS_MODERATOR_CHAT',p_user_id
    )
    and exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id
        and p.user_id=p_user_id
        and p.status='joined'
    )
$$;

revoke execute on function private.can_access_conference_moderator_chat(
  uuid,uuid
) from public,anon;

grant execute on function private.can_access_conference_moderator_chat(
  uuid,uuid
) to authenticated,service_role;

drop policy if exists "conference_moderator_messages_member_select"
on public.conference_moderator_messages;

create policy "conference_moderator_messages_member_select"
on public.conference_moderator_messages
for select
to authenticated
using (
  private.can_access_conference_moderator_chat(
    conference_moderator_messages.room_id,
    (select auth.uid())
  )
);

drop policy if exists "conference_moderator_messages_auth_boundary"
on public.conference_moderator_messages;

create policy "conference_moderator_messages_auth_boundary"
on public.conference_moderator_messages
as restrictive
for select
to authenticated
using (
  (select private.is_current_session_fully_authorized())
  and private.can_access_conference_moderator_chat(
    conference_moderator_messages.room_id,
    (select auth.uid())
  )
);

notify pgrst,'reload schema';
