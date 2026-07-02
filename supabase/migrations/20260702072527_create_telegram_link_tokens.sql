CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text NOT NULL UNIQUE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  used        boolean NOT NULL DEFAULT false,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_user_id ON telegram_link_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_link_tokens_token   ON telegram_link_tokens(token);

ALTER TABLE telegram_link_tokens ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge functions) may read/write tokens.
-- Authenticated users have no direct access; they interact through the
-- telegram-link-generate edge function which uses the service role key.
CREATE POLICY "service_select_telegram_link_tokens" ON telegram_link_tokens
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "service_insert_telegram_link_tokens" ON telegram_link_tokens
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "service_delete_telegram_link_tokens" ON telegram_link_tokens
  FOR DELETE TO authenticated USING (auth.uid() = user_id);
