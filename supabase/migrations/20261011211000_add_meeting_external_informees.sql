-- Separate external informees from external participants without changing the
-- existing external_participants contract.
ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS external_informees text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.meetings.external_informees IS
  'External contacts informed about the meeting but not counted as participants.';

-- External informees intentionally use their own event types while keeping the
-- existing external SMS transport. This preserves the current external audience
-- contract and lets each role have an independent editable message template.
INSERT INTO public.sms_templates (
  category, event_type, audience, subject, body, placeholders, is_active
)
VALUES
  (
    'meeting', 'informee_invite', 'external',
    'اطلاع‌رسانی جلسه به مطلع خارج سازمان',
    'با سلام و احترام، جهت اطلاع شما جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} در محل {{location}} برگزار می‌شود. شما به عنوان مطلع خارج از سازمان ثبت شده‌اید.',
    ARRAY['meeting_subject','meeting_date','meeting_time','location'], true
  ),
  (
    'meeting', 'informee_change', 'external',
    'تغییر جلسه برای مطلع خارج سازمان',
    'با سلام و احترام، اطلاعات جلسه «{{meeting_subject}}» تغییر کرده است. زمان جدید: {{meeting_date}} ساعت {{meeting_time}}، محل: {{location}}.',
    ARRAY['meeting_subject','meeting_date','meeting_time','location'], true
  ),
  (
    'meeting', 'informee_cancel', 'external',
    'لغو جلسه برای مطلع خارج سازمان',
    'با سلام و احترام، جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} که جهت اطلاع شما اعلام شده بود لغو شد.',
    ARRAY['meeting_subject','meeting_date'], true
  )
ON CONFLICT (category, event_type, audience) DO NOTHING;

-- Give the three informee events the same immediate delivery semantics as their
-- participant/external counterparts.
INSERT INTO public.sms_delivery_policies (
  category, event_type, delivery_mode, window_start, window_end, fixed_time,
  timezone, locked_immediate
)
SELECT
  category,
  CASE event_type
    WHEN 'invite' THEN 'informee_invite'
    WHEN 'change' THEN 'informee_change'
    WHEN 'cancel' THEN 'informee_cancel'
  END,
  delivery_mode, window_start, window_end, fixed_time, timezone, locked_immediate
FROM public.sms_delivery_policies
WHERE category = 'meeting'
  AND event_type IN ('invite','change','cancel')
ON CONFLICT (category, event_type) DO NOTHING;
