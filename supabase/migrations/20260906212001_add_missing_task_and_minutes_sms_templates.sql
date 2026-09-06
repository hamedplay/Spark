INSERT INTO public.sms_templates (
  category,
  event_type,
  audience,
  subject,
  body,
  placeholders,
  is_active
)
VALUES
  (
    'task',
    'note_added',
    'all',
    'گزارش جدید برای اقدام',
    'گزارش جدید برای اقدام «{{task_title}}» توسط {{sender_name}} ثبت شد.',
    ARRAY['sender_name', 'task_title']::text[],
    true
  ),
  (
    'minutes',
    'minute_published',
    'all',
    'صورتجلسه منتشر شد',
    'صورتجلسه جلسه «{{meeting_title}}» منتشر شد.',
    ARRAY['meeting_title']::text[],
    true
  )
ON CONFLICT (category, event_type, audience)
DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  placeholders = EXCLUDED.placeholders,
  is_active = true,
  updated_at = now();
