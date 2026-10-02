-- SMS dispatch log retention: keep live operational logs for at most 72 hours.
-- Manual DB repair; not executed by Database -> Update Supabase.

create extension if not exists pg_cron;

do $do$
declare
  v_job_id bigint;
begin
  select jobid
    into v_job_id
  from cron.job
  where jobname = 'spark-sms-dispatch-log-retention-72h'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;
end
$do$;

select cron.schedule(
  'spark-sms-dispatch-log-retention-72h',
  '17 * * * *',
  $cron$
    delete from public.sms_dispatch_logs
    where created_at < now() - interval '72 hours';
  $cron$
);

-- Enforce retention immediately when this repair is first applied.
delete from public.sms_dispatch_logs
where created_at < now() - interval '72 hours';
