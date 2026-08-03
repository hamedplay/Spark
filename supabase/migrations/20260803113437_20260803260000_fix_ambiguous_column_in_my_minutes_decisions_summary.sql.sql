/*
# Fix ambiguous column references in summary RPCs
# minutes_decisions.status and minutes.status both exist, causing 42702 ambiguity.
# Qualify all column references with table alias d.
*/

CREATE OR REPLACE FUNCTION public.get_my_minutes_decisions_summary()
RETURNS TABLE(
  total_count integer, active_count integer, completed_count integer,
  stopped_count integer, overdue_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_today text := to_char(now() AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(*)::integer AS total_count,
    COUNT(*) FILTER (WHERE d.status IN ('not_started','planned','in_progress','waiting_coordination','waiting_approval'))::integer AS active_count,
    COUNT(*) FILTER (WHERE d.status = 'completed')::integer AS completed_count,
    COUNT(*) FILTER (WHERE d.status = 'stopped')::integer AS stopped_count,
    COUNT(*) FILTER (WHERE d.due_date IS NOT NULL AND d.due_date < v_today::date
      AND d.status NOT IN ('completed','stopped'))::integer AS overdue_count
  FROM public.minutes_decisions d
  JOIN public.minutes m ON m.id = d.minute_id
  WHERE d.primary_owner_user_id = v_user_id
    AND m.status = 'published'
    AND m.published_at IS NOT NULL;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_my_minutes_decisions_summary TO authenticated;
