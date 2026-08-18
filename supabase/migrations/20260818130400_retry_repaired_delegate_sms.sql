-- The minute_approval_delegate_assigned SMS could not render because its
-- recipient_greeting placeholder was absent. After the worker-side enrichment
-- fix, make only affected retryable rows immediately eligible for one normal
-- outbox retry instead of waiting for the previous exponential-backoff window.

update public.notification_outbox
set next_attempt_at = now()
where status = 'partial'
  and notification_status = 'sent'
  and sms_status = 'failed'
  and event_key = 'minute_approval_delegate_assigned'
  and sms_attempt_count < 5;
