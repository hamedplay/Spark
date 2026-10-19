-- Admin Auth creation inserts auth.users before writing app_metadata.
-- Keep INSERT/public registration behavior; also provision admin profiles when
-- trusted app_metadata arrives through UPDATE. Preserve the installed function,
-- its owner, ACLs, lifecycle validation, and audit behavior.
DO $migration$
DECLARE
  definition text;
  anchor constant text := $anchor$v_registration_flow := NEW.raw_app_meta_data ->> 'registration_flow';$anchor$;
  update_guard constant text := $guard$

-- admin_profile_metadata_update_v1: existing profiles must never be reprovisioned.
IF TG_OP = 'UPDATE' THEN
  IF v_registration_flow IS DISTINCT FROM 'admin_created_v1'
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
    RETURN NEW;
  END IF;
END IF;
$guard$;
BEGIN
  SELECT pg_get_functiondef('public.on_auth_user_created_lifecycle_profile()'::regprocedure)
    INTO definition;
  IF strpos(definition, 'admin_profile_metadata_update_v1') = 0 THEN
    IF (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) THEN
      RAISE EXCEPTION 'Unexpected lifecycle function definition; migration requires review';
    END IF;
    EXECUTE replace(definition, anchor, anchor || update_guard);
  END IF;
END;
$migration$;

DROP TRIGGER IF EXISTS on_auth_user_admin_metadata_profile ON auth.users;
CREATE TRIGGER on_auth_user_admin_metadata_profile
AFTER UPDATE OF raw_app_meta_data ON auth.users
FOR EACH ROW
WHEN (NEW.raw_app_meta_data ->> 'registration_flow' = 'admin_created_v1')
EXECUTE FUNCTION public.on_auth_user_created_lifecycle_profile();

-- Recover only admin-created Auth accounts with missing profiles. The original
-- lifecycle function supplies fields/status and writes its normal audit events.
-- Existing profiles and public/legacy users are not modified.
UPDATE auth.users AS u
SET raw_app_meta_data = u.raw_app_meta_data
WHERE u.raw_app_meta_data ->> 'registration_flow' = 'admin_created_v1'
  AND NOT EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.user_id = u.id);
