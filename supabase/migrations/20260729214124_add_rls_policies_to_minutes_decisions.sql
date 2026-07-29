/*
# Add RLS policies to minutes_decisions

1. Problem
- `minutes_decisions` has RLS enabled but zero policies.
- This means the anon-key frontend client gets zero rows on SELECT,
  so saved decisions never appear when editing a draft (issue #8).
- The `_sync_minutes_decisions` RPC runs as SECURITY DEFINER and bypasses RLS,
  so writes work, but reads from the client fail silently.

2. Security changes
- Adds 4 policies (SELECT/INSERT/UPDATE/DELETE) matching the exact pattern
  used by `minutes_participants`, `minutes_external_participants`, and
  `minutes_agenda_results`:
  - SELECT: any authenticated user can read decisions whose parent minute is visible.
  - INSERT/UPDATE/DELETE: only admin/creator/secretary/chair when minute status
    is 'draft' or 'changes_requested'.

3. Important notes
- No table structure changes. No column changes. No data changes.
- RLS was already enabled; only policies are added.
- The policies match the existing sibling tables exactly.
*/

-- SELECT: any authenticated user can read decisions for a visible minute
DROP POLICY IF EXISTS "minutes_decisions_select" ON public.minutes_decisions;
CREATE POLICY "minutes_decisions_select"
  ON public.minutes_decisions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_decisions.minute_id
    )
  );

-- INSERT: only admin/creator/secretary/chair when minute is editable
DROP POLICY IF EXISTS "minutes_decisions_insert" ON public.minutes_decisions;
CREATE POLICY "minutes_decisions_insert"
  ON public.minutes_decisions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_decisions.minute_id
        AND m.status = ANY (ARRAY['draft'::text, 'changes_requested'::text])
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

-- UPDATE: same as INSERT
DROP POLICY IF EXISTS "minutes_decisions_update" ON public.minutes_decisions;
CREATE POLICY "minutes_decisions_update"
  ON public.minutes_decisions FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_decisions.minute_id
        AND m.status = ANY (ARRAY['draft'::text, 'changes_requested'::text])
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_decisions.minute_id
        AND m.status = ANY (ARRAY['draft'::text, 'changes_requested'::text])
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

-- DELETE: same as INSERT
DROP POLICY IF EXISTS "minutes_decisions_delete" ON public.minutes_decisions;
CREATE POLICY "minutes_decisions_delete"
  ON public.minutes_decisions FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_decisions.minute_id
        AND m.status = ANY (ARRAY['draft'::text, 'changes_requested'::text])
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );
