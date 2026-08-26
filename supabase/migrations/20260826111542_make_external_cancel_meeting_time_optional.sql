-- External cancellation messages must support requested/approved meetings that
-- legitimately have no scheduled start/end time yet. Keep the meeting date
-- required, but render the time phrase only when a time exists.
UPDATE public.sms_templates
SET body = 'با سلام و احترام، دعوت شما برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}}{{meeting_time_part}} لغو شد.'
WHERE category = 'meeting'
  AND event_type = 'cancel'
  AND audience = 'external'
  AND is_active = true
  AND body = 'با سلام و احترام، دعوت شما برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} لغو شد.';
