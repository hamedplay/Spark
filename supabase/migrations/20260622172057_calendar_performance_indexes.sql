-- Index on meetings for calendar range queries
CREATE INDEX IF NOT EXISTS idx_meetings_request_date ON meetings (request_date);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings (status);
CREATE INDEX IF NOT EXISTS idx_meetings_user_id ON meetings (user_id);
CREATE INDEX IF NOT EXISTS idx_meetings_participant_user_ids ON meetings USING GIN (participant_user_ids);

-- Index for meeting_inbox lookups
CREATE INDEX IF NOT EXISTS idx_meeting_inbox_user_id ON meeting_inbox (user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_inbox_meeting_id ON meeting_inbox (meeting_id);

-- Index for all_day_events range queries
CREATE INDEX IF NOT EXISTS idx_all_day_events_date ON all_day_events (date_jy, date_jm, date_jd);
CREATE INDEX IF NOT EXISTS idx_all_day_events_user_id ON all_day_events (user_id);

-- Index for calendars lookup
CREATE INDEX IF NOT EXISTS idx_calendars_user_id ON calendars (user_id);

-- Index for calendar_subscriptions
CREATE INDEX IF NOT EXISTS idx_calendar_subscriptions_user_id ON calendar_subscriptions (user_id);
