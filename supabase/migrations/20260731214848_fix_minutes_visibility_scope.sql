/*
# Fix minutes visibility scope (organizational/public leak)

## Problem
The visibility helper functions `public._user_can_view_minute(uuid)` and
`public._can_view_minute(uuid)` granted access to every authenticated user for
any minute whose `confidentiality` was `organizational` or `public`, as long as
the parent meeting row existed. The condition never tied the minute to the
calling user, so unrelated users could see (and the dashboard counted) minutes
they had no relationship to.

The same buggy condition was also inlined in the `minutes_select` RLS policy,
so fixing the functions alone was not enough.

## Changes
1. `public._user_can_view_minute(uuid)` is now the single canonical visibility
   function. A user may view a minute when ANY of these hold:
   - the caller is an admin (`is_current_user_admin()`)
   - the user is the minute's creator, secretary, or chair
   - the user is a row in `minutes_participants` for this minute
   - the user is an approver in `minutes_approvals` for this minute
   - the user is the `primary_owner_user_id` of any decision on this minute
   - the user belongs to the parent meeting (`_minutes_user_belongs_to_meeting`)
   - the minute is `restricted` AND `can_view_restricted_minutes_meeting` allows it
   `public` and `organizational` no longer mean "every authenticated user".
   `auth.uid()` being null fails closed.
2. `public._can_view_minute(uuid)` is now a thin wrapper that delegates to
   `public._user_can_view_minute(uuid)`, so there is one source of truth.
3. The `minutes_select` RLS policy is replaced to call
   `public._user_can_view_minute(id)` instead of inlining the old buggy
   condition. The other minutes policies (insert/update/delete) are unchanged.

## Security
- No data is changed or deleted.
- No confidentiality value of any minute is changed.
- No other RLS policies are touched.
- `SECURITY DEFINER` and `search_path = ''` are preserved on both functions.
- No dynamic SQL. Only UUIDs are used for authorization (never email/name).

## Important notes
1. `public` and `organizational` now require a real relationship to the minute
   or its parent meeting; they no longer mean "all authenticated users".
2. The `minutes_participants_select` RLS policy (which has no auth check at all)
   is a separate pre-existing leak and is NOT changed by this migration.
*/

-- 1) Canonical visibility function
CREATE OR REPLACE FUNCTION public._user_can_view_minute(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1
  FROM public.minutes m
  WHERE m.id = p_minute_id
    AND (
      public.is_current_user_admin()

      OR m.created_by_user_id = auth.uid()
      OR m.secretary_user_id   = auth.uid()
      OR m.chair_user_id       = auth.uid()

      OR EXISTS (
        SELECT 1
        FROM public.minutes_participants mp
        WHERE mp.minute_id = m.id
          AND mp.user_id = auth.uid()
      )

      OR EXISTS (
        SELECT 1
        FROM public.minutes_approvals ma
        WHERE ma.minute_id = m.id
          AND ma.approver_user_id = auth.uid()
      )

      OR EXISTS (
        SELECT 1
        FROM public.minutes_decisions md
        WHERE md.minute_id = m.id
          AND md.primary_owner_user_id = auth.uid()
      )

      OR public._minutes_user_belongs_to_meeting(m.meeting_id, auth.uid())

      OR (
        m.confidentiality = 'restricted'
        AND public.can_view_restricted_minutes_meeting(m.meeting_id)
      )
    )
);
$function$;

-- 2) Wrapper delegates to the canonical function
CREATE OR REPLACE FUNCTION public._can_view_minute(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT public._user_can_view_minute(p_minute_id);
$function$;

-- 3) Replace the buggy minutes_select policy to use the canonical function
DROP POLICY IF EXISTS "minutes_select" ON public.minutes;

CREATE POLICY "minutes_select"
ON public.minutes FOR SELECT
TO authenticated
USING (public._user_can_view_minute(id));
