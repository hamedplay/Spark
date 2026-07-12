-- ============================================================
-- Migration: Add meeting_confirmed, meeting_declined events
--             and fix representative_assigned templates
-- ============================================================

-- 1. Insert notification templates for meeting_confirmed
INSERT INTO notification_templates (category, event_type, audience, title, body, placeholders, is_active)
VALUES
  ('meeting', 'meeting_confirmed', 'all',
   'تأیید حضور در جلسه «{{meeting_subject}}»',
   '{{recipient_greeting}}، {{participant_name}} حضور خود را در جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} تأیید کرد.',
   ARRAY['recipient_greeting', 'participant_name', 'meeting_subject', 'meeting_date', 'start_time', 'end_time'],
   true)
ON CONFLICT (category, event_type, audience) WHERE is_active = true DO NOTHING;

-- 2. Insert SMS templates for meeting_confirmed
INSERT INTO sms_templates (category, event_type, audience, body, placeholders, is_active)
VALUES
  ('meeting', 'meeting_confirmed', 'all',
   '{{participant_name}} حضور خود را در جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} تأیید کرد.',
   ARRAY['participant_name', 'meeting_subject', 'meeting_date', 'start_time', 'end_time'],
   true)
ON CONFLICT (category, event_type, audience) WHERE is_active = true DO NOTHING;

-- 3. Insert notification templates for meeting_declined
INSERT INTO notification_templates (category, event_type, audience, title, body, placeholders, is_active)
VALUES
  ('meeting', 'meeting_declined', 'all',
   'رد دعوت جلسه «{{meeting_subject}}»',
   '{{recipient_greeting}}، {{participant_name}} دعوت به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} را رد کرد.',
   ARRAY['recipient_greeting', 'participant_name', 'meeting_subject', 'meeting_date', 'start_time', 'end_time'],
   true)
ON CONFLICT (category, event_type, audience) WHERE is_active = true DO NOTHING;

-- 4. Insert SMS templates for meeting_declined
INSERT INTO sms_templates (category, event_type, audience, body, placeholders, is_active)
VALUES
  ('meeting', 'meeting_declined', 'all',
   '{{participant_name}} دعوت به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} را رد کرد.',
   ARRAY['participant_name', 'meeting_subject', 'meeting_date', 'start_time', 'end_time'],
   true)
ON CONFLICT (category, event_type, audience) WHERE is_active = true DO NOTHING;

-- 5. Fix representative_assigned notification template to include all required placeholders
UPDATE notification_templates
SET body = '{{recipient_greeting}}، شما به‌عنوان جانشین {{represented_person_name}} برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} انتخاب شده‌اید. تنظیم‌کننده جلسه: {{organizer_name}}',
    placeholders = ARRAY['recipient_greeting', 'represented_person_name', 'meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'organizer_name']
WHERE category = 'meeting' AND event_type = 'meeting_representative_assigned' AND is_active = true;

-- 6. Fix representative_assigned SMS template to include all required placeholders
UPDATE sms_templates
SET body = '{{recipient_greeting}}

شما به‌عنوان جانشین {{represented_person_name}} برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} انتخاب شده‌اید.

تنظیم‌کننده جلسه: {{organizer_name}}',
    placeholders = ARRAY['recipient_greeting', 'represented_person_name', 'meeting_subject', 'meeting_date', 'start_time', 'end_time', 'location', 'organizer_name']
WHERE category = 'meeting' AND event_type = 'meeting_representative_assigned' AND is_active = true;

-- 7. Fix note:share notification template to use snake_case placeholders
UPDATE notification_templates
SET body = REPLACE(REPLACE(body, '{{senderName}}', '{{sender_name}}'), '{{noteTitle}}', '{{note_title}}'),
    placeholders = ARRAY['sender_name', 'note_title']
WHERE category = 'note' AND event_type = 'share' AND is_active = true;

-- 8. Fix note:share SMS template to use snake_case placeholders
UPDATE sms_templates
SET body = REPLACE(REPLACE(body, '{{senderName}}', '{{sender_name}}'), '{{noteTitle}}', '{{note_title}}'),
    placeholders = ARRAY['sender_name', 'note_title', 'full_name']
WHERE category = 'note' AND event_type = 'share' AND is_active = true;

-- 9. Add channel:mention SMS template (was missing — channel mentions used new_message)
INSERT INTO sms_templates (category, event_type, audience, body, placeholders, is_active)
VALUES
  ('channel', 'mention', 'all',
   '{{sender_name}} شما را در {{channel_type}} {{channel_name}} منشن کرد: {{message_preview}}',
   ARRAY['sender_name', 'channel_name', 'channel_type', 'message_preview'],
   true)
ON CONFLICT (category, event_type, audience) WHERE is_active = true DO NOTHING;

-- 10. Add channel:mention notification template
INSERT INTO notification_templates (category, event_type, audience, title, body, placeholders, is_active)
VALUES
  ('channel', 'mention', 'all',
   '{{sender_name}} شما را منشن کرد',
   '{{sender_name}} شما را در {{channel_type}} {{channel_name}} منشن کرد: {{message_preview}}',
   ARRAY['sender_name', 'channel_name', 'channel_type', 'message_preview'],
   true)
ON CONFLICT (category, event_type, audience) WHERE is_active = true DO NOTHING;

-- 11. Add task:assign notification template with snake_case (fix existing)
UPDATE notification_templates
SET body = REPLACE(REPLACE(body, '{{senderName}}', '{{sender_name}}'), '{{noteTitle}}', '{{note_title}}')
WHERE category = 'note' AND event_type = 'share';

-- 12. Verify all templates
SELECT 'notif' as ch, category, event_type, audience, is_active FROM notification_templates ORDER BY category, event_type, audience;
SELECT 'sms' as ch, category, event_type, audience, is_active FROM sms_templates ORDER BY category, event_type, audience;
