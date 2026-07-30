/*
# Allow minutes child table INSERT during changes_requested status

## Purpose
When a minutes record has status `changes_requested`, the `update_minutes_draft`
RPC deletes and re-inserts child rows (participants, external participants,
agenda results). The DELETE and UPDATE policies on these tables already accept
both `draft` and `changes_requested`, but the INSERT policies only accept
`draft`. This causes the re-insert to fail with an RLS violation during
`changes_requested` edits, which can silently lose child data (DELETE succeeds,
INSERT fails).

## Changes
Three INSERT policies are updated to accept `changes_requested` in addition
to `draft`:

1. `minutes_participants_insert` on `public.minutes_participants`
2. `minutes_external_participants_insert` on `public.minutes_external_participants`
3. `minutes_agenda_results_insert` on `public.minutes_agenda_results`

The status condition changes from:
  m.status = 'draft'
to:
  m.status IN ('draft', 'changes_requested')

The ownership/permission check is preserved exactly:
  public.is_current_user_admin()
  OR m.created_by_user_id = auth.uid()
  OR m.secretary_user_id = auth.uid()
  OR m.chair_user_id = auth.uid()

## Security
- No new policies created — existing INSERT policies are dropped and recreated
  with the broadened status condition.
- No SELECT, UPDATE, or DELETE policies are touched.
- No SECURITY DEFINER functions created.
- No public/unrestricted access granted.
- The ownership check remains identical to the existing DELETE/UPDATE policies,
  so the permission model is unchanged — only the accepted statuses broaden.
- `minutes_decisions` policies are NOT modified (already accept both statuses).
*/

-- minutes_participants INSERT
DROP POLICY IF EXISTS "minutes_participants_insert" ON public.minutes_participants;
CREATE POLICY "minutes_participants_insert"
ON public.minutes_participants FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.minutes m
    WHERE m.id = minutes_participants.minute_id
      AND m.status IN ('draft', 'changes_requested')
      AND (
        public.is_current_user_admin()
        OR m.created_by_user_id = auth.uid()
        OR m.secretary_user_id = auth.uid()
        OR m.chair_user_id = auth.uid()
      )
  )
);

-- minutes_external_participants INSERT
DROP POLICY IF EXISTS "minutes_external_participants_insert" ON public.minutes_external_participants;
CREATE POLICY "minutes_external_participants_insert"
ON public.minutes_external_participants FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.minutes m
    WHERE m.id = minutes_external_participants.minute_id
      AND m.status IN ('draft', 'changes_requested')
      AND (
        public.is_current_user_admin()
        OR m.created_by_user_id = auth.uid()
        OR m.secretary_user_id = auth.uid()
        OR m.chair_user_id = auth.uid()
      )
  )
);

-- minutes_agenda_results INSERT
DROP POLICY IF EXISTS "minutes_agenda_results_insert" ON public.minutes_agenda_results;
CREATE POLICY "minutes_agenda_results_insert"
ON public.minutes_agenda_results FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.minutes m
    WHERE m.id = minutes_agenda_results.minute_id
      AND m.status IN ('draft', 'changes_requested')
      AND (
        public.is_current_user_admin()
        OR m.created_by_user_id = auth.uid()
        OR m.secretary_user_id = auth.uid()
        OR m.chair_user_id = auth.uid()
      )
  )
);
