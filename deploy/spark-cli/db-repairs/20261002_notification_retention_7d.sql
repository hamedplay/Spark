-- Notification retention: keep in-app notifications for at most 7 days.
-- Manual DB repair; not executed by Database -> Update Supabase.

create extension if not exists pg_cron;

create index if not exists notifications_created_at_idx
  on public.notifications (created_at);

drop policy if exists "Admins can delete all notifications" on public.notifications;
create policy "Admins can delete all notifications"
on public.notifications
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_admin = true
      and p.is_active is distinct from false
  )
);

do $do$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'spark-notification-retention-7d'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end
$do$;

select cron.schedule(
  'spark-notification-retention-7d',
  '* * * * *',
  $cron$
    delete from public.notifications
    where created_at < now() - interval '7 days';
  $cron$
);

-- Enforce retention immediately when this repair is first applied.
delete from public.notifications
where created_at < now() - interval '7 days';

notify pgrst, 'reload schema';
