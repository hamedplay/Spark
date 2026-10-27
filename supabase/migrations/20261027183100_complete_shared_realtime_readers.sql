-- Metadata-only invalidation: RLS/RPCs still authorize every subsequent read.
do $$
declare t record; target regclass;
begin
 for t in select * from (values
 ('public','conference_rooms'),
 ('public','conference_participants'),
 ('public','conference_messages'),
 ('public','conference_message_reactions'),
 ('public','conference_message_mentions'),
 ('public','conference_recordings'),
 ('public','conference_recording_consents'),
 ('public','conference_waiting_room'),
 ('public','conference_speaker_sessions'),
 ('public','conference_spotlights'),
 ('public','conference_polls'),
 ('public','conference_poll_options'),
 ('public','conference_poll_votes'),
 ('public','conference_private_messages'),
 ('public','conference_moderator_messages'),
 ('public','conference_presentations'),
 ('public','conference_presentation_state'),
 ('public','conference_presentation_annotations'),
 ('public','conference_whiteboard_pages'),
 ('public','conference_whiteboard_boards'),
 ('private','conference_role_assignments'),
 ('private','conference_role_permissions'),
 ('private','conference_permissions'),
 ('private','conference_rbac_roles'),
 ('public','user_presence'),
 ('public','call_sessions'),
 ('private','chat_call_history_hidden'),
 ('public','chat_message_read_log')) as sources(schema_name,table_name) loop
  target:=to_regclass(format('%I.%I',t.schema_name,t.table_name));
  if target is null then raise exception 'Missing live-data source: %.%',t.schema_name,t.table_name; end if;
  if not exists(select 1 from pg_trigger where tgrelid=target and tgname='spark_live_data_change' and not tgisinternal) then
   execute format('create trigger spark_live_data_change after insert or update or delete on %I.%I for each statement execute function private.broadcast_app_data_change()',t.schema_name,t.table_name);
  end if;
 end loop;
end $$;
