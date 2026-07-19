-- anon has no legitimate UPDATE path on profiles: signup runs as the newly
-- authenticated user (AuthPage sets the session before writing username),
-- and every UPDATE policy requires auth.uid() = user_id, which is false for
-- anon. The broad table- and column-level UPDATE grants on anon are unused
-- and expose every column (is_admin, telegram_token, ...) if any RLS gap
-- ever appears. Revoke them; authenticated is unchanged.

REVOKE UPDATE ON TABLE public.profiles FROM anon;
