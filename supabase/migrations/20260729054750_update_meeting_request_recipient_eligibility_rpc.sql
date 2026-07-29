/*
# Update meeting request recipient eligibility RPC

1. Changes
- Updates `is_meeting_request_recipient_eligible` function to match the new allowlist.
- Removes `مدیر امور%` from eligible position titles.
- Adds `رییس دفتر%` and `رئیس دفتر%` to eligible position titles.
- Eligible titles: رییس دایره, رئیس دایره, رییس دفتر, رئیس دفتر, متصدی اداری.
2. Security
- No RLS changes.
- Function remains SECURITY DEFINER.
3. Important notes
- Managers (مدیر, مدیرعامل, معاون, مشاور, رییس اداره, رئیس اداره) are NOT eligible.
- The function checks all active org_position_members assignments, not just primary position.
- Inactive and hidden users remain ineligible.
*/

CREATE OR REPLACE FUNCTION public.is_meeting_request_recipient_eligible(p_recipient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
v_caller_org text;
v_recipient_org text;
v_is_active boolean;
v_is_hidden boolean;
v_has_eligible_position boolean;
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'unauthorized';
END IF;

SELECT p.organization INTO v_caller_org
FROM public.profiles p
WHERE p.user_id = auth.uid()
LIMIT 1;

IF v_caller_org IS NULL OR btrim(v_caller_org) = '' THEN
RETURN false;
END IF;

SELECT p.organization, p.is_active, COALESCE(p.is_hidden, false)
INTO v_recipient_org, v_is_active, v_is_hidden
FROM public.profiles p
WHERE p.user_id = p_recipient_id
LIMIT 1;

IF v_recipient_org IS NULL OR v_recipient_org <> v_caller_org THEN
RETURN false;
END IF;

IF v_is_active = false OR v_is_hidden = true THEN
RETURN false;
END IF;

SELECT EXISTS (
SELECT 1
FROM public.org_position_members m
JOIN public.org_positions pos ON pos.id = m.position_id
WHERE m.user_id = p_recipient_id
AND (
pos.title ILIKE 'رییس دایره%'
OR pos.title ILIKE 'رئیس دایره%'
OR pos.title ILIKE 'رییس دفتر%'
OR pos.title ILIKE 'رئیس دفتر%'
OR pos.title ILIKE 'متصدی اداری%'
)
) INTO v_has_eligible_position;

RETURN v_has_eligible_position;
END;
$function$;
