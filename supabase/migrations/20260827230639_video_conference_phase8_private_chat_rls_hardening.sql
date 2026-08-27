drop policy if exists "conference_private_messages_participants_read"
on public.conference_private_messages;

drop policy if exists "conference_private_messages_party_select"
on public.conference_private_messages;

create policy "conference_private_messages_party_select"
on public.conference_private_messages
for select
to authenticated
using (
  (
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

drop policy if exists "conference_private_messages_full_auth_boundary"
on public.conference_private_messages;

create policy "conference_private_messages_full_auth_boundary"
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

notify pgrst,'reload schema';
