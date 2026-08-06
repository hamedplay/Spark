-- Phase 5E-C5A: Add phone_otp Gateway Login Method
-- Only drops and recreates the login_method CHECK constraint to add 'phone_otp'.
-- No RPC, no edge function, no DML, no RLS/ACL changes.

DO $$
BEGIN
  -- Fail fast if the expected constraint does not exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'password_gateway_session_authorizations_login_method_check'
  ) THEN
    RAISE EXCEPTION 'Required constraint password_gateway_session_authorizations_login_method_check not found';
  END IF;
END $$;

ALTER TABLE private.password_gateway_session_authorizations
  DROP CONSTRAINT password_gateway_session_authorizations_login_method_check;

ALTER TABLE private.password_gateway_session_authorizations
  ADD CONSTRAINT password_gateway_session_authorizations_login_method_check
  CHECK (
    login_method IN (
      'username',
      'email',
      'phone',
      'public_registration',
      'phone_otp'
    )
  );
