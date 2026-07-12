-- Ensure RLS is enabled and forced on user_presence
ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_presence FORCE ROW LEVEL SECURITY;

-- Drop existing policies and recreate them cleanly
DROP POLICY IF EXISTS "Authenticated users can read presence" ON public.user_presence;
DROP POLICY IF EXISTS "Users can insert own presence" ON public.user_presence;
DROP POLICY IF EXISTS "Users can update own presence" ON public.user_presence;

-- Select: any authenticated user can see presence (for chat online status)
CREATE POLICY "Authenticated users can view presence"
ON public.user_presence
FOR SELECT
TO authenticated
USING (true);

-- Insert: users can only insert their own presence
CREATE POLICY "Users can insert own presence"
ON public.user_presence
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = user_id);

-- Update: users can only update their own presence
CREATE POLICY "Users can update own presence"
ON public.user_presence
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- The primary key (user_id) already serves as the unique constraint for upsert onConflict
