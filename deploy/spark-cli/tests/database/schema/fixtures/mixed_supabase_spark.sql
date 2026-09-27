CREATE TABLE public.meetings (id bigint PRIMARY KEY);
CREATE TABLE auth.users_shadow (id uuid);
CREATE POLICY meetings_read ON public.meetings FOR SELECT USING (true);
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
CREATE INDEX meetings_id_idx ON public.meetings (id);
CREATE TRIGGER meetings_touch BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_net;
