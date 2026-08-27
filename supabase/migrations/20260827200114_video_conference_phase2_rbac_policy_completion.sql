create or replace function private.claim_conference_presenter(p_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if auth.uid() is null
     or not private.has_conference_permission(p_room_id,'PUBLISH_SCREEN',auth.uid())
     or not exists(
       select 1 from public.conference_participants p
       where p.room_id=p_room_id and p.user_id=auth.uid() and p.status='joined'
     ) then
    return false;
  end if;

  if not exists(
    select 1 from public.conference_rooms r
    where r.id=p_room_id and r.status<>'ended' and r.allow_screen_share
  ) then
    return false;
  end if;

  update public.conference_rooms
  set presenter_user_id=auth.uid(),pinned_user_id=auth.uid()
  where id=p_room_id;

  update public.conference_participants
  set is_screen_sharing=true
  where room_id=p_room_id and user_id=auth.uid();

  return found;
end;
$$;

revoke execute on function private.claim_conference_presenter(uuid) from public,anon;
grant execute on function private.claim_conference_presenter(uuid) to authenticated,service_role;

drop policy if exists "owner_can_delete_own_stroke" on public.conference_whiteboard;
create policy "owner_can_delete_own_stroke"
on public.conference_whiteboard
for delete
to authenticated
using (
  (select auth.uid())=user_id
  and private.has_conference_permission(room_id,'USE_WHITEBOARD')
);

notify pgrst,'reload schema';
