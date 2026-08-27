create or replace function private.conference_livekit_policy_for_user(
  p_room_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_role text;
  v_permissions text[];
  v_sources jsonb := '[]'::jsonb;
  v_allow_screen_share boolean := true;
  v_allow_reactions boolean := true;
  v_can_publish boolean := false;
  v_can_subscribe boolean := false;
  v_can_publish_data boolean := false;
begin
  if p_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select
    coalesce(r.allow_screen_share,true),
    coalesce(r.allow_reactions,true)
  into v_allow_screen_share,v_allow_reactions
  from public.conference_rooms r
  where r.id=p_room_id and r.status<>'ended';

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  v_role:=private.conference_effective_role(p_room_id,p_user_id);
  if v_role is null then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  select coalesce(array_agg(rp.permission order by rp.permission),array[]::text[])
  into v_permissions
  from private.conference_role_permissions rp
  where rp.role=v_role;

  if 'PUBLISH_CAMERA'=any(v_permissions) then
    v_sources:=v_sources||jsonb_build_array('camera');
  end if;

  if 'PUBLISH_MIC'=any(v_permissions) then
    v_sources:=v_sources||jsonb_build_array('microphone');
  end if;

  if v_allow_screen_share and 'PUBLISH_SCREEN'=any(v_permissions) then
    v_sources:=v_sources||jsonb_build_array('screen_share','screen_share_audio');
  end if;

  v_can_publish:=jsonb_array_length(v_sources)>0;
  v_can_subscribe:='SUBSCRIBE_MEDIA'=any(v_permissions);
  v_can_publish_data:=v_allow_reactions and 'JOIN_ROOM'=any(v_permissions);

  return jsonb_build_object(
    'ok',true,
    'role',v_role,
    'permissions',to_jsonb(v_permissions),
    'can_publish',v_can_publish,
    'can_subscribe',v_can_subscribe,
    'can_publish_data',v_can_publish_data,
    'publish_sources',v_sources
  );
end;
$$;

create or replace function private.conference_livekit_policy(p_room_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select case
    when auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
      then jsonb_build_object('ok',false,'reason','not_authenticated')
    else private.conference_livekit_policy_for_user(p_room_id,auth.uid())
  end
$$;

create or replace function public.get_my_livekit_conference_policy(p_room_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path=''
as $$
  select private.conference_livekit_policy(p_room_id)
$$;

revoke execute on function private.conference_livekit_policy_for_user(uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.conference_livekit_policy_for_user(uuid,uuid)
  to service_role;

revoke execute on function private.conference_livekit_policy(uuid)
  from public,anon;
grant execute on function private.conference_livekit_policy(uuid)
  to authenticated,service_role;

revoke execute on function public.get_my_livekit_conference_policy(uuid)
  from public,anon;
grant execute on function public.get_my_livekit_conference_policy(uuid)
  to authenticated,service_role;

create or replace function private.set_conference_participant_role(
  p_room_id uuid,
  p_target_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=auth.uid();
  v_new_role text;
  v_actor_role text;
  v_target_role text;
  v_actor_rank integer;
  v_target_rank integer;
  v_new_rank integer;
  v_host uuid;
  v_legacy_role text;
begin
  if v_actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.has_conference_permission(p_room_id,'MANAGE_ROLES',v_actor) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  v_new_role:=private.normalize_conference_rbac_role(p_role);
  if v_new_role is null or v_new_role='OWNER' then
    return jsonb_build_object('ok',false,'reason','invalid_role');
  end if;

  select r.host_id into v_host
  from public.conference_rooms r
  where r.id=p_room_id and r.status<>'ended';

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;
  if p_target_user_id=v_host then
    return jsonb_build_object('ok',false,'reason','cannot_change_owner_role');
  end if;
  if p_target_user_id=v_actor then
    return jsonb_build_object('ok',false,'reason','cannot_target_self');
  end if;

  if not exists(
    select 1
    from public.conference_participants p
    where p.room_id=p_room_id
      and p.user_id=p_target_user_id
      and p.status='joined'
  ) then
    return jsonb_build_object('ok',false,'reason','participant_not_found');
  end if;

  v_actor_role:=private.conference_effective_role(p_room_id,v_actor);
  v_target_role:=private.conference_effective_role(p_room_id,p_target_user_id);
  v_actor_rank:=private.conference_role_rank(v_actor_role);
  v_target_rank:=private.conference_role_rank(v_target_role);
  v_new_rank:=private.conference_role_rank(v_new_role);

  if v_actor_role<>'OWNER' and (
    v_actor_rank is null
    or v_new_rank is null
    or v_actor_rank<=v_new_rank
    or (v_target_rank is not null and v_actor_rank<=v_target_rank)
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden_role_escalation');
  end if;

  insert into private.conference_role_assignments(
    room_id,user_id,role,assigned_by,updated_at
  )
  values(p_room_id,p_target_user_id,v_new_role,v_actor,now())
  on conflict(room_id,user_id) do update
  set role=excluded.role,assigned_by=excluded.assigned_by,updated_at=now();

  v_legacy_role:=case v_new_role
    when 'HOST' then 'admin'
    when 'CO_HOST' then 'admin'
    when 'MODERATOR' then 'moderator'
    else 'member'
  end;

  update public.conference_participants
  set role=v_legacy_role,updated_at=now()
  where room_id=p_room_id and user_id=p_target_user_id;

  insert into public.conference_audit_events(
    room_id,actor_user_id,target_user_id,event_type,metadata
  )
  values(
    p_room_id,v_actor,p_target_user_id,'participant_permission_changed',
    jsonb_build_object('role',v_new_role)
  );

  return jsonb_build_object(
    'ok',true,
    'role',v_new_role,
    'permissions',(
      select coalesce(jsonb_agg(rp.permission order by rp.permission),'[]'::jsonb)
      from private.conference_role_permissions rp
      where rp.role=v_new_role
    ),
    'livekit_policy',
      private.conference_livekit_policy_for_user(p_room_id,p_target_user_id)
  );
end;
$$;

revoke execute on function private.set_conference_participant_role(uuid,uuid,text)
  from public,anon;
grant execute on function private.set_conference_participant_role(uuid,uuid,text)
  to authenticated,service_role;

notify pgrst,'reload schema';
