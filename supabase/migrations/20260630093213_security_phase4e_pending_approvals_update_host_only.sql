-- ═══════════════════════════════════════════════════════════════════
-- Security Phase 4e: pending_approvals UPDATE — restrict to host/admin
-- ---------------------------------------------------------------
-- Before: update_pending_approvals_auth — USING true, WITH CHECK true
--   Any authenticated user could approve/reject pending requests in
--   any conference room regardless of membership.
--
-- After: only users with role IN ('host','admin') in conference_participants
--   for the same room_id may update the record. Consistent with the
--   frontend guard at ConferenceRoom.tsx:289 (isHost || myRole === 'admin').
--
-- Self-cancel path: ApprovalWaitingGate calls onCancel → setWaitingApproval(null)
--   No UPDATE is issued by the requester — records expire via expires_at.
--   Therefore no self-update policy is needed.
--
-- ROLLBACK:
--   DROP POLICY update_pending_approvals_host ON public.pending_approvals;
--   CREATE POLICY update_pending_approvals_auth ON public.pending_approvals
--     FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS update_pending_approvals_auth ON public.pending_approvals;

CREATE POLICY update_pending_approvals_host ON public.pending_approvals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id  = pending_approvals.room_id
        AND cp.user_id  = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id  = pending_approvals.room_id
        AND cp.user_id  = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  );
