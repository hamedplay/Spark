-- Keep privileged implementations private; public API wrappers retain the same signatures.
alter function public.create_meeting_series(uuid,jsonb,jsonb,text) set schema private;
alter function public.get_recurring_notification_policy() set schema private;
alter function public.set_recurring_notification_policy(jsonb) set schema private;
create function public.create_meeting_series(p_operation_id uuid,p_records jsonb,p_agenda jsonb default '[]',p_pattern text default '') returns uuid[] language sql security invoker set search_path='' as $$ select private.create_meeting_series(p_operation_id,p_records,p_agenda,p_pattern); $$;
create function public.get_recurring_notification_policy() returns jsonb language sql security invoker set search_path='' as $$ select private.get_recurring_notification_policy(); $$;
create function public.set_recurring_notification_policy(p_policy jsonb) returns void language sql security invoker set search_path='' as $$ select private.set_recurring_notification_policy(p_policy); $$;
revoke all on function public.create_meeting_series(uuid,jsonb,jsonb,text),public.get_recurring_notification_policy(),public.set_recurring_notification_policy(jsonb) from public,anon;
grant execute on function public.create_meeting_series(uuid,jsonb,jsonb,text),public.get_recurring_notification_policy(),public.set_recurring_notification_policy(jsonb) to authenticated;
create index if not exists meetings_managed_reminder_date_idx on public.meetings(private.meeting_local_date(request_date)) where series_id is not null and reminder_minutes between 1 and 10080;
notify pgrst,'reload schema';
