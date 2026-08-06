-- Phase 5C-2: Automatic cleanup of Password Gateway Authorizations on session deletion
-- Adds FK from password_gateway_session_authorizations.session_id to auth.sessions(id) ON DELETE CASCADE
-- so that authorizations are removed automatically when sessions are deleted.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'password_gateway_session_authorizations_session_id_fkey'
      AND conrelid =
        'private.password_gateway_session_authorizations'::regclass
  ) THEN
    RAISE EXCEPTION
      'PASSWORD_GATEWAY_SESSION_FK_ALREADY_EXISTS';
  END IF;

  ALTER TABLE private.password_gateway_session_authorizations
  ADD CONSTRAINT
    password_gateway_session_authorizations_session_id_fkey
  FOREIGN KEY (session_id)
  REFERENCES auth.sessions(id)
  ON DELETE CASCADE;
END
$$;
