-- Add unique constraint on meeting_inbox (meeting_id, user_id) to prevent duplicate approval records.
-- Verified: no existing duplicates where meeting_id IS NOT NULL.
-- NULL meeting_id rows (orphaned from deleted meetings) remain allowed since NULLs are distinct in Postgres.
ALTER TABLE public.meeting_inbox
  ADD CONSTRAINT meeting_inbox_meeting_user_unique UNIQUE (meeting_id, user_id);