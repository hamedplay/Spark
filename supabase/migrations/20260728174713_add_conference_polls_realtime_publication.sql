-- Add conference_polls and conference_poll_votes to Supabase Realtime publication
-- so that PollPanel realtime subscriptions receive INSERT/UPDATE/DELETE events.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conference_polls'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conference_polls;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'conference_poll_votes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.conference_poll_votes;
  END IF;
END $$;
