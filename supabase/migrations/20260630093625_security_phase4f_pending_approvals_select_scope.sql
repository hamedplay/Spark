-- ═══════════════════════════════════════════════════════════════════
-- Security Phase 4f: pending_approvals SELECT — scope to minimum needed
-- ---------------------------------------------------------------
-- Before:
--   select_pending_approvals_anon  (anon):          USING true
--   select_pending_approvals_auth  (authenticated): USING true
--   Both policies allowed any reader to see ALL rows across ALL rooms,
--   exposing user_id, display_name, approved_by, status of every
--   approval request in the system.
--
-- After:
--   anon role: no SELECT policy → cannot read pending_approvals at all.
--     Justified: GuestJoinPage.tsx has zero references to this table;
--     the waiting-room path uses conference_waiting_room instead.
--
--   authenticated role: only the requester (user_id = auth.uid()) or
--     a host/admin in the same room may read approval records.
--     This preserves both frontend paths:
--       - ApprovalGate.tsx:52 — requester polls own row by room_id+user_id
--       - ApprovalGate.tsx:113 — requester polls own row by id
--       - ConferenceRoom.tsx:291 — host/admin loads queue by room_id
--       - Realtime subscription on id=eq.${approvalId} (requester owns row)
--
-- ROLLBACK (Down):
--   DROP POLICY IF EXISTS select_pending_approvals_scoped ON public.pending_approvals;
--   CREATE POLICY select_pending_approvals_anon ON public.pending_approvals
--     FOR SELECT TO anon USING (true);
--   CREATE POLICY select_pending_approvals_auth ON public.pending_approvals
--     FOR SELECT TO authenticated USING (true);
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS select_pending_approvals_anon ON public.pending_approvals;
DROP POLICY IF EXISTS select_pending_approvals_auth ON public.pending_approvals;

CREATE POLICY select_pending_approvals_scoped ON public.pending_approvals
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id = pending_approvals.room_id
        AND cp.user_id = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  );
