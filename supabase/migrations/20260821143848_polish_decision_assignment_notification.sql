-- Keep the decision assignment notification concise and explicit for future minute publications.
-- Delivery is already handled by confirm_and_publish_minutes_by_chair -> notification_outbox.

DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE public.notification_templates
  SET
    title = 'مصوبه جدیدی به شما محول شد',
    body = 'مصوبه «{{decision_title}}» از صورت‌جلسه «{{minute_title}}» به شما محول شد. لطفاً برای مشاهده جزئیات و پیگیری اقدامات، به بخش «مصوبات من» مراجعه کنید.',
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
