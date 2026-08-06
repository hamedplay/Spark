-- Phase 5C-1: Controlled activation of Password Gateway Enforcement
-- Preserves all existing sessions (grandfathered before cutoff)
DO $$
DECLARE
  v_cutoff timestamptz := clock_timestamp();
  v_updated integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM private.password_gateway_enforcement
    WHERE id = true
  ) THEN
    RAISE EXCEPTION 'PASSWORD_GATEWAY_ENFORCEMENT_ROW_MISSING';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM private.password_gateway_enforcement
    WHERE id = true
      AND enabled = true
  ) THEN
    RAISE EXCEPTION 'PASSWORD_GATEWAY_ALREADY_ENABLED';
  END IF;

  UPDATE private.password_gateway_enforcement
  SET
    enabled = true,
    enforced_after = v_cutoff,
    updated_at = v_cutoff
  WHERE id = true
    AND enabled = false;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'PASSWORD_GATEWAY_CUTOVER_FAILED';
  END IF;
END
$$;