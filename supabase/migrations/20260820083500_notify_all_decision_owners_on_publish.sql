-- Ensure every internal decision owner receives decision_assigned when the chair publishes.
-- The existing producer intentionally skipped the publishing actor; that conflicts with
-- the publication contract when the chair is also the owner of a decision.

DO $$
DECLARE
  v_oid oid;
  v_definition text;
  v_pattern text;
BEGIN
  SELECT p.oid
  INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'confirm_and_publish_minutes_by_chair'
    AND pg_get_function_identity_arguments(p.oid) = 'p_minute_id uuid, p_expected_updated_at timestamp with time zone';

  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'private.confirm_and_publish_minutes_by_chair(uuid,timestamptz) not found';
  END IF;

  v_definition := pg_get_functiondef(v_oid);

  v_pattern := E'LOOP\nIF v_decision_rec.primary_owner_user_id IS DISTINCT FROM v_user_id THEN\nv_owner_name :=';
  IF (length(v_definition) - length(replace(v_definition, v_pattern, ''))) / length(v_pattern) <> 1 THEN
    RAISE EXCEPTION 'Unexpected decision_assigned actor-skip producer shape';
  END IF;
  v_definition := replace(
    v_definition,
    v_pattern,
    E'LOOP\nv_owner_name :='
  );

  v_pattern := E'''تخصیص مصوبه'', ''مصوبه جدید به شما تخصیص داده شد: '' || v_decision_rec.title,';
  IF (length(v_definition) - length(replace(v_definition, v_pattern, ''))) / length(v_pattern) <> 1 THEN
    RAISE EXCEPTION 'Unexpected decision_assigned fallback copy';
  END IF;
  v_definition := replace(
    v_definition,
    v_pattern,
    E'''مصوبه جدید به شما محول شد'', ''مصوبه «'' || v_decision_rec.title || ''» از صورت‌جلسه «'' || COALESCE(v_minute_title, '''') || ''» برای پیگیری و اقدام به شما محول شد.'','
  );

  v_pattern := E'v_event_key\n);\nEND IF;\nEND LOOP;\n\nRETURN jsonb_build_object';
  IF (length(v_definition) - length(replace(v_definition, v_pattern, ''))) / length(v_pattern) <> 1 THEN
    RAISE EXCEPTION 'Unexpected decision_assigned actor-skip closing shape';
  END IF;
  v_definition := replace(
    v_definition,
    v_pattern,
    E'v_event_key\n);\nEND LOOP;\n\nRETURN jsonb_build_object'
  );

  EXECUTE v_definition;
END
$$;
