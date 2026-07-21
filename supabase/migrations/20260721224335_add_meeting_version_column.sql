/*
# Add version column to meetings table

1. Purpose
   - Adds an additive `version` column to `meetings` for optimistic concurrency and idempotency.
   - Each successful update increments the version, enabling reliable idempotency keys
     of the form `meeting_id:recipient_id:event_type:meeting_version`.
   - This is purely additive — no existing columns or data are modified or removed.

2. Changes
   - `meetings.version` (integer, NOT NULL, DEFAULT 1) — new column.
   - A trigger `meetings_version_increment` increments `version` on every UPDATE.

3. Security
   - No RLS policy changes. Existing policies remain unchanged.
   - The trigger runs with `SECURITY DEFINER` only to ensure the version increments
     regardless of which role updates the row; it does not bypass RLS for the update itself.

4. Rollback
   - DROP TRIGGER IF EXISTS meetings_version_increment ON meetings;
   - DROP FUNCTION IF EXISTS public.increment_meeting_version();
   - ALTER TABLE meetings DROP COLUMN IF EXISTS version;
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'meetings' AND column_name = 'version'
  ) THEN
    ALTER TABLE public.meetings ADD COLUMN version integer NOT NULL DEFAULT 1;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.increment_meeting_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  NEW.version := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS meetings_version_increment ON public.meetings;

CREATE TRIGGER meetings_version_increment
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_meeting_version();