-- Keep channel read markers and personal pins synchronized across devices.
create trigger spark_live_data_change after insert or update or delete or truncate
on public.channel_message_private_pins for each statement
execute function private.broadcast_app_data_change();

create trigger spark_live_data_change after insert or update or delete or truncate
on public.channel_message_read_log for each statement
execute function private.broadcast_app_data_change();
