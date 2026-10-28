-- A participant's decline must not change the meeting lifecycle.
CREATE OR REPLACE FUNCTION private.decline_meeting_invitation_v2(p_meeting_inbox_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_inbox public.meeting_inbox%rowtype;
  v_owner uuid;
  v_delegator uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  select *
  into v_inbox
  from public.meeting_inbox mi
  where mi.id = p_meeting_inbox_id
    and mi.user_id = v_uid
  for update;

  if not found then
    raise exception 'NOT_AUTHORIZED' using errcode='42501';
  end if;

  if v_inbox.status is distinct from 'pending' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_STATUS');
  end if;

  select m.user_id
  into v_owner
  from public.meetings m
  where m.id = v_inbox.meeting_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'MEETING_NOT_FOUND');
  end if;

  v_delegator := v_inbox.delegated_by_user_id;

  update public.meeting_inbox
  set status = 'declined',
      updated_at = now()
  where id = v_inbox.id;

  if v_delegator is not null then
    -- A declined delegation must not change the meeting itself.
    update public.meeting_inbox
    set delegate_to = null,
        delegated_by_user_id = null,
        delegated_at = null,
        updated_at = now()
    where meeting_id = v_inbox.meeting_id
      and user_id = v_delegator;

  -- Declining attendance belongs to this inbox row. It must not reject the
  -- organizer's meeting or hide it from other participants' calendars.
  end if;

  return jsonb_build_object(
    'success', true,
    'meeting_id', v_inbox.meeting_id,
    'delegate_request', v_delegator is not null,
    'delegator_user_id', v_delegator,
    'organizer_user_id', v_owner
  );
end;
$function$;

NOTIFY pgrst,'reload schema';
