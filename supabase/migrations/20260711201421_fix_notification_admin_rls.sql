-- Allow admin users to view all notifications (for admin report/log page)
-- This policy is IN ADDITION to the existing "Users can view own notifications" policy
-- and does NOT replace or weaken it.
CREATE POLICY "Admins can view all notifications"
  ON notifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );

-- Add template tracking columns to notifications table (if not already present)
-- These columns allow tracing which template was used for each notification
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS template_id UUID,
  ADD COLUMN IF NOT EXISTS template_category TEXT,
  ADD COLUMN IF NOT EXISTS template_event_type TEXT,
  ADD COLUMN IF NOT EXISTS template_audience TEXT;

-- Add a unique constraint to prevent duplicate active templates with the same key
-- This ensures deterministic template selection
CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_unique_active
  ON notification_templates (category, event_type, audience)
  WHERE is_active = true;

-- Do the same for SMS templates
CREATE UNIQUE INDEX IF NOT EXISTS sms_templates_unique_active
  ON sms_templates (category, event_type, audience)
  WHERE is_active = true;
