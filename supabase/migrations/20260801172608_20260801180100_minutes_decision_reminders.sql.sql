/*
# Minutes decision reminders table

1. New Tables
- `minutes_decision_reminders`
  - id (uuid PK)
  - decision_id (uuid FK to minutes_decisions)
  - minute_id (uuid FK to minutes)
  - recipient_user_id (uuid FK to auth.users)
  - remind_at (timestamptz, when to send the reminder)
  - status (text: pending, processing, sent, partial, failed, cancelled)
  - notification_sent_at (timestamptz null)
  - sms_sent_at (timestamptz null)
  - created_by_user_id (uuid FK to auth.users)
  - created_at (timestamptz default now())
  - updated_at (timestamptz default now())
  - cancelled_at (timestamptz null)
  - source_update_id (uuid null, FK to minutes_decision_updates)

2. Indexes
- idx_reminders_status_remind_at on (status, remind_at) — for scheduler lookup
- idx_reminders_recipient_status on (recipient_user_id, status)
- idx_reminders_decision on (decision_id)
- A partial unique index to prevent duplicate pending reminders per decision+recipient

3. Security
- RLS enabled
- SELECT: recipient or creator can see their reminders
- INSERT: authenticated users can create reminders for themselves
- UPDATE: only recipient or creator can update/cancel
- DELETE: only recipient or creator can delete

4. Notes
- Idempotent: uses IF NOT EXISTS
- No data migration needed; table starts empty
- Scheduler edge function will poll for pending reminders
*/

CREATE TABLE IF NOT EXISTS public.minutes_decision_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid NOT NULL REFERENCES public.minutes_decisions(id) ON DELETE CASCADE,
  minute_id uuid NOT NULL REFERENCES public.minutes(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  remind_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'partial', 'failed', 'cancelled')),
  notification_sent_at timestamptz,
  sms_sent_at timestamptz,
  created_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  source_update_id uuid REFERENCES public.minutes_decision_updates(id) ON DELETE SET NULL
);

-- Indexes for scheduler and per-user queries
CREATE INDEX IF NOT EXISTS idx_reminders_status_remind_at
  ON public.minutes_decision_reminders (status, remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_recipient_status
  ON public.minutes_decision_reminders (recipient_user_id, status);
CREATE INDEX IF NOT EXISTS idx_reminders_decision
  ON public.minutes_decision_reminders (decision_id);

-- Prevent duplicate pending reminders for the same decision + recipient
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_reminder_per_decision_recipient
  ON public.minutes_decision_reminders (decision_id, recipient_user_id)
  WHERE status = 'pending';

-- Enable RLS
ALTER TABLE public.minutes_decision_reminders ENABLE ROW LEVEL SECURITY;

-- Policies: recipient or creator can access
DROP POLICY IF EXISTS "select_own_reminders" ON public.minutes_decision_reminders;
CREATE POLICY "select_own_reminders"
  ON public.minutes_decision_reminders FOR SELECT
  TO authenticated
  USING (auth.uid() = recipient_user_id OR auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "insert_own_reminders" ON public.minutes_decision_reminders;
CREATE POLICY "insert_own_reminders"
  ON public.minutes_decision_reminders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = recipient_user_id OR auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "update_own_reminders" ON public.minutes_decision_reminders;
CREATE POLICY "update_own_reminders"
  ON public.minutes_decision_reminders FOR UPDATE
  TO authenticated
  USING (auth.uid() = recipient_user_id OR auth.uid() = created_by_user_id)
  WITH CHECK (auth.uid() = recipient_user_id OR auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "delete_own_reminders" ON public.minutes_decision_reminders;
CREATE POLICY "delete_own_reminders"
  ON public.minutes_decision_reminders FOR DELETE
  TO authenticated
  USING (auth.uid() = recipient_user_id OR auth.uid() = created_by_user_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_reminders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reminders_updated_at ON public.minutes_decision_reminders;
CREATE TRIGGER trg_reminders_updated_at
  BEFORE UPDATE ON public.minutes_decision_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_reminders_updated_at();
