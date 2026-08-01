/*
# Seed notification and SMS templates for Minutes and Decision lifecycle

1. New Data
- Notification templates for categories 'minutes' and 'decision'
- SMS templates for categories 'minutes' and 'decision'
- All inserts use ON CONFLICT DO NOTHING — existing user templates are never overwritten

2. SMS Default Activation
- Critical events are is_active=true by default:
    minute_approval_requested, minute_changes_requested, minute_published,
    decision_assigned, decision_followup_due, decision_overdue
- Low-priority/high-frequency events are is_active=false by default:
    minute_draft_created, decision_progress_updated, decision_followup
- All notification templates are is_active=true

3. Notes
- Idempotent: ON CONFLICT DO NOTHING
- No existing templates are modified or deleted
- Placeholders use {placeholder} syntax matching existing convention
*/

-- ── Notification templates: Minutes ─────────────────────────────────────────

INSERT INTO public.notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  ('minutes', 'minute_draft_created', 'creator', 'ایجاد پیش‌نویس صورت‌جلسه', 'پیش‌نویس صورت‌جلسه «{minute_title}» ایجاد شد.', 'file-text', 'blue', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_draft_created', 'secretary', 'ایجاد پیش‌نویس صورت‌جلسه', 'پیش‌نویس صورت‌جلسه «{minute_title}» ایجاد شد.', 'file-text', 'blue', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_submitted', 'approvers', 'صورت‌جلسه برای تأیید ارسال شد', 'صورت‌جلسه «{minute_title}» (نسخه {minute_revision}) برای تأیید شما ارسال شد.', 'clipboard-list', 'amber', ARRAY['minute_title','minute_revision','approval_mode','actor_name','minute_link'], true),
  ('minutes', 'minute_approval_requested', 'approvers', 'درخواست تأیید صورت‌جلسه', '{approver_name}، صورت‌جلسه «{minute_title}» در انتظار تأیید شماست.', 'clipboard-check', 'amber', ARRAY['minute_title','minute_revision','approver_name','approval_mode','minute_link'], true),
  ('minutes', 'minute_approved_by_user', 'creator', 'تأیید صورت‌جلسه', '{approver_name} صورت‌جلسه «{minute_title}» را تأیید کرد.', 'check-circle', 'green', ARRAY['minute_title','minute_revision','approver_name','minute_link'], true),
  ('minutes', 'minute_approved_by_user', 'secretary', 'تأیید صورت‌جلسه', '{approver_name} صورت‌جلسه «{minute_title}» را تأیید کرد.', 'check-circle', 'green', ARRAY['minute_title','minute_revision','approver_name','minute_link'], true),
  ('minutes', 'minute_changes_requested', 'creator', 'درخواست اصلاح صورت‌جلسه', '{approver_name} برای صورت‌جلسه «{minute_title}» اصلاح درخواست کرد: {change_reason}', 'edit', 'orange', ARRAY['minute_title','minute_revision','approver_name','change_reason','minute_link'], true),
  ('minutes', 'minute_changes_requested', 'secretary', 'درخواست اصلاح صورت‌جلسه', '{approver_name} برای صورت‌جلسه «{minute_title}» اصلاح درخواست کرد: {change_reason}', 'edit', 'orange', ARRAY['minute_title','minute_revision','approver_name','change_reason','minute_link'], true),
  ('minutes', 'minute_resubmitted', 'approvers', 'ارسال مجدد صورت‌جلسه', 'صورت‌جلسه «{minute_title}» (نسخه {minute_revision}) پس از اصلاح مجدداً ارسال شد.', 'send', 'amber', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_secretary_confirmed', 'chair', 'تأیید دبیر جلسه', 'دبیر جلسه صورت‌جلسه «{minute_title}» را تأیید کرد.', 'check', 'teal', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_chair_confirmed', 'secretary', 'تأیید رئیس جلسه', 'رئیس جلسه صورت‌جلسه «{minute_title}» را تأیید کرد.', 'check', 'teal', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_published', 'creator', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{minute_title}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'secretary', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{minute_title}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'chair', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{minute_title}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'participants', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{minute_title}» منتشر شد.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_published', 'decision_owner', 'انتشار صورت‌جلسه', 'صورت‌جلسه «{minute_title}» منتشر شد. مصوبات شما اکنون قابل پیگیری است.', 'globe', 'blue', ARRAY['minute_title','minute_revision','minute_link'], true),
  ('minutes', 'minute_revision_invalidated', 'creator', 'باطل‌شدن نسخه قبلی', 'نسخه قبلی صورت‌جلسه «{minute_title}» باطل شد.', 'x-circle', 'gray', ARRAY['minute_title','minute_revision','actor_name','minute_link'], true),
  ('minutes', 'minute_attachment_added', 'creator', 'افزودن پیوست', 'پیوست جدیدی به صورت‌جلسه «{minute_title}» اضافه شد.', 'paperclip', 'blue', ARRAY['minute_title','actor_name','minute_link'], true)
ON CONFLICT DO NOTHING;

-- ── Notification templates: Decisions ──────────────────────────────────────

INSERT INTO public.notification_templates (category, event_type, audience, title, body, icon, color, placeholders, is_active)
VALUES
  ('decision', 'decision_assigned', 'decision_owner', 'تخصیص مصوبه', 'مصوبه «{decision_title}» به شما محول شد. مهلت: {decision_due_date}', 'user-check', 'teal', ARRAY['decision_title','decision_owner_name','decision_due_date','responsible_unit','decision_link'], true),
  ('decision', 'decision_status_changed', 'decision_owner', 'تغییر وضعیت مصوبه', 'وضعیت مصوبه «{decision_title}» از {previous_decision_status} به {decision_status} تغییر یافت.', 'refresh-cw', 'blue', ARRAY['decision_title','decision_status','previous_decision_status','actor_name','decision_link'], true),
  ('decision', 'decision_status_changed', 'creator', 'تغییر وضعیت مصوبه', 'وضعیت مصوبه «{decision_title}» از {previous_decision_status} به {decision_status} تغییر یافت.', 'refresh-cw', 'blue', ARRAY['decision_title','decision_status','previous_decision_status','actor_name','decision_link'], true),
  ('decision', 'decision_status_changed', 'secretary', 'تغییر وضعیت مصوبه', 'وضعیت مصوبه «{decision_title}» از {previous_decision_status} به {decision_status} تغییر یافت.', 'refresh-cw', 'blue', ARRAY['decision_title','decision_status','previous_decision_status','actor_name','decision_link'], true),
  ('decision', 'decision_status_changed', 'chair', 'تغییر وضعیت مصوبه', 'وضعیت مصوبه «{decision_title}» از {previous_decision_status} به {decision_status} تغییر یافت.', 'refresh-cw', 'blue', ARRAY['decision_title','decision_status','previous_decision_status','actor_name','decision_link'], true),
  ('decision', 'decision_progress_updated', 'decision_owner', 'به‌روزرسانی پیشرفت', 'پیشرفت مصوبه «{decision_title}» به {decision_progress}٪ به‌روزرسانی شد.', 'trending-up', 'blue', ARRAY['decision_title','decision_progress','actor_name','decision_link'], true),
  ('decision', 'decision_progress_updated', 'creator', 'به‌روزرسانی پیشرفت', 'پیشرفت مصوبه «{decision_title}» به {decision_progress}٪ به‌روزرسانی شد.', 'trending-up', 'blue', ARRAY['decision_title','decision_progress','actor_name','decision_link'], true),
  ('decision', 'decision_followup', 'decision_owner', 'ثبت پیگیری', 'پیگیری برای مصوبه «{decision_title}» ثبت شد. روش: {followup_method}', 'message-circle', 'blue', ARRAY['decision_title','followup_date','followup_method','followup_result','actor_name','decision_link'], true),
  ('decision', 'decision_followup_due', 'decision_owner', 'موعد پیگیری مصوبه', 'موعد پیگیری مصوبه «{decision_title}» فرا رسید.', 'clock', 'rose', ARRAY['decision_title','followup_date','decision_link'], true),
  ('decision', 'decision_obstacle', 'decision_owner', 'ثبت مانع', 'برای مصوبه «{decision_title}» مانع ثبت شد: {obstacle_title}', 'alert-triangle', 'orange', ARRAY['decision_title','obstacle_title','obstacle_severity','actor_name','decision_link'], true),
  ('decision', 'decision_obstacle', 'creator', 'ثبت مانع', 'برای مصوبه «{decision_title}» مانع ثبت شد: {obstacle_title}', 'alert-triangle', 'orange', ARRAY['decision_title','obstacle_title','obstacle_severity','actor_name','decision_link'], true),
  ('decision', 'decision_obstacle', 'secretary', 'ثبت مانع', 'برای مصوبه «{decision_title}» مانع ثبت شد: {obstacle_title}', 'alert-triangle', 'orange', ARRAY['decision_title','obstacle_title','obstacle_severity','actor_name','decision_link'], true),
  ('decision', 'decision_obstacle', 'chair', 'ثبت مانع', 'برای مصوبه «{decision_title}» مانع ثبت شد: {obstacle_title}', 'alert-triangle', 'orange', ARRAY['decision_title','obstacle_title','obstacle_severity','actor_name','decision_link'], true),
  ('decision', 'decision_obstacle_resolved', 'decision_owner', 'رفع مانع', 'مانع مصوبه «{decision_title}» رفع شد.', 'check-circle', 'green', ARRAY['decision_title','obstacle_title','actor_name','decision_link'], true),
  ('decision', 'decision_obstacle_resolved', 'creator', 'رفع مانع', 'مانع مصوبه «{decision_title}» رفع شد.', 'check-circle', 'green', ARRAY['decision_title','obstacle_title','actor_name','decision_link'], true),
  ('decision', 'decision_completed', 'decision_owner', 'تکمیل مصوبه', 'مصوبه «{decision_title}» تکمیل شد.', 'check-circle', 'green', ARRAY['decision_title','decision_progress','actor_name','decision_link'], true),
  ('decision', 'decision_completed', 'creator', 'تکمیل مصوبه', 'مصوبه «{decision_title}» تکمیل شد.', 'check-circle', 'green', ARRAY['decision_title','decision_progress','actor_name','decision_link'], true),
  ('decision', 'decision_reopened', 'decision_owner', 'بازگشایی مصوبه', 'مصوبه «{decision_title}» مجدداً باز شد. وضعیت: {decision_status}', 'rotate-ccw', 'amber', ARRAY['decision_title','decision_status','actor_name','decision_link'], true),
  ('decision', 'decision_due_soon', 'decision_owner', 'نزدیک‌شدن سررسید', 'سررسید مصوبه «{decision_title}» نزدیک است: {decision_due_date}', 'alarm-clock', 'amber', ARRAY['decision_title','decision_due_date','decision_link'], true),
  ('decision', 'decision_overdue', 'decision_owner', 'عبور از مهلت', 'مهلت مصوبه «{decision_title}» سپی شده است: {decision_due_date}', 'alert-octagon', 'red', ARRAY['decision_title','decision_due_date','decision_link'], true)
ON CONFLICT DO NOTHING;

-- ── SMS templates: Minutes (critical events active, others inactive) ───────

INSERT INTO public.sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES
  ('minutes', 'minute_draft_created', 'creator', '', 'پیش‌نویس صورت‌جلسه «{minute_title}» ایجاد شد.', ARRAY['minute_title','minute_revision'], false),
  ('minutes', 'minute_submitted', 'approvers', '', 'صورت‌جلسه «{minute_title}» برای تأیید ارسال شد.', ARRAY['minute_title','minute_revision','approval_mode'], false),
  ('minutes', 'minute_approval_requested', 'approvers', '', '{approver_name}، صورت‌جلسه «{minute_title}» در انتظار تأیید شماست.', ARRAY['minute_title','minute_revision','approver_name','approval_mode'], true),
  ('minutes', 'minute_approved_by_user', 'creator', '', '{approver_name} صورت‌جلسه «{minute_title}» را تأیید کرد.', ARRAY['minute_title','minute_revision','approver_name'], false),
  ('minutes', 'minute_changes_requested', 'creator', '', 'برای صورت‌جلسه «{minute_title}» اصلاح درخواست شد: {change_reason}', ARRAY['minute_title','minute_revision','approver_name','change_reason'], true),
  ('minutes', 'minute_resubmitted', 'approvers', '', 'صورت‌جلسه «{minute_title}» مجدداً ارسال شد.', ARRAY['minute_title','minute_revision'], false),
  ('minutes', 'minute_secretary_confirmed', 'chair', '', 'دبیر جلسه صورت‌جلسه «{minute_title}» را تأیید کرد.', ARRAY['minute_title','minute_revision'], false),
  ('minutes', 'minute_chair_confirmed', 'secretary', '', 'رئیس جلسه صورت‌جلسه «{minute_title}» را تأیید کرد.', ARRAY['minute_title','minute_revision'], false),
  ('minutes', 'minute_published', 'participants', '', 'صورت‌جلسه «{minute_title}» منتشر شد.', ARRAY['minute_title','minute_revision'], true),
  ('minutes', 'minute_revision_invalidated', 'creator', '', 'نسخه قبلی صورت‌جلسه «{minute_title}» باطل شد.', ARRAY['minute_title','minute_revision'], false),
  ('minutes', 'minute_attachment_added', 'creator', '', 'پیوست جدیدی به صورت‌جلسه «{minute_title}» اضافه شد.', ARRAY['minute_title'], false)
ON CONFLICT DO NOTHING;

-- ── SMS templates: Decisions (critical events active, others inactive) ─────

INSERT INTO public.sms_templates (category, event_type, audience, subject, body, placeholders, is_active)
VALUES
  ('decision', 'decision_assigned', 'decision_owner', '', 'مصوبه «{decision_title}» به شما محول شد. مهلت: {decision_due_date}', ARRAY['decision_title','decision_owner_name','decision_due_date','responsible_unit'], true),
  ('decision', 'decision_status_changed', 'decision_owner', '', 'وضعیت مصوبه «{decision_title}» به {decision_status} تغییر یافت.', ARRAY['decision_title','decision_status','previous_decision_status'], false),
  ('decision', 'decision_progress_updated', 'decision_owner', '', 'پیشرفت مصوبه «{decision_title}» به {decision_progress}٪ رسید.', ARRAY['decision_title','decision_progress'], false),
  ('decision', 'decision_followup', 'decision_owner', '', 'پیگیری مصوبه «{decision_title}» ثبت شد.', ARRAY['decision_title','followup_date','followup_method','followup_result'], false),
  ('decision', 'decision_followup_due', 'decision_owner', '', 'موعد پیگیری مصوبه «{decision_title}» فرا رسید.', ARRAY['decision_title','followup_date'], true),
  ('decision', 'decision_obstacle', 'decision_owner', '', 'مانع برای مصوبه «{decision_title}»: {obstacle_title}', ARRAY['decision_title','obstacle_title','obstacle_severity'], false),
  ('decision', 'decision_obstacle_resolved', 'decision_owner', '', 'مانع مصوبه «{decision_title}» رفع شد.', ARRAY['decision_title','obstacle_title'], false),
  ('decision', 'decision_completed', 'decision_owner', '', 'مصوبه «{decision_title}» تکمیل شد.', ARRAY['decision_title','decision_progress'], false),
  ('decision', 'decision_reopened', 'decision_owner', '', 'مصوبه «{decision_title}» بازگشایی شد.', ARRAY['decision_title','decision_status'], false),
  ('decision', 'decision_due_soon', 'decision_owner', '', 'سررسید مصوبه «{decision_title}» نزدیک است: {decision_due_date}', ARRAY['decision_title','decision_due_date'], false),
  ('decision', 'decision_overdue', 'decision_owner', '', 'مهلت مصوبه «{decision_title}» سپی شده: {decision_due_date}', ARRAY['decision_title','decision_due_date'], true)
ON CONFLICT DO NOTHING;
