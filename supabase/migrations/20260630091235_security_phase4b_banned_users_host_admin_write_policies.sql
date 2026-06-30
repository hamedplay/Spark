-- ═══════════════════════════════════════════════════════════════════
-- Security Phase 4b: banned_users — restrict write policies to host/admin
-- ---------------------------------------------------------------
-- Problem: INSERT/UPDATE/DELETE policies had WITH CHECK/USING = true,
-- allowing any authenticated user to ban, unban, or modify ban records
-- for any room they are not a host/admin in.
--
-- Fix: replace the three open write policies with host/admin checks
-- via conference_participants. SELECT policies are unchanged (anon
-- needs to read bans to check their own status in GuestJoinPage.tsx).
--
-- Roles with write access: 'host' and 'admin' in conference_participants
-- for the same room_id. 'admin' is assignable via role_change signal
-- (ConferenceRoom.tsx:822) even if not yet present in production data.
-- status check deliberately omitted — host may disconnect before upsert
-- completes, and validate_room_join cleanup uses service_role (RLS bypass).
--
-- ROLLBACK:
--   DROP POLICY insert_bans_host ON public.banned_users;
--   DROP POLICY update_bans_host  ON public.banned_users;
--   DROP POLICY delete_bans_host  ON public.banned_users;
--   CREATE POLICY insert_bans_auth ON public.banned_users FOR INSERT TO authenticated WITH CHECK (true);
--   CREATE POLICY update_bans_auth ON public.banned_users FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
--   CREATE POLICY delete_bans_auth ON public.banned_users FOR DELETE TO authenticated USING (true);
-- ═══════════════════════════════════════════════════════════════════

-- Remove the three open write policies
DROP POLICY IF EXISTS insert_bans_auth ON public.banned_users;
DROP POLICY IF EXISTS update_bans_auth ON public.banned_users;
DROP POLICY IF EXISTS delete_bans_auth ON public.banned_users;

-- INSERT: only host or admin of the room
CREATE POLICY insert_bans_host ON public.banned_users
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id = banned_users.room_id
        AND cp.user_id = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  );

-- UPDATE: only host or admin of the room
CREATE POLICY update_bans_host ON public.banned_users
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id = banned_users.room_id
        AND cp.user_id = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id = banned_users.room_id
        AND cp.user_id = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  );

-- DELETE: only host or admin of the room
CREATE POLICY delete_bans_host ON public.banned_users
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.conference_participants cp
      WHERE cp.room_id = banned_users.room_id
        AND cp.user_id = auth.uid()
        AND cp.role IN ('host', 'admin')
    )
  );
