do $$
declare
  table_name text;
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    raise exception 'supabase_realtime publication does not exist';
  end if;

  foreach table_name in array array[
    'chat_messages',
    'chat_conversations',
    'chat_message_reactions',
    'chat_message_read_receipts',
    'user_presence'
  ]
  loop
    if to_regclass(format('public.%I', table_name)) is not null
       and not exists (
         select 1
         from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = table_name
       ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end
$$;
