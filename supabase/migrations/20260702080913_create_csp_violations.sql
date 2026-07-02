CREATE TABLE IF NOT EXISTS csp_violations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reported_at     timestamptz NOT NULL    DEFAULT now(),
  -- Fields from the CSP violation report object
  document_uri    text,
  referrer        text,
  blocked_uri     text,
  violated_directive  text,
  effective_directive text,
  original_policy text,
  disposition     text,   -- 'enforce' | 'report'
  status_code     integer,
  source_file     text,
  line_number     integer,
  column_number   integer,
  -- Raw payload stored for debugging edge cases
  raw_report      jsonb
);

CREATE INDEX IF NOT EXISTS idx_csp_violations_reported_at
  ON csp_violations (reported_at DESC);

CREATE INDEX IF NOT EXISTS idx_csp_violations_blocked_uri
  ON csp_violations (blocked_uri);

CREATE INDEX IF NOT EXISTS idx_csp_violations_violated_directive
  ON csp_violations (violated_directive);

ALTER TABLE csp_violations ENABLE ROW LEVEL SECURITY;

-- Only admins may read violation reports; no authenticated writes
-- (the edge function uses the service role key to insert).
CREATE POLICY "admin_select_csp_violations" ON csp_violations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
        AND profiles.is_admin = true
    )
  );
