-- Literal substring search across resolution text and its clauses.
-- Normalize Persian/Arabic letter variants, whitespace and half-spaces.
CREATE OR REPLACE FUNCTION private.decision_report_search_text(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $fn$
 SELECT lower(btrim(regexp_replace(
   translate(replace(coalesce(p_text,''),chr(8204),' '),'يك','یک'),
   '[[:space:]]+',' ','g')));
$fn$;
REVOKE ALL ON FUNCTION private.decision_report_search_text(text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION private.search_decisions_report(p_filters jsonb, p_limit integer, p_offset integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(coalesce(p_limit, 50), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb;
  v_total integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;

  with filtered as (
    select d.*,m.meeting_title_snapshot,
      coalesce((select min(c.due_date) from public.minutes_decisions c where c.parent_decision_id=d.id and c.status not in ('completed','stopped')),d.due_date) as effective_due_date
    from public.minutes_decisions d
    join public.minutes m on m.id=d.minute_id
    where d.parent_decision_id is null
      and public._user_can_view_minute(d.minute_id)
      and (
        private.decision_report_search_text(p_filters->>'query')=''
        or strpos(private.decision_report_search_text(concat_ws(' ', d.title,d.description,d.discussion_result,d.additional_notes,d.latest_update)),
                  private.decision_report_search_text(p_filters->>'query'))>0
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id
          and strpos(private.decision_report_search_text(concat_ws(' ',c.title,c.description,c.discussion_result,c.additional_notes,c.latest_update)),
                     private.decision_report_search_text(p_filters->>'query'))>0)
      )
      and (p_filters->>'status' is null or d.status=p_filters->>'status')
      and (p_filters->>'priority' is null or d.priority=p_filters->>'priority' or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.priority=p_filters->>'priority'))
      and (p_filters->>'owner_user_id' is null or d.primary_owner_user_id=(p_filters->>'owner_user_id')::uuid or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.primary_owner_user_id=(p_filters->>'owner_user_id')::uuid))
      and (p_filters->>'unit_id' is null or d.responsible_unit_id=(p_filters->>'unit_id')::uuid or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.responsible_unit_id=(p_filters->>'unit_id')::uuid))
      and (p_filters->>'minute_id' is null or d.minute_id=(p_filters->>'minute_id')::uuid)
      and (p_filters->>'org_unit_id' is null or m.org_unit_id=(p_filters->>'org_unit_id')::uuid)
      and (p_filters->>'requires_followup' is null or d.requires_followup=(p_filters->>'requires_followup')::boolean or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.requires_followup=(p_filters->>'requires_followup')::boolean))
      and (p_filters->>'due_from' is null or d.due_date is null or d.due_date>=(p_filters->>'due_from')::date or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date>=(p_filters->>'due_from')::date))
      and (p_filters->>'due_to' is null or d.due_date is null or d.due_date<=(p_filters->>'due_to')::date or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date<=(p_filters->>'due_to')::date))
      and (p_filters->>'overdue' is null or ((p_filters->>'overdue')::boolean and ((not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id) and d.due_date<current_date and d.status not in ('completed','stopped')) or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date<current_date and c.status not in ('completed','stopped')))))
  ), page as (
    select * from filtered order by created_at desc limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',id,'title',title,'minute_id',minute_id,'minute_title',meeting_title_snapshot,
      'owner_user_id',primary_owner_user_id,'unit',responsible_unit_name_snapshot,'priority',priority,
      'status',status,'progress',progress_percent,'due_date',effective_due_date,
      'overdue',(effective_due_date is not null and effective_due_date<current_date and status not in ('completed','stopped')),
      'latest_update',latest_update
    ) order by created_at desc),'[]'::jsonb),
    (select count(*)::integer from filtered)
  into v_rows,v_total
  from page;

  return jsonb_build_object('rows',v_rows,'total_count',coalesce(v_total,0));
end;
$function$
;
NOTIFY pgrst,'reload schema';
