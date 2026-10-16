-- Restore browser EXECUTE only for management RPCs that are called directly
-- from the authenticated UI and already enforce full-session authorization,
-- permission checks, and management scope internally.
--
-- Keep anon denied and preserve the centralized fail-closed ACL policy.

INSERT INTO private.security_definer_rpc_acl_allowlist
  (signature, allow_authenticated, allow_anon, rationale)
VALUES
  (
    'public.get_management_decision_detail_v1(uuid)',
    true,
    false,
    'Authenticated management UI; function enforces full session authorization, management_decisions.view permission, and decision scope.'
  ),
  (
    'public.get_management_task_detail_v1(uuid)',
    true,
    false,
    'Authenticated management UI; function enforces full session authorization, management_tasks.view permission, and task scope.'
  ),
  (
    'public.manage_management_decision_v1(uuid,timestamp with time zone,text,integer,text)',
    true,
    false,
    'Authenticated management UI; function enforces full session authorization, management_decisions.manage permission, decision scope, and optimistic concurrency.'
  ),
  (
    'public.manage_management_task_v1(uuid,text,integer,text,text,uuid,text)',
    true,
    false,
    'Authenticated management UI; function enforces full session authorization, management_tasks.manage permission, task scope, and assignee scope.'
  )
ON CONFLICT (signature) DO UPDATE
SET allow_authenticated = EXCLUDED.allow_authenticated,
    allow_anon = EXCLUDED.allow_anon,
    rationale = EXCLUDED.rationale,
    updated_at = now();

SELECT private.apply_public_security_definer_acl_policy();

DO $validation$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.get_management_decision_detail_v1(uuid)',
    'public.get_management_task_detail_v1(uuid)',
    'public.manage_management_decision_v1(uuid,timestamp with time zone,text,integer,text)',
    'public.manage_management_task_v1(uuid,text,integer,text,text,uuid,text)'
  ]
  LOOP
    IF NOT has_function_privilege('authenticated', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'authenticated EXECUTE missing for %', v_signature;
    END IF;

    IF has_function_privilege('anon', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'anon unexpectedly has EXECUTE for %', v_signature;
    END IF;

    IF NOT has_function_privilege('service_role', to_regprocedure(v_signature), 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role EXECUTE missing for %', v_signature;
    END IF;
  END LOOP;
END;
$validation$;
