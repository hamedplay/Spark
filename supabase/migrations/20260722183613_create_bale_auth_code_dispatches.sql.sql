-- Idempotency table for Bale auth code dispatches
CREATE TABLE IF NOT EXISTS bale_auth_code_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_ref text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('phone_login', 'phone_password_recovery')),
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('processing', 'sent', 'failed', 'skipped')),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_code text
);

-- Unique constraint for idempotency: one dispatch per (event_ref, purpose, user_id)
CREATE UNIQUE INDEX IF NOT EXISTS bale_auth_code_dispatches_event_purpose_user_idx
  ON bale_auth_code_dispatches (event_ref, purpose, user_id);

CREATE INDEX IF NOT EXISTS bale_auth_code_dispatches_user_id_idx
  ON bale_auth_code_dispatches (user_id);

CREATE INDEX IF NOT EXISTS bale_auth_code_dispatches_created_at_idx
  ON bale_auth_code_dispatches (created_at);

-- RLS: only service_role can access
ALTER TABLE bale_auth_code_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE bale_auth_code_dispatches FORCE ROW LEVEL SECURITY;
-- No policies for anon or authenticated — service_role bypasses RLS
