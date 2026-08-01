/*
# Add independent retry counters for notification and SMS channels
# Old attempt_count is kept for compatibility but retry decisions use the new columns
*/

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS notification_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.notification_outbox
  ADD COLUMN IF NOT EXISTS sms_attempt_count integer NOT NULL DEFAULT 0;
