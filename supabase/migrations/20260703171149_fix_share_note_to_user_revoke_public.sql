-- The previous REVOKE was insufficient: PostgreSQL's PUBLIC pseudo-role
-- still granted EXECUTE implicitly. Revoke from PUBLIC to close the gap,
-- then re-grant only to authenticated (the only legitimate caller).

REVOKE EXECUTE ON FUNCTION public.share_note_to_user(text, text, text, uuid, uuid)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.share_note_to_user(text, text, text, uuid, uuid)
  TO authenticated;
