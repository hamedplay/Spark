create index if not exists conference_messages_reply_to_idx
  on public.conference_messages(reply_to_id)
  where reply_to_id is not null;

drop policy if exists "Room participants can read messages"
on public.conference_messages;

create policy "Room participants can read messages"
on public.conference_messages
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

notify pgrst,'reload schema';
