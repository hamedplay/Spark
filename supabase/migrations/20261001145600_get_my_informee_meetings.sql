-- RLS intentionally does not broaden direct meetings SELECT access for informees.
-- Expose only the minimum meeting fields needed by the add-participant UI.

CREATE OR REPLACE FUNCTION public.get_my_informee_meetings_v1()
RETURNS TABLE (
  id uuid,
  subject text,
  request_date text,
  start_time text,
  end_time text,
  user_id uuid,
  participant_user_ids uuid[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT
    m.id,
    m.subject,
    m.request_date,
    m.start_time,
    m.end_time,
    m.user_id,
    COALESCE(m.participant_user_ids, ARRAY[]::uuid[])
  FROM public.meetings AS m
  WHERE auth.uid() IS NOT NULL
    AND auth.uid() = ANY(COALESCE(m.notify_users, ARRAY[]::uuid[]))
    AND m.status <> 'closed'
  ORDER BY m.request_date DESC
  LIMIT 100;
$function$;

REVOKE ALL ON FUNCTION public.get_my_informee_meetings_v1() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_informee_meetings_v1() TO authenticated;
