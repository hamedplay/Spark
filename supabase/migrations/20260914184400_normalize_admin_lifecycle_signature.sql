-- The existing lifecycle service was created with a default on the final
-- argument. PostgreSQL does not allow CREATE OR REPLACE to remove a parameter
-- default. Normalize that signature before the registration-alignment migration
-- replaces the function body. No callers depend on the default; all canonical
-- callers already pass p_change_reason explicitly.
DO $$
DECLARE
  v_oid oid;
  v_definition text;
BEGIN
  SELECT p.oid
    INTO v_oid
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'private'
    AND p.proname = 'admin_set_user_lifecycle_service'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_actor_user_id uuid, p_target_user_id uuid, p_session_id uuid, p_action text, p_expected_version bigint, p_change_reason text'
  LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF position('DEFAULT NULL::text' in v_definition) > 0 THEN
    v_definition := replace(v_definition, 'p_change_reason text DEFAULT NULL::text', 'p_change_reason text');
    EXECUTE 'DROP FUNCTION private.admin_set_user_lifecycle_service(uuid,uuid,uuid,text,bigint,text)';
    EXECUTE v_definition;
  END IF;
END;
$$;
