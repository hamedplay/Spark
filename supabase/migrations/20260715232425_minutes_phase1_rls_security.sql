-- ============================================================================
-- Migration: minutes_phase1_rls_security
-- Description: RLS policies + helper functions + immutability trigger
--              for Minutes Phase 1 (Draft management only)
-- Tables affected: minutes, minutes_participants,
--                  minutes_external_participants, minutes_agenda_results
-- No changes to existing tables, policies, functions, or triggers
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helper Function: can_create_minutes_for_meeting
--    SECURITY DEFINER — bypasses RLS on meetings to check meeting_manager
--    Returns boolean only — no information leakage
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_create_minutes_for_meeting(p_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.meetings m
         WHERE m.id = p_meeting_id
           AND m.status_type = 'scheduled'
           AND m.calendar_id IS NOT NULL
           AND (
               public.is_current_user_admin()
               OR m.user_id = auth.uid()
               OR m.meeting_manager = auth.uid()
           )
    );
$$;

REVOKE ALL ON FUNCTION public.can_create_minutes_for_meeting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_create_minutes_for_meeting(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Helper Function: can_view_restricted_minutes_meeting
--    SECURITY DEFINER — bypasses RLS on meetings to check participant_user_ids
--    and meeting_inbox without being filtered by meetings SELECT policies.
--    Fixes the private-calendar blind spot for restricted minutes.
--    Returns boolean only — no information leakage
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_view_restricted_minutes_meeting(p_meeting_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.meetings m
         WHERE m.id = p_meeting_id
           AND (
               auth.uid() = ANY(COALESCE(m.participant_user_ids, '{}'::uuid[]))
               OR EXISTS (
                   SELECT 1
                     FROM public.meeting_inbox mi
                    WHERE mi.meeting_id = p_meeting_id
                      AND mi.user_id = auth.uid()
               )
           )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_restricted_minutes_meeting(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_restricted_minutes_meeting(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Trigger Function: check_minutes_immutable_fields
--    NOT SECURITY DEFINER — runs as invoking user
--    Only compares OLD vs NEW — no table queries needed
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_minutes_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.meeting_id IS DISTINCT FROM OLD.meeting_id THEN
        RAISE EXCEPTION 'meeting_id is immutable and cannot be changed';
    END IF;
    IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
        RAISE EXCEPTION 'created_by_user_id is immutable and cannot be changed';
    END IF;
    RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_minutes_immutable_fields() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Trigger: protect_minutes_immutable_fields
--    BEFORE UPDATE FOR EACH ROW on public.minutes
-- ----------------------------------------------------------------------------
CREATE TRIGGER protect_minutes_immutable_fields
    BEFORE UPDATE ON public.minutes
    FOR EACH ROW
    EXECUTE FUNCTION public.check_minutes_immutable_fields();

-- ============================================================================
-- 5. Policies: public.minutes
-- ============================================================================

-- 5.1 SELECT
CREATE POLICY minutes_select
    ON public.minutes
    FOR SELECT TO authenticated
    USING (
        public.is_current_user_admin()
        OR created_by_user_id = auth.uid()
        OR secretary_user_id = auth.uid()
        OR chair_user_id = auth.uid()
        OR (
            confidentiality IN ('organizational', 'public')
            AND EXISTS (
                SELECT 1
                  FROM public.meetings m
                 WHERE m.id = public.minutes.meeting_id
            )
        )
        OR (
            confidentiality = 'restricted'
            AND public.can_view_restricted_minutes_meeting(public.minutes.meeting_id)
        )
    );

-- 5.2 INSERT
CREATE POLICY minutes_insert
    ON public.minutes
    FOR INSERT TO authenticated
    WITH CHECK (
        created_by_user_id = auth.uid()
        AND status = 'draft'
        AND public.can_create_minutes_for_meeting(meeting_id)
    );

-- 5.3 UPDATE
CREATE POLICY minutes_update
    ON public.minutes
    FOR UPDATE TO authenticated
    USING (
        status = 'draft'
        AND (
            public.is_current_user_admin()
            OR created_by_user_id = auth.uid()
            OR secretary_user_id = auth.uid()
            OR chair_user_id = auth.uid()
        )
    )
    WITH CHECK (
        status = 'draft'
    );

-- 5.4 DELETE
CREATE POLICY minutes_delete
    ON public.minutes
    FOR DELETE TO authenticated
    USING (
        status = 'draft'
        AND (
            public.is_current_user_admin()
            OR created_by_user_id = auth.uid()
        )
    );

-- ============================================================================
-- 6. Policies: public.minutes_participants
-- ============================================================================

-- 6.1 SELECT — inherit from parent minute
CREATE POLICY minutes_participants_select
    ON public.minutes_participants
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_participants.minute_id
        )
    );

-- 6.2 INSERT
CREATE POLICY minutes_participants_insert
    ON public.minutes_participants
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_participants.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- 6.3 UPDATE
CREATE POLICY minutes_participants_update
    ON public.minutes_participants
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_participants.minute_id
               AND m.status = 'draft'
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
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_participants.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- 6.4 DELETE
CREATE POLICY minutes_participants_delete
    ON public.minutes_participants
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_participants.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- ============================================================================
-- 7. Policies: public.minutes_external_participants
-- ============================================================================

-- 7.1 SELECT — inherit from parent minute
CREATE POLICY minutes_external_participants_select
    ON public.minutes_external_participants
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_external_participants.minute_id
        )
    );

-- 7.2 INSERT
CREATE POLICY minutes_external_participants_insert
    ON public.minutes_external_participants
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_external_participants.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- 7.3 UPDATE
CREATE POLICY minutes_external_participants_update
    ON public.minutes_external_participants
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_external_participants.minute_id
               AND m.status = 'draft'
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
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_external_participants.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- 7.4 DELETE
CREATE POLICY minutes_external_participants_delete
    ON public.minutes_external_participants
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_external_participants.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- ============================================================================
-- 8. Policies: public.minutes_agenda_results
-- ============================================================================

-- 8.1 SELECT — inherit from parent minute
CREATE POLICY minutes_agenda_results_select
    ON public.minutes_agenda_results
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_agenda_results.minute_id
        )
    );

-- 8.2 INSERT
CREATE POLICY minutes_agenda_results_insert
    ON public.minutes_agenda_results
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_agenda_results.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- 8.3 UPDATE
CREATE POLICY minutes_agenda_results_update
    ON public.minutes_agenda_results
    FOR UPDATE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_agenda_results.minute_id
               AND m.status = 'draft'
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
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_agenda_results.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );

-- 8.4 DELETE
CREATE POLICY minutes_agenda_results_delete
    ON public.minutes_agenda_results
    FOR DELETE TO authenticated
    USING (
        EXISTS (
            SELECT 1
              FROM public.minutes m
             WHERE m.id = public.minutes_agenda_results.minute_id
               AND m.status = 'draft'
               AND (
                   public.is_current_user_admin()
                   OR m.created_by_user_id = auth.uid()
                   OR m.secretary_user_id = auth.uid()
                   OR m.chair_user_id = auth.uid()
               )
        )
    );
