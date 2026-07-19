-- ============================================================
-- Migration: Minutes Phase 2 — Corrective RLS for changes_requested editing
--
-- Replaces the minutes UPDATE policy so that both 'draft' AND
-- 'changes_requested' statuses are editable by secretary/created_by/admin.
-- Mirrors the same change on the three child tables' UPDATE/DELETE policies
-- so that child rows can be synced while a minute is in changes_requested.
--
-- No data is changed. No new tables. No functions.
-- ============================================================

-- ----------------------------------------------------------------------------
-- 1. minutes UPDATE policy
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS minutes_update ON public.minutes;

CREATE POLICY minutes_update
  ON public.minutes
  FOR UPDATE TO authenticated
  USING (
    status IN ('draft', 'changes_requested')
    AND (
      public.is_current_user_admin()
      OR created_by_user_id = auth.uid()
      OR secretary_user_id = auth.uid()
      OR chair_user_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('draft', 'changes_requested')
  );

-- ----------------------------------------------------------------------------
-- 2. minutes_participants UPDATE + DELETE policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS minutes_participants_update ON public.minutes_participants;
DROP POLICY IF EXISTS minutes_participants_delete ON public.minutes_participants;

CREATE POLICY minutes_participants_update
  ON public.minutes_participants
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_participants.minute_id
        AND m.status IN ('draft', 'changes_requested')
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
      WHERE m.id = public.minutes_participants.minute_id
        AND m.status IN ('draft', 'changes_requested')
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

CREATE POLICY minutes_participants_delete
  ON public.minutes_participants
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_participants.minute_id
        AND m.status IN ('draft', 'changes_requested')
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 3. minutes_external_participants UPDATE + DELETE policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS minutes_external_participants_update ON public.minutes_external_participants;
DROP POLICY IF EXISTS minutes_external_participants_delete ON public.minutes_external_participants;

CREATE POLICY minutes_external_participants_update
  ON public.minutes_external_participants
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_external_participants.minute_id
        AND m.status IN ('draft', 'changes_requested')
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
      WHERE m.id = public.minutes_external_participants.minute_id
        AND m.status IN ('draft', 'changes_requested')
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

CREATE POLICY minutes_external_participants_delete
  ON public.minutes_external_participants
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_external_participants.minute_id
        AND m.status IN ('draft', 'changes_requested')
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 4. minutes_agenda_results UPDATE + DELETE policies
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS minutes_agenda_results_update ON public.minutes_agenda_results;
DROP POLICY IF EXISTS minutes_agenda_results_delete ON public.minutes_agenda_results;

CREATE POLICY minutes_agenda_results_update
  ON public.minutes_agenda_results
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_agenda_results.minute_id
        AND m.status IN ('draft', 'changes_requested')
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
      WHERE m.id = public.minutes_agenda_results.minute_id
        AND m.status IN ('draft', 'changes_requested')
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

CREATE POLICY minutes_agenda_results_delete
  ON public.minutes_agenda_results
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_agenda_results.minute_id
        AND m.status IN ('draft', 'changes_requested')
        AND (
          public.is_current_user_admin()
          OR m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );
