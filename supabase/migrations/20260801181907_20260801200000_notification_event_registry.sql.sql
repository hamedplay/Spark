/*
# Notification Event Registry — single source of truth for event keys

1. New Table
- `notification_event_registry` — canonical event definitions for minutes and decisions
  Columns: event_key (PK), category, entity_type, label_fa, notification_enabled,
           sms_supported, group_rule_supported, allowed_audiences, required_placeholders,
           optional_placeholders, is_active, created_at, updated_at

2. Data
- Seeds all canonical minute_* and decision_* events
- Uses minute_ (singular) prefix for minutes events, not minutes_

3. Security
- RLS enabled
- SELECT TO authenticated (admin UI needs to read for config)
- No INSERT/UPDATE/DELETE from frontend — only service_role manages registry

4. Notes
- Idempotent: ON CONFLICT DO NOTHING for seeds
- No existing tables or data modified
*/

CREATE TABLE IF NOT EXISTS public.notification_event_registry (
  event_key text PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('minutes', 'decision')),
  entity_type text NOT NULL,
  label_fa text NOT NULL,
  notification_enabled boolean NOT NULL DEFAULT true,
  sms_supported boolean NOT NULL DEFAULT false,
  group_rule_supported boolean NOT NULL DEFAULT true,
  allowed_audiences text[] NOT NULL DEFAULT '{all}',
  required_placeholders text[] NOT NULL DEFAULT '{}',
  optional_placeholders text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notification_event_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_registry_authenticated" ON public.notification_event_registry;
CREATE POLICY "select_registry_authenticated"
  ON public.notification_event_registry FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies — only service_role can manage registry

-- ── Seed: Minutes events (minute_ prefix, singular) ────────────────────────

INSERT INTO public.notification_event_registry (event_key, category, entity_type, label_fa, notification_enabled, sms_supported, group_rule_supported, allowed_audiences, required_placeholders, optional_placeholders) VALUES
  ('minute_draft_created',        'minutes', 'minute', 'ایجاد پیش‌نویس صورت‌جلسه',     true, false, true, '{creator,secretary,all}', '{minute_title}', '{minute_revision,minute_status,actor_name,minute_link,recipient_greeting,full_name}'),
  ('minute_submitted',            'minutes', 'minute', 'ارسال صورت‌جلسه برای تأیید',     true, false, true, '{approvers,creator,secretary,all}', '{minute_title}', '{minute_revision,minute_status,approval_mode,actor_name,minute_link,recipient_greeting,full_name}'),
  ('minute_approval_requested',  'minutes', 'minute', 'درخواست تأیید صورت‌جلسه',       true, true,  true, '{approvers,all}', '{minute_title,approver_name}', '{minute_revision,approval_mode,minute_link,recipient_greeting,full_name}'),
  ('minute_approved_by_user',     'minutes', 'minute', 'تأیید توسط تأییدکننده',          true, false, true, '{creator,secretary,all}', '{minute_title,approver_name}', '{minute_revision,minute_status,minute_link,recipient_greeting,full_name}'),
  ('minute_changes_requested',   'minutes', 'minute', 'درخواست اصلاح صورت‌جلسه',       true, true,  true, '{creator,secretary,all}', '{minute_title,change_reason}', '{minute_revision,approver_name,minute_link,recipient_greeting,full_name}'),
  ('minute_resubmitted',          'minutes', 'minute', 'ارسال مجدد صورت‌جلسه',          true, false, true, '{approvers,creator,secretary,all}', '{minute_title}', '{minute_revision,minute_status,actor_name,minute_link,recipient_greeting,full_name}'),
  ('minute_secretary_confirmed',  'minutes', 'minute', 'تأیید دبیر جلسه',              true, false, true, '{chair,all}', '{minute_title}', '{minute_revision,actor_name,minute_link,recipient_greeting,full_name}'),
  ('minute_chair_confirmed',     'minutes', 'minute', 'تأیید رئیس جلسه',               true, false, true, '{secretary,creator,all}', '{minute_title}', '{minute_revision,actor_name,minute_link,recipient_greeting,full_name}'),
  ('minute_published',           'minutes', 'minute', 'انتشار صورت‌جلسه',              true, true,  true, '{creator,secretary,chair,participants,decision_owner,all}', '{minute_title}', '{minute_revision,minute_link,recipient_greeting,full_name}'),
  ('minute_revision_invalidated', 'minutes', 'minute', 'باطل‌شدن نسخه قبلی',           true, false, true, '{creator,secretary,all}', '{minute_title}', '{minute_revision,actor_name,minute_link,recipient_greeting,full_name}'),
  ('minute_attachment_added',    'minutes', 'minute', 'افزودن پیوست صورت‌جلسه',         true, false, true, '{creator,secretary,all}', '{minute_title}', '{actor_name,minute_link,recipient_greeting,full_name}')
ON CONFLICT DO NOTHING;

-- ── Seed: Decision events ────────────────────────────────────────────────────

INSERT INTO public.notification_event_registry (event_key, category, entity_type, label_fa, notification_enabled, sms_supported, group_rule_supported, allowed_audiences, required_placeholders, optional_placeholders) VALUES
  ('decision_assigned',           'decision', 'decision', 'تخصیص مصوبه',           true, true,  true, '{decision_owner,all}', '{decision_title,decision_owner_name}', '{decision_due_date,responsible_unit,decision_link,recipient_greeting,full_name}'),
  ('decision_status_changed',     'decision', 'decision', 'تغییر وضعیت مصوبه',     true, false, true, '{decision_owner,creator,secretary,chair,all}', '{decision_title,decision_status}', '{previous_decision_status,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_progress_updated',   'decision', 'decision', 'به‌روزرسانی پیشرفت',     true, false, true, '{decision_owner,creator,secretary,chair,all}', '{decision_title}', '{decision_progress,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_followup',           'decision', 'decision', 'ثبت پیگیری',              true, false, true, '{decision_owner,creator,secretary,chair,all}', '{decision_title}', '{followup_date,followup_method,followup_result,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_followup_due',       'decision', 'decision', 'موعد پیگیری',              true, true,  true, '{decision_owner,all}', '{decision_title}', '{followup_date,decision_link,recipient_greeting,full_name}'),
  ('decision_obstacle',           'decision', 'decision', 'ثبت مانع',                true, false, true, '{decision_owner,creator,secretary,chair,all}', '{decision_title,obstacle_title}', '{obstacle_severity,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_obstacle_resolved',  'decision', 'decision', 'رفع مانع',                true, false, true, '{decision_owner,creator,secretary,chair,all}', '{decision_title}', '{obstacle_title,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_completed',          'decision', 'decision', 'تکمیل مصوبه',             true, false, true, '{decision_owner,creator,secretary,chair,all}', '{decision_title}', '{decision_progress,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_reopened',           'decision', 'decision', 'بازگشایی مصوبه',           true, false, true, '{decision_owner,all}', '{decision_title}', '{decision_status,actor_name,decision_link,recipient_greeting,full_name}'),
  ('decision_due_soon',           'decision', 'decision', 'نزدیک‌شدن سررسید',         true, false, true, '{decision_owner,all}', '{decision_title}', '{decision_due_date,decision_link,recipient_greeting,full_name}'),
  ('decision_overdue',            'decision', 'decision', 'عبور از مهلت',             true, true,  true, '{decision_owner,all}', '{decision_title}', '{decision_due_date,decision_link,recipient_greeting,full_name}')
ON CONFLICT DO NOTHING;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_registry_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registry_updated_at ON public.notification_event_registry;
CREATE TRIGGER trg_registry_updated_at
  BEFORE UPDATE ON public.notification_event_registry
  FOR EACH ROW
  EXECUTE FUNCTION public.set_registry_updated_at();
