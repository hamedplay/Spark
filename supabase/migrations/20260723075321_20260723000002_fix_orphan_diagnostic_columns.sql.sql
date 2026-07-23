/*
# Fix diagnose_phone_only_orphans column references

Updates the `diagnose_phone_only_orphans()` function to use the correct
column names found in the actual schema:
- meetings.user_id (not created_by)
- minutes.created_by_user_id (not created_by)
- tasks.user_id (not assigned_to)
- notes.user_id (correct)
- chat_messages.sender_id (correct)
*/

CREATE OR REPLACE FUNCTION public.diagnose_phone_only_orphans()
RETURNS TABLE(
  auth_user_id uuid,
  masked_phone text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  has_profile boolean,
  has_identity boolean,
  has_sessions boolean,
  has_dependent_records boolean,
  primary_profile_user_id uuid,
  primary_profile_masked_phone text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id AS auth_user_id,
    public.mask_phone_partial(u.phone) AS masked_phone,
    u.created_at,
    u.last_sign_in_at,
    EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id = u.id) AS has_profile,
    EXISTS(SELECT 1 FROM auth.identities i WHERE i.user_id = u.id) AS has_identity,
    EXISTS(SELECT 1 FROM auth.sessions s WHERE s.user_id = u.id) AS has_sessions,
    (
      EXISTS(SELECT 1 FROM public.meetings m WHERE m.user_id = u.id)
      OR EXISTS(SELECT 1 FROM public.minutes mn WHERE mn.created_by_user_id = u.id)
      OR EXISTS(SELECT 1 FROM public.tasks t WHERE t.user_id = u.id)
      OR EXISTS(SELECT 1 FROM public.notes n WHERE n.user_id = u.id)
      OR EXISTS(SELECT 1 FROM public.chat_messages cm WHERE cm.sender_id = u.id)
    ) AS has_dependent_records,
    (
      SELECT p2.user_id FROM public.profiles p2
      WHERE p2.is_active = true
        AND public.normalize_iran_phone(p2.phone) = u.phone
        AND p2.user_id <> u.id
      ORDER BY p2.created_at ASC
      LIMIT 1
    ) AS primary_profile_user_id,
    (
      SELECT public.mask_phone_partial(p2.phone) FROM public.profiles p2
      WHERE p2.is_active = true
        AND public.normalize_iran_phone(p2.phone) = u.phone
        AND p2.user_id <> u.id
      ORDER BY p2.created_at ASC
      LIMIT 1
    ) AS primary_profile_masked_phone
  FROM auth.users u
  WHERE u.email IS NULL
    AND u.phone IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = u.id)
  ORDER BY u.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.diagnose_phone_only_orphans() TO authenticated;
