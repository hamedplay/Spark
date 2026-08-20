-- Fix decision assignment notification copy on minute publication.
-- The notification renderer uses {{placeholder}} syntax; the existing template
-- used single braces and therefore delivered unresolved placeholder text.

DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.notification_templates
  SET
    title = 'مصوبه جدید به شما محول شد',
    body = 'مصوبه «{{decision_title}}» از صورت‌جلسه «{{minute_title}}» برای پیگیری و اقدام به شما محول شد. لطفاً وضعیت آن را در بخش «مصوبات من» پیگیری کنید.',
    placeholders = ARRAY[
      'decision_title',
      'decision_owner_name',
      'decision_due_date',
      'responsible_unit',
      'decision_link',
      'minute_title'
    ]::text[],
    updated_at = now()
  WHERE category = 'decision'
    AND event_type = 'decision_assigned'
    AND audience = 'decision_owner';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one decision_assigned/decision_owner template, updated %', v_updated;
  END IF;
END
$$;
