CREATE OR REPLACE FUNCTION public.sync_normalized_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF NEW.account_status = 'RETIRED' THEN
    NEW.username := NULL;
    NEW.email := NULL;
    NEW.phone := NULL;
    NEW.normalized_username := NULL;
    NEW.normalized_email := NULL;
    NEW.normalized_phone := NULL;
    RETURN NEW;
  END IF;

  IF NEW.username IS NOT NULL AND btrim(NEW.username) <> '' THEN
    NEW.normalized_username := lower(btrim(NEW.username));
  ELSE
    NEW.normalized_username := NULL;
  END IF;

  IF NEW.email IS NOT NULL AND btrim(NEW.email) <> '' THEN
    NEW.normalized_email := lower(btrim(NEW.email));
  ELSE
    NEW.normalized_email := NULL;
  END IF;

  IF NEW.phone IS NOT NULL AND btrim(NEW.phone) <> '' THEN
    NEW.normalized_phone := '+' || public.normalize_iran_phone(NEW.phone);
    IF NEW.normalized_phone = '+' THEN
      NEW.normalized_phone := NULL;
    END IF;
  ELSE
    NEW.normalized_phone := NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_normalized_profile_fields ON public.profiles;
CREATE TRIGGER trg_sync_normalized_profile_fields
BEFORE INSERT OR UPDATE OF username, email, phone, account_status
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_normalized_profile_fields();

UPDATE public.profiles
SET username = NULL,
    email = NULL,
    phone = NULL,
    normalized_username = NULL,
    normalized_email = NULL,
    normalized_phone = NULL
WHERE account_status = 'RETIRED';

ALTER TABLE public.profiles
DROP CONSTRAINT IF EXISTS profiles_retired_identifiers_released;
ALTER TABLE public.profiles
ADD CONSTRAINT profiles_retired_identifiers_released
CHECK (
  account_status <> 'RETIRED'
  OR (
    username IS NULL
    AND email IS NULL
    AND phone IS NULL
    AND normalized_username IS NULL
    AND normalized_email IS NULL
    AND normalized_phone IS NULL
  )
);

CREATE OR REPLACE FUNCTION public.check_public_registration_identifiers_available(
  p_normalized_username text,
  p_normalized_email text,
  p_normalized_phone text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_username text;
  v_email text;
  v_phone text;
BEGIN
  v_username := NULLIF(lower(btrim(p_normalized_username)), '');
  v_email := NULLIF(lower(btrim(p_normalized_email)), '');
  v_phone := NULLIF(public.normalize_iran_phone(p_normalized_phone), '');

  IF v_username IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.normalized_username = v_username
      AND COALESCE(p.account_status, 'ACTIVE') <> 'RETIRED'
  ) THEN
    RETURN false;
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.normalized_email = v_email
      AND COALESCE(p.account_status, 'ACTIVE') <> 'RETIRED'
  ) THEN
    RETURN false;
  END IF;

  IF v_email IS NOT NULL AND EXISTS (
    SELECT 1
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND lower(u.email) = v_email
      AND COALESCE(p.account_status, 'ACTIVE') <> 'RETIRED'
  ) THEN
    RETURN false;
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE public.normalize_iran_phone(p.normalized_phone) = v_phone
      AND COALESCE(p.account_status, 'ACTIVE') <> 'RETIRED'
  ) THEN
    RETURN false;
  END IF;

  IF v_phone IS NOT NULL AND EXISTS (
    SELECT 1
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE u.deleted_at IS NULL
      AND public.normalize_iran_phone(u.phone) = v_phone
      AND COALESCE(p.account_status, 'ACTIVE') <> 'RETIRED'
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_public_registration_identifiers_available(text, text, text) TO service_role;
