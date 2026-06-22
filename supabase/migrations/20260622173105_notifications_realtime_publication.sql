-- Add notifications table to Supabase Realtime publication
-- This is required for INSERT/UPDATE real-time events to reach the client
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
