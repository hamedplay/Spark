-- Restore the Postgres Changes fallback used by organizational chat calls.
-- The primary ring notification uses Realtime Broadcast, while this publication
-- entry ensures the callee can also discover a newly inserted call session.

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end
$$;
