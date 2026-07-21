/*
# Add missing notification and SMS templates for meeting edit scenarios

1. Purpose
   - Adds `meeting:change:all` and `meeting:cancel:all` notification templates so the
     creator/editor gets a correct fallback message instead of incorrectly receiving
     the observer template.
   - Adds `meeting:cancel:external` notification and SMS templates so removed external
     participants can receive a cancel message.
   - All inserts are additive — no existing templates are modified or deleted.
   - Uses `ON CONFLICT DO NOTHING` on a natural key (category, event_type, audience)
     to be idempotent.

2. New Templates
   Notification templates:
   - meeting:change:all — "تغییر جلسه" for creator/editor fallback
   - meeting:cancel:all — "لغو جلسه" for creator/editor fallback
   - meeting:cancel:external — "لغو دعوت" for removed external participants

   SMS templates:
   - meeting:cancel:external — cancel SMS for removed external participants

3. Security
   - No RLS or policy changes. These are data rows in existing template tables.

4. Rollback
   - DELETE FROM notification_templates WHERE category='meeting' AND event_type IN ('change','cancel') AND audience='all';
   - DELETE FROM notification_templates WHERE category='meeting' AND event_type='cancel' AND audience='external';
   - DELETE FROM sms_templates WHERE category='meeting' AND event_type='cancel' AND audience='external';
*/

-- ─── Notification templates ────────────────────────────────────────────────

INSERT INTO public.notification_templates (category, event_type, audience, title, body, is_active, placeholders)
SELECT 'meeting', 'change', 'all',
  'تغییر جلسه',
  'جلسه «{{meeting_subject}}» به تاریخ {{meeting_date}} ساعت {{meeting_time}} تغییر یافت.',
  true,
  ARRAY['meeting_subject','meeting_date','meeting_time','start_time','end_time','location','organizer_name','join_link','recipient_greeting','full_name','location_part','agenda']
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates
  WHERE category='meeting' AND event_type='change' AND audience='all'
);

INSERT INTO public.notification_templates (category, event_type, audience, title, body, is_active, placeholders)
SELECT 'meeting', 'cancel', 'all',
  'لغو جلسه',
  'جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} لغو شد.',
  true,
  ARRAY['meeting_subject','meeting_date','meeting_time','start_time','end_time','location','organizer_name','recipient_greeting','full_name','location_part']
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates
  WHERE category='meeting' AND event_type='cancel' AND audience='all'
);

INSERT INTO public.notification_templates (category, event_type, audience, title, body, is_active, placeholders)
SELECT 'meeting', 'cancel', 'external',
  'لغو دعوت',
  'با سلام و احترام، دعوت شما برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} لغو شد.',
  true,
  ARRAY['meeting_subject','meeting_date','meeting_time','start_time','end_time','location','organizer_name','recipient_greeting','full_name','location_part']
WHERE NOT EXISTS (
  SELECT 1 FROM public.notification_templates
  WHERE category='meeting' AND event_type='cancel' AND audience='external'
);

-- ─── SMS templates ─────────────────────────────────────────────────────────

INSERT INTO public.sms_templates (category, event_type, audience, subject, body, is_active, placeholders)
SELECT 'meeting', 'cancel', 'external',
  'لغو دعوت',
  'با سلام و احترام، دعوت شما برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} لغو شد.',
  true,
  ARRAY['meeting_subject','meeting_date','meeting_time','start_time','end_time','location','organizer_name','recipient_greeting','full_name','location_part']
WHERE NOT EXISTS (
  SELECT 1 FROM public.sms_templates
  WHERE category='meeting' AND event_type='cancel' AND audience='external'
);