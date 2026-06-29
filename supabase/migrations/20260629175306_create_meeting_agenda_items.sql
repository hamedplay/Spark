CREATE TABLE IF NOT EXISTS meeting_agenda_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  presenter TEXT,
  duration_minutes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE meeting_agenda_items ENABLE ROW LEVEL SECURITY;

-- Select: authenticated users who can see the meeting can see its agenda
CREATE POLICY "select_agenda_items" ON meeting_agenda_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = meeting_agenda_items.meeting_id
        AND (
          meetings.user_id = auth.uid()
          OR auth.uid() = ANY(meetings.participant_user_ids)
          OR auth.uid() = ANY(meetings.notify_users)
        )
    )
  );

-- Insert: only the meeting creator
CREATE POLICY "insert_agenda_items" ON meeting_agenda_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = meeting_agenda_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- Update: only the meeting creator
CREATE POLICY "update_agenda_items" ON meeting_agenda_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = meeting_agenda_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );

-- Delete: only the meeting creator
CREATE POLICY "delete_agenda_items" ON meeting_agenda_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM meetings
      WHERE meetings.id = meeting_agenda_items.meeting_id
        AND meetings.user_id = auth.uid()
    )
  );
