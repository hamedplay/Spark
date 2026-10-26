-- History visibility is personal. Keep call/signalling records and the other
-- participant's history intact, and never hide an active/ringing call.
create table private.chat_call_history_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, call_id)
);
create index chat_call_history_hidden_call_idx on private.chat_call_history_hidden(call_id);
alter table private.chat_call_history_hidden enable row level security;
revoke all on private.chat_call_history_hidden from public, anon, authenticated;
grant select on private.chat_call_history_hidden to authenticated;
create policy chat_call_history_hidden_select on private.chat_call_history_hidden
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_current_session_fully_authorized()));

create function private.clear_my_call_history()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null or not coalesce(private.is_current_session_fully_authorized(), false) then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  insert into private.chat_call_history_hidden(user_id, call_id)
  select v_uid, c.id from public.call_sessions c
  where (c.caller_id = v_uid or c.callee_id = v_uid)
    and c.status in ('ended', 'declined', 'missed')
  on conflict (user_id, call_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.clear_my_call_history() from public, anon, authenticated;
grant execute on function private.clear_my_call_history() to authenticated;

create function public.clear_my_call_history()
returns integer language sql security invoker set search_path = '' as $$
  select private.clear_my_call_history();
$$;
revoke all on function public.clear_my_call_history() from public, anon;
grant execute on function public.clear_my_call_history() to authenticated;

create function public.get_my_call_history(p_limit integer default 100)
returns setof public.call_sessions language sql stable security invoker set search_path = '' as $$
  select c.* from public.call_sessions c
  where (c.caller_id = (select auth.uid()) or c.callee_id = (select auth.uid()))
    and c.status in ('ended', 'declined', 'missed')
    and not exists (
      select 1 from private.chat_call_history_hidden h
      where h.user_id = (select auth.uid()) and h.call_id = c.id
    )
  order by c.created_at desc, c.id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
revoke all on function public.get_my_call_history(integer) from public, anon;
grant execute on function public.get_my_call_history(integer) to authenticated;

-- Keep this migration portable to restored/self-hosted databases. Do not change
-- any existing publication options or RLS policies on chat data.
do $$
declare v_table text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime' and not puballtables) then
    foreach v_table in array array['chat_conversations','chat_messages','chat_message_reactions','chat_message_read_receipts','call_sessions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
end;
$$;
