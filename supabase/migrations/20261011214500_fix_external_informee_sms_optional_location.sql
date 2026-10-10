-- Keep external-informee SMS valid when a meeting has no physical location.
-- location_part is optional in the central SMS renderer; location is required.
UPDATE public.sms_templates
SET
  body = 'با سلام و احترام، جهت اطلاع شما جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}}{{location_part}} برگزار می‌شود. شما به عنوان مطلع خارج از سازمان ثبت شده‌اید.',
  placeholders = ARRAY['meeting_subject','meeting_date','meeting_time','location_part'],
  updated_at = now()
WHERE category = 'meeting'
  AND event_type = 'informee_invite'
  AND audience = 'external';

UPDATE public.sms_templates
SET
  body = 'با سلام و احترام، اطلاعات جلسه «{{meeting_subject}}» تغییر کرده است. زمان جدید: {{meeting_date}} ساعت {{meeting_time}}{{location_part}}.',
  placeholders = ARRAY['meeting_subject','meeting_date','meeting_time','location_part'],
  updated_at = now()
WHERE category = 'meeting'
  AND event_type = 'informee_change'
  AND audience = 'external';
