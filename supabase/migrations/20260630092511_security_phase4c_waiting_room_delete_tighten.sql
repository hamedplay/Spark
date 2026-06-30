-- ═══════════════════════════════════════════════════════════════════
-- Security Phase 4c: conference_waiting_room — tighten DELETE policies
-- ---------------------------------------------------------------
-- Before: a single policy "allow_delete_own_waiting" applied to BOTH
-- anon AND authenticated with USING = true, allowing any user to
-- delete any waiting-room entry (DoS on other guests).
--
-- After:
--   authenticated — own entry (user_id = auth.uid()) OR host/admin of room
--   anon          — only entries in non-ended rooms
--                   (auth.uid() is NULL for anon so identity check is
--                    impossible; restricting to active rooms at least
--                    prevents clearing historical entries and reduces
--                    the exploitable surface. The residual risk — an
--                    attacker who knows another guest's UUID — is
--                    accepted because UUIDs are never exposed publicly.)
--
-- The existing INSERT policy (users_can_request_entry) already uses
--   cr.status <> 'ended' — this change is consistent with that pattern.
--
-- ROLLBACK:
--   DROP POLICY delete_waiting_authenticated ON public.conference_waiting_room;
--   DROP POLICY delete_waiting_anon          ON public.conference_waiting_room;
--   CREATE POLICY allow_delete_own_waiting ON public.conference_waiting_room
--     FOR DELETE TO anon, authenticated USING (true);
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS allow_delete_own_waiting ON public.conference_waiting_room;

-- Authenticated: own record or host/admin of the room
CREATE POLICY delete_waiting_authenticated ON public.conference_waiting_room
  FOR DELETE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id = conference_waiting_room.room_id
        AND cp.user_id = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  );

-- Anon: only entries belonging to rooms that have not ended
CREATE POLICY delete_waiting_anon ON public.conference_waiting_room
  FOR DELETE TO anon
  USING (
    EXISTS (
      SELECT 1 FROM public.conference_rooms cr
      WHERE cr.id = conference_waiting_room.room_id
        AND cr.status <> 'ended'
    )
  );
