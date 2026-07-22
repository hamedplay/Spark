-- Additive columns for Bale auth code delivery preferences and tracking
ALTER TABLE user_bale_mapping
  ADD COLUMN IF NOT EXISTS auth_codes_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_auth_code_delivery_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_auth_code_delivery_status text,
  ADD COLUMN IF NOT EXISTS last_auth_code_delivery_error text;

-- Add CHECK constraint for delivery status values
ALTER TABLE user_bale_mapping
  ADD CONSTRAINT user_bale_mapping_auth_code_status_chk
    CHECK (last_auth_code_delivery_status IS NULL
           OR last_auth_code_delivery_status IN ('sent', 'failed', 'skipped'));
