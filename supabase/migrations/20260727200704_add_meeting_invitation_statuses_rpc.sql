/*
# Add get_meeting_invitation_statuses RPC

## Purpose
The minutes-creator (meeting organizer/manager) needs to read the invitation
status of ALL participants of a meeting to prefill the minutes form. The
`meeting_inbox` table's RLS only allows users to read their OWN inbox rows
(`auth.uid() = user_id`), so a direct client query returns only the creator's
row — every other participant incorrectly shows "no_response".

This RPC returns invitation statuses for all participants of a single
meeting, gated by the same authorization logic as
`can_create_minutes_for_meeting` (admin, creator, or meeting_manager).

## Security
- SECURITY DEFINER + SET search_path = '' (safe schema search path).
- Authorization reuses `can_create_minutes_for_meeting` — if the caller cannot
  create minutes for this meeting, the RPC returns no rows.
- Only returns rows for the single requested meeting_id.
- Does NOT broaden RLS on meeting_inbox. The base table policies are unchanged.
- Execution restricted to authenticated users via the function's auth check.

## Returns
A set of rows: (user_id uuid, status text, delegate_to uuid | null).
Only rows that exist in meeting_inbox for the given meeting are returned.
Participants without an inbox record are NOT fabricated here — the frontend
handles the "no inbox record" case explicitly.
*/

CREATE OR REPLACE FUNCTION public.get_meeting_invitation_statuses(p_meeting_id uuid)
RETURNS TABLE (
  user_id uuid,
  status text,
  delegate_to uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT mi.user_id, mi.status::text, mi.delegate_to
    FROM public.meeting_inbox mi
   WHERE mi.meeting_id = p_meeting_id
     AND public.can_create_minutes_for_meeting(p_meeting_id);
$function$;

REVOKE ALL ON FUNCTION public.get_meeting_invitation_statuses(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_meeting_invitation_statuses(uuid) TO authenticated;
