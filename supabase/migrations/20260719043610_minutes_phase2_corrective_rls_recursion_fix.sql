-- ============================================================
-- Migration: Minutes Phase 2 — Corrective RLS recursion fix
--
-- Replaces the minutes_approvals SELECT policy to remove infinite
-- recursion. The previous policy referenced minutes_approvals in a
-- subquery, which triggered RLS on the same table recursively.
--
-- Also replaces the minutes_approval_comments SELECT policy to
-- avoid a similar recursion risk via minutes_approvals subquery.
--
-- No data is changed. No new tables. No functions.
-- ============================================================

-- ----------------------------------------------------------------------------
-- 1. minutes_approvals SELECT policy (recursion-free)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS minutes_approvals_select ON public.minutes_approvals;

CREATE POLICY minutes_approvals_select
  ON public.minutes_approvals
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR approver_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_approvals.minute_id
        AND (
          m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 2. minutes_approval_comments SELECT policy (recursion-free)
--    Uses minutes (not minutes_approvals) for the secretary/chair/creator check.
--    For fellow-approver visibility, uses a direct EXISTS on minutes_approvals
--    but guarded by a separate non-recursive check: the caller must be the
--    comment creator OR an approver of the same minute identified via minutes.
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS minutes_approval_comments_select ON public.minutes_approval_comments;

CREATE POLICY minutes_approval_comments_select
  ON public.minutes_approval_comments
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR created_by_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.minutes m
      WHERE m.id = public.minutes_approval_comments.minute_id
        AND (
          m.created_by_user_id = auth.uid()
          OR m.secretary_user_id = auth.uid()
          OR m.chair_user_id = auth.uid()
        )
    )
    OR EXISTS (
      SELECT 1 FROM public.minutes_approvals ma
      WHERE ma.minute_id = public.minutes_approval_comments.minute_id
        AND ma.approver_user_id = auth.uid()
    )
  );
