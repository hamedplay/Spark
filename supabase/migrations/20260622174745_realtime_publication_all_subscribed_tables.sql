-- Add all tables that have client-side realtime subscriptions to supabase_realtime publication.
-- Previously only 'notifications' was in the publication, causing all other subscriptions to silently fail.

ALTER PUBLICATION supabase_realtime ADD TABLE
  -- Channels
  channels,
  channel_members,
  channel_messages,
  channel_message_reactions,
  channel_message_stars,
  channel_group_tasks,
  channel_group_task_assignments,
  channel_group_task_activities,
  -- Chat
  chat_conversations,
  chat_messages,
  chat_message_reactions,
  chat_message_read_receipts,
  user_presence,
  -- Meetings / Calendar
  meetings,
  meeting_inbox,
  participants,
  actions,
  shared_meetings,
  calendars,
  calendar_subscriptions,
  all_day_events,
  -- Tasks & Notes
  tasks,
  notes,
  -- Video Conference
  conference_rooms,
  conference_participants,
  conference_polls,
  conference_poll_votes,
  conference_whiteboard,
  -- Misc
  call_sessions,
  system_config;
