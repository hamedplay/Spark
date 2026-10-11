-- Fix meeting confirmation SMS template requiring end_time for meetings
-- where an end time is not guaranteed to be present.

update public.sms_templates
set
  body = '{{recipient_greeting}}، {{participant_name}} حضور خود را در جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{start_time}} تأیید کرد.',
  placeholders = array[
    'recipient_greeting',
    'participant_name',
    'meeting_subject',
    'meeting_date',
    'start_time'
  ]::text[],
  updated_at = now()
where category = 'meeting'
  and event_type = 'meeting_confirmed'
  and audience = 'all'
  and is_active = true;
