-- Auto-create a user_presence row when a new auth user signs up.
-- This ensures the row already exists so subsequent upserts only hit UPDATE
-- (which passes RLS), avoiding the INSERT path that can 403 during JWT refresh.
CREATE OR REPLACE FUNCTION public.handle_new_user_presence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_presence (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_presence ON auth.users;
CREATE TRIGGER on_auth_user_created_presence
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_presence();

-- Back-fill any existing auth users that don't yet have a presence row.
INSERT INTO public.user_presence (user_id)
SELECT id FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
