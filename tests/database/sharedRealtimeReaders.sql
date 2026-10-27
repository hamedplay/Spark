-- Exercise every installed statement trigger without touching actual user rows.
-- The transaction (including all broadcast messages) is rolled back.
begin;
do $$
declare t record; source regclass; before_count bigint; after_count bigint;
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
 ('public','conference_whiteboard'),
 ('public','pending_approvals'),
 ('public','banned_users'),
 ('public','user_presence'),
 ('public','call_sessions'),
 ('private','chat_call_history_hidden'),
 ('public','chat_message_read_log')) as sources(schema_name,table_name) loop
  source:=to_regclass(format('%I.%I',t.schema_name,t.table_name));
  assert exists(select 1 from pg_trigger where tgrelid=source and tgname='spark_live_data_change' and tgenabled='O' and (tgtype & 1)=0),'enabled statement trigger required';
  select count(*) into before_count from realtime.messages where topic='app-data-changes' and event='data_changed' and private and payload->>'table'=t.table_name;
  execute format('delete from %I.%I where false',t.schema_name,t.table_name);
  select count(*) into after_count from realtime.messages where topic='app-data-changes' and event='data_changed' and private and payload->>'table'=t.table_name;
  assert after_count=before_count+1,'shared broadcast must be emitted once for '||t.table_name;
  assert not exists(select 1 from realtime.messages where topic='app-data-changes' and event='data_changed' and payload->>'table'=t.table_name and payload-'table'-'id'<>'{}'::jsonb),'no row content or identity in broadcast';
 end loop;
end $$;
rollback;
