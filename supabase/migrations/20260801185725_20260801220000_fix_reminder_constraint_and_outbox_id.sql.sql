/*
# 1. Fix reminder status constraint to include 'queued'
# 2. Add outbox_id column to minutes_decision_reminders
*/

-- Replace status check constraint to include 'queued'
ALTER TABLE public.minutes_decision_reminders DROP CONSTRAINT IF EXISTS minutes_decision_reminders_status_check;
ALTER TABLE public.minutes_decision_reminders ADD CONSTRAINT minutes_decision_reminders_status_check
  CHECK (status = ANY (ARRAY['pending', 'processing', 'queued', 'sent', 'partial', 'failed', 'cancelled']));

-- Add outbox_id column for traceable reminder↔outbox sync
ALTER TABLE public.minutes_decision_reminders ADD COLUMN IF NOT EXISTS outbox_id uuid;
ALTER TABLE public.minutes_decision_reminders
  DROP CONSTRAINT IF EXISTS minutes_decision_reminders_outbox_id_fkey;
ALTER TABLE public.minutes_decision_reminders
  ADD CONSTRAINT minutes_decision_reminders_outbox_id_fkey
  FOREIGN KEY (outbox_id) REFERENCES public.notification_outbox(id) ON DELETE SET NULL;
