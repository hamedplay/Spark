create or replace function private.apply_conference_participant_role(
  p_room_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_new_role text;
  v_actor_role text;
  v_target_role text;
  v_actor_rank integer;
  v_target_rank integer;
  v_new_rank integer;
  v_host uuid;
  v_legacy_role text;
begin
  if p_actor_user_id is null then
    return jsonb_build_object('ok',false,'reason','actor_required');
  end if;

  if not private.has_conference_permission(
    p_room_id,'MANAGE_ROLES',p_actor_user_id
  ) then
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
  if p_target_user_id=p_actor_user_id then
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

  v_actor_role:=private.conference_effective_role(
    p_room_id,p_actor_user_id
  );
  v_target_role:=private.conference_effective_role(
    p_room_id,p_target_user_id
  );
  v_actor_rank:=private.conference_role_rank(v_actor_role);
  v_target_rank:=private.conference_role_rank(v_target_role);
  v_new_rank:=private.conference_role_rank(v_new_role);

  if v_actor_role<>'OWNER' and (
    v_actor_rank is null
    or v_new_rank is null
    or v_actor_rank<=v_new_rank
    or (
      v_target_rank is not null
      and v_actor_rank<=v_target_rank
    )
  ) then
    return jsonb_build_object(
      'ok',false,'reason','forbidden_role_escalation'
    );
  end if;

  insert into private.conference_role_assignments(
    room_id,user_id,role,assigned_by,updated_at
  )
  values(
    p_room_id,p_target_user_id,v_new_role,p_actor_user_id,now()
  )
  on conflict(room_id,user_id) do update
  set
    role=excluded.role,
    assigned_by=excluded.assigned_by,
    updated_at=now();

  v_legacy_role:=case v_new_role
    when 'HOST' then 'admin'
    when 'CO_HOST' then 'admin'
    when 'MODERATOR' then 'moderator'
    else 'member'
  end;

  update public.conference_participants
  set role=v_legacy_role,updated_at=now()
  where room_id=p_room_id
    and user_id=p_target_user_id;

  insert into public.conference_audit_events(
    room_id,
    actor_user_id,
    target_user_id,
    event_type,
    metadata
  )
  values(
    p_room_id,
    p_actor_user_id,
    p_target_user_id,
    'participant_permission_changed',
    jsonb_build_object('role',v_new_role)
  );

  return jsonb_build_object(
    'ok',true,
    'role',v_new_role,
    'permissions',(
      select coalesce(
        jsonb_agg(rp.permission order by rp.permission),
        '[]'::jsonb
      )
      from private.conference_role_permissions rp
      where rp.role=v_new_role
    ),
    'livekit_policy',
      private.conference_livekit_policy_for_user(
        p_room_id,p_target_user_id
      )
  );
end;
$$;

create or replace function public.apply_livekit_conference_participant_role(
  p_room_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_actor_user_id uuid
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.apply_conference_participant_role(
    p_room_id,
    p_target_user_id,
    p_role,
    p_actor_user_id
  )
$$;

revoke execute on function
  private.apply_conference_participant_role(uuid,uuid,text,uuid)
from public,anon,authenticated;
grant execute on function
  private.apply_conference_participant_role(uuid,uuid,text,uuid)
to service_role;

revoke execute on function
  public.apply_livekit_conference_participant_role(uuid,uuid,text,uuid)
from public,anon,authenticated;
grant execute on function
  public.apply_livekit_conference_participant_role(uuid,uuid,text,uuid)
to service_role;

create or replace function private.authorize_livekit_host_action(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_room public.conference_rooms%rowtype;
  v_permission text;
  v_role text;
begin
  if auth.uid() is null
     or coalesce(
       (auth.jwt()->>'is_anonymous')::boolean,false
     ) then
    return jsonb_build_object(
      'ok',false,'reason','not_authenticated'
    );
  end if;

  select * into v_room
  from public.conference_rooms
  where id=p_room_id;

  if not found
     or v_room.media_topology<>'sfu'
     or v_room.livekit_room_name is null then
    return jsonb_build_object(
      'ok',false,'reason','room_not_found'
    );
  end if;

  v_permission:=case p_action
    when 'remove' then 'REMOVE_PARTICIPANT'
    when 'mute' then 'MUTE_OTHERS'
    when 'lower-hand' then 'MUTE_OTHERS'
    when 'promote' then 'MANAGE_ROLES'
    when 'demote' then 'MANAGE_ROLES'
    when 'set-role' then 'MANAGE_ROLES'
    when 'lock' then 'LOCK_ROOM'
    when 'unlock' then 'LOCK_ROOM'
    when 'end' then 'END_MEETING'
    else null
  end;

  if v_permission is null
     or not private.has_conference_permission(
       p_room_id,v_permission,auth.uid()
     ) then
    return jsonb_build_object(
      'ok',false,'reason','forbidden'
    );
  end if;

  if p_target_user_id is not null
     and p_target_user_id=auth.uid() then
    return jsonb_build_object(
      'ok',false,'reason','cannot_target_self'
    );
  end if;

  v_role:=private.conference_effective_role(
    p_room_id,auth.uid()
  );

  return jsonb_build_object(
    'ok',true,
    'role',v_role,
    'permission',v_permission,
    'livekit_room_name',v_room.livekit_room_name,
    'room_id',v_room.id
  );
end;
$$;

revoke execute on function
  private.authorize_livekit_host_action(uuid,uuid,text)
from public,anon;
grant execute on function
  private.authorize_livekit_host_action(uuid,uuid,text)
to authenticated,service_role;

notify pgrst,'reload schema';
