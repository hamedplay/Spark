-- Run after fix_admin_profile_metadata_update. All fixtures roll back.
BEGIN;
DO $test$
DECLARE
  delayed_id uuid := gen_random_uuid();
  direct_id uuid := gen_random_uuid();
  legacy_id uuid := gen_random_uuid();
  event_count bigint;
BEGIN
  -- Reproduce Auth Admin API ordering: INSERT, then trusted app_metadata UPDATE.
  INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (delayed_id, 'authenticated', 'authenticated', 'spark-delayed-probe@example.invalid', '{}',
    '{"username":"spark.delayed.probe","email":"spark-delayed-probe@example.invalid","phone":"+989120000039","full_name":"Delayed test"}', now(), now());
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = delayed_id) THEN
    RAISE EXCEPTION 'Fixture should not have a profile before trusted metadata';
  END IF;
  UPDATE auth.users SET raw_app_meta_data = '{"registration_flow":"admin_created_v1","provision_is_admin":false}'
  WHERE id = delayed_id;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = delayed_id
      AND registration_source = 'admin_created' AND account_status = 'ACTIVE'
      AND is_active AND NOT is_admin AND NOT is_security_admin AND full_name = 'Delayed test') THEN
    RAISE EXCEPTION 'Delayed admin profile was not provisioned correctly';
  END IF;
  SELECT count(*) INTO event_count FROM public.security_audit_events WHERE target_user_id = delayed_id;
  -- Repeated app metadata writes cannot duplicate a profile, audit, or elevate roles.
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"provision_is_admin":true}'::jsonb
  WHERE id = delayed_id;
  IF (SELECT count(*) FROM public.security_audit_events WHERE target_user_id = delayed_id) <> event_count
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = delayed_id AND is_admin) THEN
    RAISE EXCEPTION 'Existing profile was reprovisioned';
  END IF;
  -- Preserve INSERT provisioning for environments that supply metadata at INSERT.
  INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (direct_id, 'authenticated', 'authenticated', 'spark-direct-probe@example.invalid',
    '{"registration_flow":"admin_created_v1","provision_is_admin":false}',
    '{"username":"spark.direct.probe","email":"spark-direct-probe@example.invalid","phone":"+989120000049"}', now(), now());
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data WHERE id = direct_id;
  IF (SELECT count(*) FROM public.profiles WHERE user_id = direct_id AND registration_source = 'admin_created') <> 1 THEN
    RAISE EXCEPTION 'INSERT provisioning regressed';
  END IF;
  -- Simulate a previously orphaned admin account and exercise migration backfill.
  DELETE FROM public.profiles WHERE user_id = direct_id;
  UPDATE auth.users AS u SET raw_app_meta_data = u.raw_app_meta_data
  WHERE u.raw_app_meta_data ->> 'registration_flow' = 'admin_created_v1'
    AND NOT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.user_id = u.id);
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = direct_id AND registration_source = 'admin_created') THEN
    RAISE EXCEPTION 'Orphan admin profile backfill failed';
  END IF;
  -- User-editable metadata must not enable admin provisioning.
  INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (legacy_id, 'authenticated', 'authenticated', 'spark-legacy-probe@example.invalid', '{}', '{}', now(), now());
  UPDATE auth.users SET raw_user_meta_data = '{"registration_flow":"admin_created_v1"}',
    raw_app_meta_data = '{"provider":"email"}' WHERE id = legacy_id;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = legacy_id) THEN
    RAISE EXCEPTION 'Untrusted metadata enabled provisioning';
  END IF;
END;
$test$;
ROLLBACK;
