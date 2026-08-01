/*
# Seed notification and SMS templates with canonical minute_ prefix

Previous seed used minutes_ prefix. This migration adds templates with canonical minute_ prefix.
Uses ON CONFLICT DO NOTHING — existing custom templates are never overwritten.

Also adds a unique constraint alias: if a template with minutes_ prefix exists but no minute_ prefix
template exists, the minutes_ template remains as fallback. The resolver function _create_minutes_notification
normalizes minutes_ → minute_ before lookup, so both work.
*/

-- ── Notification templates: Minutes (canonical minute_ prefix) ─────────────

INSERT INTO public.notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  ('minutes', 'minute_draft_created', 'creator', 'ایجاد پیش‌نویس صورت‌جلسه', 'پیش‌نویس صورت‌جلسه «{{minute_title}}» ایجاد شد.', 'file-text', 'blue', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_draft_created', 'secretary', 'ایجاد پیش‌نویس صورت‌جلسه', 'پیش‌نویس صورت‌جلسه «{{minute_title}}» ایجاد شد.', 'file-text', 'blue', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_submitted', 'approvers', 'صورت‌جلسه برای تأیید ارسال شد', 'صورت‌جلسه «{{minute_title}}» (نسخه {{minute_revision}}) برای تأیید شما ارسال شد.', 'clipboard-list', 'amber', ARRAY['minute_title','minute_revision','approval_mode','actor_name','minute_link'], true),
  ('minutes', 'minute_approval_requested', 'approvers', 'درخواست تأیید صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» در انتظار تأیید شماست.', 'clipboard-check', 'amber', ARRAY['minute_title','minute_revision','approver_name','approval_mode','minute_link'], true),
  ('minutes', 'minute_approved_by_user', 'creator', 'تأیید صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» تأیید شد.', 'check-circle', 'green', ARRAY['minute_title','minute_revision','approver_name','minute_link'], true),
  ('minutes', 'minute_approved_by_user', 'secretary', 'تأیید صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» تأیید شد.', 'check-circle', 'green', ARRAY['minute_title','minute_revision','approver_name','minute_link'], true),
  ('minutes', 'minute_changes_requested', 'creator', 'درخواست اصلاح صورت‌جلسه', 'برای صورت‌جلسه «{{minute_title}}» اصلاح درخواست شد: {{change_reason}}', 'edit', 'orange', ARRAY['minute_title','minute_revision','approver_name','change_reason','minute_link'], true),
  ('minutes', 'minute_changes_requested', 'secretary', 'درخواست اصلاح صورت‌جلسه', 'برای صورت‌جلسه «{{minute_title}}» اصلاح درخواست شد: {{change_reason}}', 'edit', 'orange', ARRAY['minute_title','minute_revision','approver_name','change_reason','minute_link'], true),
  ('minutes', 'minute_resubmitted', 'approvers', 'ارسال مجدد صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» (نسخه {{minute_revision}}) پس از اصلاح مجدداً ارسال شد.', 'send', 'amber', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_secretary_confirmed', 'chair', 'تأیید دبیر جلسه', 'دبیر جلسه صورت‌جلسه «{{minute_title}}» را تأیید کرد.', 'check', 'teal', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_chair_confirmed', 'secretary', 'تأیید رئیس جلسه', 'رئیس جلسه صورت‌جلسه «{{minute_title}}» را تأیید کرد.', 'check', 'teal', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_chair_confirmed', 'creator', 'تأیید رئیس جلسه', 'رئیس جلسه صورت‌جلسه «{{minute_title}}» را تأیید کرد.', 'check', 'teal', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_published', 'creator', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'secretary', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'chair', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'participants', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'decision_owner', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» منتشر شد. مصوبات شما اکنون قابل پیگیری است.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'all', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{{minute_title}}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_revision_invalidated', 'creator', 'باطل‌شدن نسخه قبلی', 'نسخه قبلی صورت‌جلسه «{{minute_title}}» باطل شد.', 'x-circle', 'gray', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_attachment_added', 'creator', 'افزودن پیوست', 'پیوست جدیدی به صورت‌جلسه «{{minute_title}}» اضافه شد.', 'paperclip', 'blue', ARRAY['minute_title','actor_name','minute_link'], true)
ON CONFLICT DO NOTHING;

-- ── SMS templates: Minutes (canonical minute_ prefix) ───────────────────────

INSERT INTO public.sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES
  ('minutes', 'minute_approval_requested', 'approvers', '', 'صورت‌جلسه «{{minute_title}}» در انتظار تأیید شماست.', ARRAY['minute_title','minute_revision','approver_name','approval_mode'], true),
  ('minutes', 'minute_changes_requested', 'creator', '', 'برای صورت‌جلسه «{{minute_title}}» اصلاح درخواست شد: {{change_reason}}', ARRAY['minute_title','minute_revision','approver_name','change_reason'], true),
  ('minutes', 'minute_published', 'participants', '', 'صورت‌جلسه «{{minute_title}}» منتشر شد.', ARRAY['minute_title','minute_revision'], true)
ON CONFLICT DO NOTHING;
