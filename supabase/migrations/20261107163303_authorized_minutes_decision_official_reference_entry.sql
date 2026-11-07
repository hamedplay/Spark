-- Controlled numbering of official minutes and decisions by fully authorized administrators.

-- This migration cannot fabricate identifiers and does not update existing rows on installation.

CREATE OR REPLACE FUNCTION private.set_minutes_agenda_official_references_v1(p_decision_id uuid, p_minute_number text DEFAULT NULL::text, p_decision_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_minute_id uuid;
  v_previous_minute text;
  v_previous_decision text;
  v_minute text;
  v_decision text;
  v_actor uuid:=auth.uid();
begin
  if v_actor is null or not private.is_current_session_fully_authorized()
     or not private.is_current_user_admin() then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;
  if length(coalesce(p_minute_number,''))>80
     or length(coalesce(p_decision_number,''))>80
     or (nullif(btrim(coalesce(p_minute_number,'')),'') is null
         and nullif(btrim(coalesce(p_decision_number,'')),'') is null) then
    raise exception 'OFFICIAL_REFERENCE_REQUIRED_OR_TOO_LONG' using errcode='22023';
  end if;
  select m.id,m.official_number,d.official_number
    into v_minute_id,v_previous_minute,v_previous_decision
    from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
    where d.id=p_decision_id and m.status='published' and m.published_at is not null
    for update of d,m;
  if v_minute_id is null or not private._user_can_view_minute(v_minute_id) then
    raise exception 'SOURCE_NOT_AVAILABLE' using errcode='42501';
  end if;
  v_minute:=coalesce(nullif(btrim(p_minute_number),''),v_previous_minute);
  v_decision:=coalesce(nullif(btrim(p_decision_number),''),v_previous_decision);
  if v_minute is distinct from v_previous_minute then
    update public.minutes set official_number=v_minute where id=v_minute_id;
  end if;
  if v_decision is distinct from v_previous_decision then
    update public.minutes_decisions set official_number=v_decision where id=p_decision_id;
  end if;
  if v_minute is distinct from v_previous_minute or v_decision is distinct from v_previous_decision then
    perform public.write_audit_log('minutes','official_references.update','minutes_decisions',
      p_decision_id::text,
      jsonb_build_object('minute_id',v_minute_id,'old_minute_number',v_previous_minute,
        'new_minute_number',v_minute,'old_decision_number',v_previous_decision,
        'new_decision_number',v_decision)::text,
      'info',null,null,null);
  end if;
  return jsonb_build_object('minute_number',v_minute,'decision_number',v_decision);
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_minutes_agenda_official_references_v1(p_decision_id uuid, p_minute_number text DEFAULT NULL::text, p_decision_number text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$select private.set_minutes_agenda_official_references_v1(p_decision_id,p_minute_number,p_decision_number);$function$;

revoke all on function private.set_minutes_agenda_official_references_v1(uuid,text,text) from public,anon,authenticated,service_role;

revoke all on function public.set_minutes_agenda_official_references_v1(uuid,text,text) from public,anon,authenticated,service_role;

grant execute on function public.set_minutes_agenda_official_references_v1(uuid,text,text) to authenticated;

notify pgrst,'reload schema';

