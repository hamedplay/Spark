-- Old decision events can outlive both their decision and minute after source data
-- is removed. They can never satisfy notifications' foreign keys, so retrying them
-- indefinitely only creates scheduler noise. Mark only fully orphaned decision
-- events as terminally processed; valid/retryable rows are untouched.

update public.notification_outbox as o
set status = 'processed',
    notification_status = 'skipped_entity_missing',
    processed_at = now(),
    next_attempt_at = null,
    last_error = 'TERMINAL_SKIPPED: referenced decision/minute no longer exists'
where o.entity_type = 'decision'
  and o.status in ('pending', 'processing', 'partial', 'failed')
  and o.notification_status = 'failed'
  and o.entity_id is not null
  and o.minute_id is not null
  and not exists (
    select 1
    from public.minutes_decisions as d
    where d.id = o.entity_id
  )
  and not exists (
    select 1
    from public.minutes as m
    where m.id = o.minute_id
  );
