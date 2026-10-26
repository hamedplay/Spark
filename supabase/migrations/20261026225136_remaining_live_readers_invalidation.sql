-- Invalidate read-only inbox, social configuration and conference archive views.
do $$
declare v_table text;
begin
  foreach v_table in array array['social_channel_configs','user_bale_mapping','rahyab_inbox','conference_archives'] loop
    execute format('create trigger spark_live_data_change after insert or update or delete or truncate on public.%I for each statement execute function private.broadcast_app_data_change()', v_table);
  end loop;
end;
$$;
