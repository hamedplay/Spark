-- A deletion broadcasts only an ID to the recipient's authenticated private
-- channel. Never subscribe clients to unfiltered cross-user DELETE payloads.
create function private.broadcast_notification_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform realtime.send(jsonb_build_object('id', old.id), 'notification_deleted',
    'notification-deletes:' || old.user_id::text, true);
  return old;
end;
$$;
revoke all on function private.broadcast_notification_deletion() from public, anon, authenticated;
create trigger notifications_broadcast_deletion
  after delete on public.notifications
  for each row execute function private.broadcast_notification_deletion();

create policy notification_deletion_receive_own
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and (select realtime.topic()) = 'notification-deletes:' || (select auth.uid())::text
  and (select private.is_current_session_fully_authorized())
);
-- No client INSERT policy: deletion broadcasts must originate on the server.
