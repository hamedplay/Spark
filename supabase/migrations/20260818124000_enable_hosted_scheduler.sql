-- Hosted Spark scheduler: pg_cron + pg_net -> scheduler-dispatch.
-- The per-environment cron secret is generated inside Vault and is never stored in source.
-- Self-hosted production may keep using the systemd timers in deploy/production; the
-- scheduler base URL remains a Vault value so it can be replaced per environment.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Generate the shared dispatcher secret once per database.
do $$
begin
  if not exists (
    select 1 from vault.decrypted_secrets where name = 'cron_secret'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret used only by database cron to call scheduler-dispatch'
    );
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'scheduler_base_url'
  ) then
    perform vault.create_secret(
      'https://icpgvfadixevdjtkllap.supabase.co',
      'scheduler_base_url',
      'Base URL used by the hosted Spark database scheduler'
    );
  end if;

  if not exists (
    select 1 from vault.decrypted_secrets where name = 'scheduler_publishable_key'
  ) then
    perform vault.create_secret(
      'sb_publishable_MVpE0R-QlGSqp3y_IwxJIg_AWELmfUh',
      'scheduler_publishable_key',
      'Public API key used by pg_net when invoking scheduler-dispatch'
    );
  end if;
end;
$$;

-- Harden the existing Vault verifier. Only service_role may execute it.
create or replace function public.verify_cron_secret(candidate text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    candidate is not null
    and length(candidate) >= 32
    and exists (
      select 1
      from vault.decrypted_secrets s
      where s.name = 'cron_secret'
        and extensions.digest(s.decrypted_secret, 'sha256') = extensions.digest(candidate, 'sha256')
    );
$$;

revoke all on function public.verify_cron_secret(text) from public;
revoke all on function public.verify_cron_secret(text) from anon;
revoke all on function public.verify_cron_secret(text) from authenticated;
grant execute on function public.verify_cron_secret(text) to service_role;

-- Remove portal logo references only when the referenced object is actually absent.
update public.system_config sc
set value = ''
where sc.key in ('logo_url', 'mobile_logo_url')
  and coalesce(sc.value, '') <> ''
  and position('/portal-assets/' in sc.value) > 0
  and not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'portal-assets'
      and o.name = split_part(sc.value, '/portal-assets/', 2)
  );

-- Each job invokes the small dispatcher. The dispatcher authenticates the Vault
-- secret and then calls the existing worker with its existing worker-specific secret.
select cron.schedule(
  'spark-hosted-notification-outbox',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_base_url') || '/functions/v1/scheduler-dispatch',
      body := '{"task":"notification_outbox"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_publishable_key'),
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 125000
    ) as request_id;
  $job$
);

select cron.schedule(
  'spark-hosted-minutes-reminders',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_base_url') || '/functions/v1/scheduler-dispatch',
      body := '{"task":"minutes_reminders"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_publishable_key'),
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 125000
    ) as request_id;
  $job$
);

select cron.schedule(
  'spark-hosted-decision-due',
  '*/10 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_base_url') || '/functions/v1/scheduler-dispatch',
      body := '{"task":"decision_due_overdue"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_publishable_key'),
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 125000
    ) as request_id;
  $job$
);

select cron.schedule(
  'spark-hosted-daily-report',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_base_url') || '/functions/v1/scheduler-dispatch',
      body := '{"task":"daily_report"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_publishable_key'),
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 125000
    ) as request_id;
  $job$
);
