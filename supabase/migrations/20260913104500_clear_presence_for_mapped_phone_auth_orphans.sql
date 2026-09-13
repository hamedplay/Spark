DELETE FROM public.user_presence up
WHERE up.user_id IN (
  SELECT d.auth_user_id
  FROM public.diagnose_phone_only_orphans() d
  JOIN public.profiles p
    ON p.user_id = d.primary_profile_user_id
  WHERE d.primary_profile_user_id IS NOT NULL
    AND d.has_profile = false
    AND d.has_identity = false
    AND d.has_sessions = false
    AND p.is_active = true
    AND p.account_status = 'ACTIVE'
    AND p.phone_verified_at IS NOT NULL
);
