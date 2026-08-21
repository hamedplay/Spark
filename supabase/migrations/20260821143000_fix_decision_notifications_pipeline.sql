-- Repair decision notification rendering, existing broken decision messages,
-- and the hosted scheduler jobs required to deliver decision notifications.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Canonical in-app templates use the resolver's {{placeholder}} syntax.
update public.notification_templates
set
  title = case event_type
    when 'decision_assigned' then 'مصوبه جدید به شما محول شد'
    when 'decision_completed' then 'تکمیل مصوبه'
    when 'decision_due_soon' then 'نزدیک‌شدن سررسید'
    when 'decision_followup' then 'ثبت پیگیری'
    when 'decision_followup_due' then 'موعد پیگیری مصوبه'
    when 'decision_obstacle' then 'ثبت مانع'
    when 'decision_obstacle_resolved' then 'رفع مانع'
    when 'decision_overdue' then 'عبور از مهلت'
    when 'decision_progress_updated' then 'به‌روزرسانی پیشرفت'
    when 'decision_reopened' then 'بازگشایی مصوبه'
    when 'decision_status_changed' then 'تغییر وضعیت مصوبه'
    else title
  end,
  body = case event_type
    when 'decision_assigned' then 'مصوبه «{{decision_title}}» از صورت‌جلسه «{{minute_title}}» برای پیگیری و اقدام به شما محول شد. لطفاً وضعیت آن را در بخش «مصوبات من» پیگیری کنید.'
    when 'decision_completed' then 'مصوبه «{{decision_title}}» تکمیل شد.'
    when 'decision_due_soon' then 'سررسید مصوبه «{{decision_title}}» نزدیک است. لطفاً وضعیت آن را بررسی کنید.'
    when 'decision_followup' then 'برای مصوبه «{{decision_title}}» یک پیگیری جدید ثبت شد.'
    when 'decision_followup_due' then 'زمان پیگیری مصوبه «{{decision_title}}» فرا رسیده است.'
    when 'decision_obstacle' then 'برای مصوبه «{{decision_title}}» مانع «{{obstacle_title}}» ثبت شد.'
    when 'decision_obstacle_resolved' then 'مانع مصوبه «{{decision_title}}» رفع شد.'
    when 'decision_overdue' then 'مهلت مصوبه «{{decision_title}}» سپری شده است. لطفاً وضعیت آن را بررسی کنید.'
    when 'decision_progress_updated' then 'پیشرفت مصوبه «{{decision_title}}» به {{decision_progress}}٪ به‌روزرسانی شد.'
    when 'decision_reopened' then 'مصوبه «{{decision_title}}» برای ادامه پیگیری بازگشایی شد.'
    when 'decision_status_changed' then 'وضعیت مصوبه «{{decision_title}}» به‌روزرسانی شد.'
    else body
  end,
  updated_at = now()
where category = 'decision'
  and event_type in (
    'decision_assigned',
    'decision_completed',
    'decision_due_soon',
    'decision_followup',
    'decision_followup_due',
    'decision_obstacle',
    'decision_obstacle_resolved',
    'decision_overdue',
    'decision_progress_updated',
    'decision_reopened',
    'decision_status_changed'
  );

-- SMS templates use the same canonical double-brace renderer contract.
update public.sms_templates
set
  body = case event_type
    when 'decision_assigned' then 'مصوبه «{{decision_title}}» به شما محول شد. لطفاً در بخش «مصوبات من» پیگیری کنید.'
    when 'decision_completed' then 'مصوبه «{{decision_title}}» تکمیل شد.'
    when 'decision_due_soon' then 'سررسید مصوبه «{{decision_title}}» نزدیک است.'
    when 'decision_followup' then 'برای مصوبه «{{decision_title}}» یک پیگیری جدید ثبت شد.'
    when 'decision_followup_due' then 'زمان پیگیری مصوبه «{{decision_title}}» فرا رسیده است.'
    when 'decision_obstacle' then 'برای مصوبه «{{decision_title}}» مانع «{{obstacle_title}}» ثبت شد.'
    when 'decision_obstacle_resolved' then 'مانع مصوبه «{{decision_title}}» رفع شد.'
    when 'decision_overdue' then 'مهلت مصوبه «{{decision_title}}» سپری شده است.'
    when 'decision_progress_updated' then 'پیشرفت مصوبه «{{decision_title}}» به {{decision_progress}}٪ به‌روزرسانی شد.'
    when 'decision_reopened' then 'مصوبه «{{decision_title}}» برای ادامه پیگیری بازگشایی شد.'
    when 'decision_status_changed' then 'وضعیت مصوبه «{{decision_title}}» به‌روزرسانی شد.'
    else body
  end,
  updated_at = now()
where category = 'decision'
  and event_type in (
    'decision_assigned',
    'decision_completed',
    'decision_due_soon',
    'decision_followup',
    'decision_followup_due',
    'decision_obstacle',
    'decision_obstacle_resolved',
    'decision_overdue',
    'decision_progress_updated',
    'decision_reopened',
    'decision_status_changed'
  );

-- Repair already-created in-app decision notifications that contain the legacy
-- single-brace placeholders. This changes presentation only; it does not
-- enqueue or resend historical notifications.
update public.notifications n
set
  title = case n.template_event_type
    when 'decision_assigned' then 'مصوبه جدید به شما محول شد'
    when 'decision_completed' then 'تکمیل مصوبه'
    when 'decision_due_soon' then 'نزدیک‌شدن سررسید'
    when 'decision_followup' then 'ثبت پیگیری'
    when 'decision_followup_due' then 'موعد پیگیری مصوبه'
    when 'decision_obstacle' then 'ثبت مانع'
    when 'decision_obstacle_resolved' then 'رفع مانع'
    when 'decision_overdue' then 'عبور از مهلت'
    when 'decision_progress_updated' then 'به‌روزرسانی پیشرفت'
    when 'decision_reopened' then 'بازگشایی مصوبه'
    when 'decision_status_changed' then 'تغییر وضعیت مصوبه'
    else n.title
  end,
  message = case n.template_event_type
    when 'decision_assigned' then
      'مصوبه «' || (n.metadata->>'decision_title') || '»' ||
      case
        when nullif(btrim(coalesce(n.metadata->>'minute_title', '')), '') is not null
          then ' از صورت‌جلسه «' || (n.metadata->>'minute_title') || '»'
        else ''
      end ||
      ' برای پیگیری و اقدام به شما محول شد. لطفاً وضعیت آن را در بخش «مصوبات من» پیگیری کنید.'
    when 'decision_completed' then 'مصوبه «' || (n.metadata->>'decision_title') || '» تکمیل شد.'
    when 'decision_due_soon' then 'سررسید مصوبه «' || (n.metadata->>'decision_title') || '» نزدیک است. لطفاً وضعیت آن را بررسی کنید.'
    when 'decision_followup' then 'برای مصوبه «' || (n.metadata->>'decision_title') || '» یک پیگیری جدید ثبت شد.'
    when 'decision_followup_due' then 'زمان پیگیری مصوبه «' || (n.metadata->>'decision_title') || '» فرا رسیده است.'
    when 'decision_obstacle' then 'برای مصوبه «' || (n.metadata->>'decision_title') || '» مانع «' || coalesce(nullif(btrim(n.metadata->>'obstacle_title'), ''), 'جدید') || '» ثبت شد.'
    when 'decision_obstacle_resolved' then 'مانع مصوبه «' || (n.metadata->>'decision_title') || '» رفع شد.'
    when 'decision_overdue' then 'مهلت مصوبه «' || (n.metadata->>'decision_title') || '» سپری شده است. لطفاً وضعیت آن را بررسی کنید.'
    when 'decision_progress_updated' then 'پیشرفت مصوبه «' || (n.metadata->>'decision_title') || '» به ' || coalesce(n.metadata->>'decision_progress', '') || '٪ به‌روزرسانی شد.'
    when 'decision_reopened' then 'مصوبه «' || (n.metadata->>'decision_title') || '» برای ادامه پیگیری بازگشایی شد.'
    when 'decision_status_changed' then 'وضعیت مصوبه «' || (n.metadata->>'decision_title') || '» به‌روزرسانی شد.'
    else n.message
  end
where n.entity_type = 'decision'
  and n.template_event_type in (
    'decision_assigned',
    'decision_completed',
    'decision_due_soon',
    'decision_followup',
    'decision_followup_due',
    'decision_obstacle',
    'decision_obstacle_resolved',
    'decision_overdue',
    'decision_progress_updated',
    'decision_reopened',
    'decision_status_changed'
  )
  and nullif(btrim(coalesce(n.metadata->>'decision_title', '')), '') is not null;

-- Hosted scheduler credentials are runtime data, not source credentials.
-- Keep only the current project URL and a generated cron secret in Vault.
do $$
declare
  v_secret_id uuid;
begin
  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'cron_secret'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret used only by database cron to call scheduler-dispatch'
    );
  end if;

  select id into v_secret_id
  from vault.decrypted_secrets
  where name = 'scheduler_base_url'
  limit 1;

  if v_secret_id is null then
    perform vault.create_secret(
      'https://gmbocjrgaibyiadlmrgh.supabase.co',
      'scheduler_base_url',
      'Base URL used by the hosted Spark database scheduler'
    );
  else
    perform vault.update_secret(
      v_secret_id,
      'https://gmbocjrgaibyiadlmrgh.supabase.co',
      'scheduler_base_url',
      'Base URL used by the hosted Spark database scheduler'
    );
  end if;
end;
$$;

-- Remove only the scheduler jobs that belong to the decision-notification path.
do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in (
      'spark-hosted-notification-outbox',
      'spark-hosted-minutes-reminders',
      'spark-hosted-decision-due'
    )
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'spark-hosted-notification-outbox',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'scheduler_base_url') || '/functions/v1/scheduler-dispatch',
      body := '{"task":"notification_outbox"}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
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
        'X-Cron-Secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 125000
    ) as request_id;
  $job$
);
