do $$
begin
  if not exists(
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_whiteboard_boards'
  ) then
    alter publication supabase_realtime
      add table public.conference_whiteboard_boards;
  end if;

  if not exists(
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_whiteboard_pages'
  ) then
    alter publication supabase_realtime
      add table public.conference_whiteboard_pages;
  end if;
end
$$;

notify pgrst,'reload schema';
