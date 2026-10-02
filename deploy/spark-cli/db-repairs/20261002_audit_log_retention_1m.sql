-- Audit log retention: keep general audit events for at most one calendar month.
-- Manual DB repair; not executed by Database -> Update Supabase.

create extension if not exists pg_cron;

drop policy if exists "Admins can delete all audit_log" on public.audit_log;
create policy "Admins can delete all audit_log"
on public.audit_log
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
  where jobname = 'spark-audit-log-retention-1m'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end
$do$;

select cron.schedule(
  'spark-audit-log-retention-1m',
  '* * * * *',
  $cron$
    delete from public.audit_log
    where created_at < now() - interval '1 month';
  $cron$
);

delete from public.audit_log
where created_at < now() - interval '1 month';

notify pgrst, 'reload schema';
