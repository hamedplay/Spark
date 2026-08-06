-- Phase 5E-B1 Fix: Challenge Claim State Constraint
-- Drops the tautological constraint and adds a meaningful claim state consistency check.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'phone_otp_login_challenges_v2_non_processing_no_claim_required'
  ) THEN
    RAISE EXCEPTION 'Constraint phone_otp_login_challenges_v2_non_processing_no_claim_required does not exist';
  END IF;
END $$;

ALTER TABLE private.phone_otp_login_challenges_v2
  DROP CONSTRAINT phone_otp_login_challenges_v2_non_processing_no_claim_required;

ALTER TABLE private.phone_otp_login_challenges_v2
  ADD CONSTRAINT phone_otp_login_challenges_v2_claim_state_consistency
    CHECK (
      (
        status = 'processing'
        AND claim_id IS NOT NULL
        AND claim_expires_at IS NOT NULL
      )
      OR
      (
        status <> 'processing'
        AND claim_id IS NULL
        AND claim_expires_at IS NULL
      )
    );
