-- Requested and approved meetings legitimately have no scheduled start/end time.
-- Keep external cancellation notifications valid for every meeting state by
-- requiring only the subject and meeting date.
UPDATE public.sms_templates
SET body = 'با سلام و احترام، دعوت شما برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} لغو شد.'
WHERE category = 'meeting'
  AND event_type = 'cancel'
  AND audience = 'external'
  AND is_active = true
  AND body = 'با سلام و احترام، دعوت شما برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}}{{meeting_time_part}} لغو شد.';
