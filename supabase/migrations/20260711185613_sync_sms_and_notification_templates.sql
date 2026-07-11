-- ─── Migration: Sync SMS and notification templates ───────────────────────────
-- This migration:
-- 1. Fixes existing SMS template Persian text issues (spacing, "دعوت هستید" → "دعوت شده‌اید")
-- 2. Adds missing SMS templates for events that only had notification templates
-- 3. Adds missing notification templates for report_ready category
-- 4. Adds organizer_name placeholder to meeting templates
-- Uses ON CONFLICT to upsert safely without losing existing data

-- ─── Fix existing SMS templates with Persian text issues ───────────────────────

-- Fix: "دعوت هستید" → "دعوت شده‌اید" in meeting invite external template
UPDATE sms_templates SET
  body = 'با سلام و احترام،
شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} در محل {{location}} دعوت شده‌اید.{{join_link}}

{{sender_name}}',
  placeholders = ARRAY['meeting_subject','meeting_date','meeting_time','location','join_link','sender_name'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'invite' AND audience = 'external';

-- Fix: observers invite — remove raw "| location" usage, use clean location
UPDATE sms_templates SET
  body = '{{full_name}} عزیز، جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}}{{location_part}} برگزار می‌شود. شما به عنوان مطلع جلسه ثبت شده‌اید.',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date','meeting_time','location_part'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'invite' AND audience = 'observers';

-- Fix: participants invite — add organizer_name
UPDATE sms_templates SET
  body = 'سلام {{full_name}}
شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} دعوت شده‌اید.
تنظیم‌کننده جلسه: {{organizer_name}}',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date','start_time','end_time','location','organizer_name'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'invite' AND audience = 'participants';

-- Fix: cancel observers — fix spacing issues
UPDATE sms_templates SET
  body = 'همکار گرامی {{full_name}}، جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} لغو شد. لطفاً به مدیر خود اطلاع‌رسانی نمایید.',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date','meeting_time'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'cancel' AND audience = 'observers';

-- Fix: change participants — fix location_part placeholder
UPDATE sms_templates SET
  body = 'همکار گرامی {{full_name}}، جلسه «{{meeting_subject}}» تغییر کرده است. زمان جدید:
{{meeting_date}} ساعت {{meeting_time}} محل: {{location}}
لطفاً برنامه خود را به‌روز کنید.',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date','meeting_time','location'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'change' AND audience = 'participants';

-- Fix: channel custom — fix "group-name" to "group_name" and fix text
UPDATE sms_templates SET
  body = 'همکار گرامی {{full_name}}، یک اقدام گروهی {{task_title}} برای شما در گروه {{group_name}} ایجاد شده است.',
  placeholders = ARRAY['full_name','task_title','group_name'],
  updated_at = now()
WHERE category = 'channel' AND event_type = 'custom' AND audience = 'all';

-- ─── Add missing SMS templates for events that only had notification templates ─

-- note:share SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'note', 'share', 'all',
  'اشتراک یادداشت',
  'سلام {{full_name}}
{{sender_name}} یادداشت «{{note_title}}» را با شما به اشتراک گذاشت.',
  ARRAY['full_name','sender_name','note_title'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- system:alert SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'system', 'alert', 'all',
  'اطلاعیه سیستم',
  '{{alert_message}}',
  ARRAY['alert_message'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- chat:message SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'chat', 'message', 'all',
  'پیام جدید',
  'سلام {{full_name}}، {{sender_name}} پیامی برای شما ارسال کرد: {{message_preview}}',
  ARRAY['full_name','sender_name','message_preview'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- chat:mention SMS template (fix existing — add message_preview)
UPDATE sms_templates SET
  subject = 'منشن در چت',
  body = 'سلام {{full_name}}، {{sender_name}} شما را در چت منشن کرد: {{message_preview}}',
  placeholders = ARRAY['full_name','sender_name','message_preview'],
  updated_at = now()
WHERE category = 'chat' AND event_type = 'mention' AND audience = 'all';

-- report:report_ready SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'report', 'report_ready', 'all',
  'گزارش آماده شد',
  'سلام {{full_name}}، گزارش «{{report_title}}» آماده شد.{{report_link}}',
  ARRAY['full_name','report_title','report_link'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- task:complete SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'task', 'complete', 'all',
  'تکمیل اقدام',
  'اقدام «{{task_title}}» توسط {{sender_name}} تکمیل گردید.',
  ARRAY['task_title','sender_name'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- channel:new_message SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'channel', 'new_message', 'all',
  'پیام جدید در کانال',
  '{{sender_name}}: {{message_preview}}',
  ARRAY['sender_name','message_preview'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- channel:member_added SMS template
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'channel', 'member_added', 'all',
  'افزودن عضو',
  'شما به {{channel_type}} {{channel_name}} اضافه شدید.',
  ARRAY['channel_name','channel_type'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- ─── Add missing notification templates ────────────────────────────────────────

-- report:report_ready notification template
INSERT INTO notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES (
  'report', 'report_ready', 'all',
  'گزارش «{{report_title}}» آماده شد',
  '{{full_name}} گرامی، گزارش «{{report_title}}» آماده شد.{{report_link}}',
  'file-text',
  'teal',
  ARRAY['full_name','report_title','report_link'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- ─── Add meeting_created event for SMS (creator role) ────────────────────────────
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'meeting', 'meeting_created', 'all',
  'ثبت جلسه',
  'سلام {{full_name}}
جلسه «{{meeting_subject}}» توسط شما برای تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} ثبت شد.',
  ARRAY['full_name','meeting_subject','meeting_date','start_time','end_time','location'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- ─── Add meeting_created event for notification (creator role) ────────────────
INSERT INTO notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES (
  'meeting', 'meeting_created', 'all',
  'ثبت جلسه «{{meeting_subject}}»',
  'جلسه «{{meeting_subject}}» توسط شما برای تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} تنظیم شد.',
  'calendar',
  'green',
  ARRAY['meeting_subject','meeting_date','start_time','end_time','location'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- ─── Add meeting_representative_assigned event for SMS ─────────────────────────
INSERT INTO sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES (
  'meeting', 'meeting_representative_assigned', 'all',
  'انتخاب به عنوان جانشین',
  'سلام {{full_name}}
شما به عنوان جانشین برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} انتخاب شده‌اید.
تنظیم‌کننده جلسه: {{organizer_name}}',
  ARRAY['full_name','meeting_subject','meeting_date','organizer_name'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- ─── Add meeting_representative_assigned event for notification ────────────────
INSERT INTO notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES (
  'meeting', 'meeting_representative_assigned', 'all',
  'انتخاب به عنوان جانشین',
  '{{full_name}} گرامی، شما به عنوان جانشین برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} انتخاب شده‌اید. تنظیم‌کننده جلسه: {{organizer_name}}',
  'user-check',
  'blue',
  ARRAY['full_name','meeting_subject','meeting_date','organizer_name'],
  true
)
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- ─── Fix existing notification templates with Persian text issues ──────────────

-- Fix: meeting invite all — add organizer_name, fix "تنظیم شده" to "دعوت شده‌اید"
UPDATE notification_templates SET
  body = '{{full_name}} گرامی، شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} دعوت شده‌اید. تنظیم‌کننده جلسه: {{organizer_name}}',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date','start_time','end_time','location','organizer_name'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'invite' AND audience = 'all';

-- Fix: meeting cancel observers — fix spacing
UPDATE notification_templates SET
  body = 'همکار گرامی {{full_name}}، جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} لغو شد. لطفاً به مدیر خود اطلاع‌رسانی نمایید.',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date','meeting_time'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'cancel' AND audience = 'observers';

-- Fix: meeting cancel participants — fix trailing newlines
UPDATE notification_templates SET
  body = 'همکار گرامی {{full_name}}، جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} لغو گردید. زمان جدید جلسه متعاقباً اعلام می‌گردد.',
  placeholders = ARRAY['full_name','meeting_subject','meeting_date'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'cancel' AND audience = 'participants';

-- Fix: meeting reminder observers — fix trailing newlines
UPDATE notification_templates SET
  body = '{{full_name}} عزیز، جلسه «{{meeting_subject}}» که شما مطلع آن هستید تا {{minutes}} دقیقه دیگر آغاز می‌شود.',
  placeholders = ARRAY['full_name','meeting_subject','minutes'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'reminder' AND audience = 'observers';

-- Fix: meeting reminder participants — fix trailing newlines
UPDATE notification_templates SET
  body = '{{full_name}} عزیز، جلسه «{{meeting_subject}}» تا {{minutes}} دقیقه دیگر در ساعت {{meeting_time}} در محل {{location}} آغاز می‌شود.',
  placeholders = ARRAY['full_name','meeting_subject','minutes','meeting_time','location'],
  updated_at = now()
WHERE category = 'meeting' AND event_type = 'reminder' AND audience = 'participants';

-- Fix: task assign — fix trailing newlines
UPDATE notification_templates SET
  body = 'همکار گرامی {{full_name}}، اقدام «{{task_title}}» با اولویت {{priority}} توسط {{sender_name}} به شما محول شد.',
  placeholders = ARRAY['full_name','task_title','priority','sender_name'],
  updated_at = now()
WHERE category = 'task' AND event_type = 'assign' AND audience = 'all';

-- Fix: channel templates — add placeholders
UPDATE notification_templates SET
  placeholders = ARRAY['channel_name','channel_type'],
  updated_at = now()
WHERE category = 'channel' AND event_type = 'member_added' AND audience = 'all';

UPDATE notification_templates SET
  placeholders = ARRAY['sender_name','message_preview','channel_name','channel_type'],
  updated_at = now()
WHERE category = 'channel' AND event_type = 'new_message' AND audience = 'all';

-- Fix: task reminder — add due_date to placeholders
UPDATE notification_templates SET
  body = 'مهلت اقدام «{{task_title}}» رو به پایان است. لطفاً وضعیت را به‌روز کنید.',
  placeholders = ARRAY['full_name','task_title','due_date'],
  updated_at = now()
WHERE category = 'task' AND event_type = 'reminder' AND audience = 'all';
