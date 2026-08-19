-- Existing approval delegates could read their minutes_approvals row, but the
-- parent minutes row was filtered by RLS because this visibility helper only
-- recognized the original approver. Keep all existing access paths and add
-- the assigned delegate to the approval visibility branch.
CREATE OR REPLACE FUNCTION private._user_can_view_minute(p_minute_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
SELECT EXISTS (
  SELECT 1
  FROM public.minutes m
  WHERE m.id = p_minute_id
    AND (
      public.is_current_user_admin()
      OR m.created_by_user_id = auth.uid()
      OR m.secretary_user_id = auth.uid()
      OR m.chair_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.minutes_participants mp
        WHERE mp.minute_id = m.id AND mp.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.minutes_approvals ma
        WHERE ma.minute_id = m.id
          AND (
            ma.approver_user_id = auth.uid()
            OR ma.delegate_user_id = auth.uid()
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.minutes_decisions md
        WHERE md.minute_id = m.id AND md.primary_owner_user_id = auth.uid()
      )
      OR public._minutes_user_belongs_to_meeting(m.meeting_id, auth.uid())
      OR (
        m.confidentiality = 'restricted'
        AND public.can_view_restricted_minutes_meeting(m.meeting_id)
      )
    )
);
$function$;
