-- Legacy mesh collaboration remains on the same data invalidation path.
do $$
declare t text;
begin
 foreach t in array array['conference_whiteboard','pending_approvals','banned_users'] loop
  if to_regclass(format('public.%I',t)) is null then raise exception 'Missing live-data source: %',t; end if;
  if not exists(select 1 from pg_trigger where tgrelid=to_regclass(format('public.%I',t)) and tgname='spark_live_data_change' and not tgisinternal) then
   execute format('create trigger spark_live_data_change after insert or update or delete on public.%I for each statement execute function private.broadcast_app_data_change()',t);
  end if;
 end loop;
end $$;
