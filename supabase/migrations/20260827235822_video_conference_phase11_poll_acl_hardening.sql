alter function private.conference_poll_effective_status(text,timestamptz)
  volatile;
alter function private.get_conference_poll_snapshot(uuid,uuid)
  volatile;
alter function public.get_conference_poll_snapshot(uuid)
  volatile;

revoke execute on function private.conference_poll_effective_status(
  text,timestamptz
) from public,anon,authenticated;
grant execute on function private.conference_poll_effective_status(
  text,timestamptz
) to service_role;

revoke execute on function private.can_manage_conference_poll(
  uuid,uuid,uuid
) from public,anon,authenticated;
grant execute on function private.can_manage_conference_poll(
  uuid,uuid,uuid
) to service_role;

revoke execute on function private.get_conference_poll_snapshot(
  uuid,uuid
) from public,anon;
grant execute on function private.get_conference_poll_snapshot(
  uuid,uuid
) to authenticated,service_role;

revoke execute on function private.conference_poll_action_allowed(
  uuid,uuid,text,uuid
) from public,anon;
grant execute on function private.conference_poll_action_allowed(
  uuid,uuid,text,uuid
) to authenticated,service_role;

notify pgrst,'reload schema';
