create table if not exists private.conference_rbac_roles (
  role text primary key,
  role_rank smallint not null unique,
  constraint conference_rbac_roles_role_check check (role = any(array['OWNER','HOST','CO_HOST','MODERATOR','PRESENTER','PARTICIPANT','VIEWER']))
);
create table if not exists private.conference_permissions (permission text primary key);
create table if not exists private.conference_role_permissions (
  role text not null references private.conference_rbac_roles(role) on delete cascade,
  permission text not null references private.conference_permissions(permission) on delete cascade,
  primary key (role, permission)
);
create table if not exists private.conference_role_assignments (
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  user_id uuid not null,
  role text not null references private.conference_rbac_roles(role),
  assigned_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (room_id, user_id),
  constraint conference_role_assignments_no_owner check (role <> 'OWNER')
);
alter table private.conference_rbac_roles enable row level security;
alter table private.conference_permissions enable row level security;
alter table private.conference_role_permissions enable row level security;
alter table private.conference_role_assignments enable row level security;
revoke all on table private.conference_rbac_roles from public, anon, authenticated;
revoke all on table private.conference_permissions from public, anon, authenticated;
revoke all on table private.conference_role_permissions from public, anon, authenticated;
revoke all on table private.conference_role_assignments from public, anon, authenticated;

insert into private.conference_rbac_roles(role, role_rank) values ('OWNER',100),('HOST',90),('CO_HOST',80),('MODERATOR',70),('PRESENTER',50),('PARTICIPANT',40),('VIEWER',30)
on conflict (role) do update set role_rank=excluded.role_rank;
insert into private.conference_permissions(permission) values ('BAN_PARTICIPANT'),('CREATE_POLL'),('DELETE_CHAT'),('DISABLE_CAMERA'),('DISABLE_MIC'),('END_MEETING'),('JOIN_ROOM'),('LOCK_ROOM'),('MANAGE_BREAKOUTS'),('MANAGE_CHAT'),('MANAGE_POLLS'),('MANAGE_ROLES'),('MANAGE_TIMER'),('MANAGE_WAITING_ROOM'),('MANAGE_WHITEBOARD'),('MUTE_OTHERS'),('PIN_PARTICIPANT'),('PUBLISH_CAMERA'),('PUBLISH_MIC'),('PUBLISH_SCREEN'),('REMOVE_PARTICIPANT'),('SEND_CHAT'),('SEND_PRIVATE_CHAT'),('SHARE_FILE'),('START_BREAK'),('START_RECORDING'),('STOP_RECORDING'),('SUBSCRIBE_MEDIA'),('TRANSFER_OWNERSHIP'),('USE_WHITEBOARD'),('VOTE_POLL')
on conflict (permission) do nothing;
insert into private.conference_role_permissions(role, permission) values ('OWNER','JOIN_ROOM'),('OWNER','PUBLISH_MIC'),('OWNER','PUBLISH_CAMERA'),('OWNER','PUBLISH_SCREEN'),('OWNER','SUBSCRIBE_MEDIA'),('OWNER','SEND_CHAT'),('OWNER','SEND_PRIVATE_CHAT'),('OWNER','DELETE_CHAT'),('OWNER','MANAGE_CHAT'),('OWNER','CREATE_POLL'),('OWNER','MANAGE_POLLS'),('OWNER','VOTE_POLL'),('OWNER','USE_WHITEBOARD'),('OWNER','MANAGE_WHITEBOARD'),('OWNER','SHARE_FILE'),('OWNER','START_RECORDING'),('OWNER','STOP_RECORDING'),('OWNER','MUTE_OTHERS'),('OWNER','DISABLE_MIC'),('OWNER','DISABLE_CAMERA'),('OWNER','REMOVE_PARTICIPANT'),('OWNER','BAN_PARTICIPANT'),('OWNER','LOCK_ROOM'),('OWNER','MANAGE_ROLES'),('OWNER','MANAGE_WAITING_ROOM'),('OWNER','MANAGE_TIMER'),('OWNER','START_BREAK'),('OWNER','END_MEETING'),('OWNER','PIN_PARTICIPANT'),('OWNER','MANAGE_BREAKOUTS'),('OWNER','TRANSFER_OWNERSHIP'),('HOST','JOIN_ROOM'),('HOST','PUBLISH_MIC'),('HOST','PUBLISH_CAMERA'),('HOST','PUBLISH_SCREEN'),('HOST','SUBSCRIBE_MEDIA'),('HOST','SEND_CHAT'),('HOST','SEND_PRIVATE_CHAT'),('HOST','DELETE_CHAT'),('HOST','MANAGE_CHAT'),('HOST','CREATE_POLL'),('HOST','MANAGE_POLLS'),('HOST','VOTE_POLL'),('HOST','USE_WHITEBOARD'),('HOST','MANAGE_WHITEBOARD'),('HOST','SHARE_FILE'),('HOST','START_RECORDING'),('HOST','STOP_RECORDING'),('HOST','MUTE_OTHERS'),('HOST','DISABLE_MIC'),('HOST','DISABLE_CAMERA'),('HOST','REMOVE_PARTICIPANT'),('HOST','BAN_PARTICIPANT'),('HOST','LOCK_ROOM'),('HOST','MANAGE_ROLES'),('HOST','MANAGE_WAITING_ROOM'),('HOST','MANAGE_TIMER'),('HOST','START_BREAK'),('HOST','END_MEETING'),('HOST','PIN_PARTICIPANT'),('HOST','MANAGE_BREAKOUTS'),('CO_HOST','JOIN_ROOM'),('CO_HOST','PUBLISH_MIC'),('CO_HOST','PUBLISH_CAMERA'),('CO_HOST','PUBLISH_SCREEN'),('CO_HOST','SUBSCRIBE_MEDIA'),('CO_HOST','SEND_CHAT'),('CO_HOST','SEND_PRIVATE_CHAT'),('CO_HOST','DELETE_CHAT'),('CO_HOST','MANAGE_CHAT'),('CO_HOST','CREATE_POLL'),('CO_HOST','MANAGE_POLLS'),('CO_HOST','VOTE_POLL'),('CO_HOST','USE_WHITEBOARD'),('CO_HOST','MANAGE_WHITEBOARD'),('CO_HOST','SHARE_FILE'),('CO_HOST','START_RECORDING'),('CO_HOST','STOP_RECORDING'),('CO_HOST','MUTE_OTHERS'),('CO_HOST','DISABLE_MIC'),('CO_HOST','DISABLE_CAMERA'),('CO_HOST','REMOVE_PARTICIPANT'),('CO_HOST','BAN_PARTICIPANT'),('CO_HOST','LOCK_ROOM'),('CO_HOST','MANAGE_ROLES'),('CO_HOST','MANAGE_WAITING_ROOM'),('CO_HOST','MANAGE_TIMER'),('CO_HOST','START_BREAK'),('CO_HOST','PIN_PARTICIPANT'),('CO_HOST','MANAGE_BREAKOUTS'),('MODERATOR','JOIN_ROOM'),('MODERATOR','PUBLISH_MIC'),('MODERATOR','PUBLISH_CAMERA'),('MODERATOR','PUBLISH_SCREEN'),('MODERATOR','SUBSCRIBE_MEDIA'),('MODERATOR','SEND_CHAT'),('MODERATOR','SEND_PRIVATE_CHAT'),('MODERATOR','DELETE_CHAT'),('MODERATOR','CREATE_POLL'),('MODERATOR','MANAGE_POLLS'),('MODERATOR','VOTE_POLL'),('MODERATOR','USE_WHITEBOARD'),('MODERATOR','SHARE_FILE'),('MODERATOR','START_RECORDING'),('MODERATOR','STOP_RECORDING'),('MODERATOR','MUTE_OTHERS'),('MODERATOR','DISABLE_MIC'),('MODERATOR','DISABLE_CAMERA'),('MODERATOR','REMOVE_PARTICIPANT'),('MODERATOR','LOCK_ROOM'),('MODERATOR','MANAGE_ROLES'),('MODERATOR','MANAGE_WAITING_ROOM'),('MODERATOR','MANAGE_TIMER'),('MODERATOR','PIN_PARTICIPANT'),('PRESENTER','JOIN_ROOM'),('PRESENTER','PUBLISH_MIC'),('PRESENTER','PUBLISH_CAMERA'),('PRESENTER','PUBLISH_SCREEN'),('PRESENTER','SUBSCRIBE_MEDIA'),('PRESENTER','SEND_CHAT'),('PRESENTER','SEND_PRIVATE_CHAT'),('PRESENTER','VOTE_POLL'),('PRESENTER','USE_WHITEBOARD'),('PRESENTER','SHARE_FILE'),('PARTICIPANT','JOIN_ROOM'),('PARTICIPANT','PUBLISH_MIC'),('PARTICIPANT','PUBLISH_CAMERA'),('PARTICIPANT','PUBLISH_SCREEN'),('PARTICIPANT','SUBSCRIBE_MEDIA'),('PARTICIPANT','SEND_CHAT'),('PARTICIPANT','SEND_PRIVATE_CHAT'),('PARTICIPANT','VOTE_POLL'),('PARTICIPANT','USE_WHITEBOARD'),('PARTICIPANT','SHARE_FILE'),('VIEWER','JOIN_ROOM'),('VIEWER','SUBSCRIBE_MEDIA'),('VIEWER','SEND_CHAT'),('VIEWER','SEND_PRIVATE_CHAT'),('VIEWER','VOTE_POLL')
on conflict (role, permission) do nothing;

create or replace function private.normalize_conference_rbac_role(p_role text)
returns text language sql immutable set search_path='' as $$
  select case upper(replace(trim(coalesce(p_role,'')), '-', '_'))
    when 'OWNER' then 'OWNER' when 'HOST' then 'HOST'
    when 'ADMIN' then 'CO_HOST' when 'COHOST' then 'CO_HOST' when 'CO_HOST' then 'CO_HOST'
    when 'MODERATOR' then 'MODERATOR' when 'PRESENTER' then 'PRESENTER'
    when 'MEMBER' then 'PARTICIPANT' when 'PARTICIPANT' then 'PARTICIPANT'
    when 'GUEST' then 'VIEWER' when 'VIEWER' then 'VIEWER'
    else null end
$$;

create or replace function private.conference_effective_role(p_room_id uuid, p_user_id uuid)
returns text language plpgsql stable security definer set search_path='' as $$
declare v_host_id uuid; v_meeting_id uuid; v_role text;
begin
  if p_user_id is null then return null; end if;
  select r.host_id,r.meeting_id into v_host_id,v_meeting_id from public.conference_rooms r where r.id=p_room_id;
  if not found then return null; end if;
  if v_host_id=p_user_id then return 'OWNER'; end if;
  select a.role into v_role from private.conference_role_assignments a where a.room_id=p_room_id and a.user_id=p_user_id;
  if v_role is not null then return v_role; end if;
  select private.normalize_conference_rbac_role(p.role) into v_role
  from public.conference_participants p where p.room_id=p_room_id and p.user_id=p_user_id limit 1;
  if v_role is not null then return v_role; end if;
  if v_meeting_id is not null and exists(
    select 1 from public.meetings m
    where m.id=v_meeting_id and (
      m.user_id=p_user_id or m.meeting_manager=p_user_id
      or p_user_id=any(coalesce(m.participant_user_ids,'{}'::uuid[]))
    )
  ) then return 'PARTICIPANT'; end if;
  return null;
end;
$$;

create or replace function private.conference_role_rank(p_role text)
returns integer language sql stable security definer set search_path='' as $$
  select r.role_rank::integer from private.conference_rbac_roles r
  where r.role=private.normalize_conference_rbac_role(p_role)
$$;

create or replace function private.has_conference_permission(p_room_id uuid,p_permission text,p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_role text;
begin
  if p_user_id is null or nullif(trim(p_permission),'') is null then return false; end if;
  v_role:=private.conference_effective_role(p_room_id,p_user_id);
  if v_role is null then return false; end if;
  return exists(select 1 from private.conference_role_permissions rp
    where rp.role=v_role and rp.permission=upper(trim(p_permission)));
end;
$$;

create or replace function private.has_conference_permission(p_room_id uuid,p_permission text)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    and private.has_conference_permission(p_room_id,p_permission,auth.uid())
$$;

create or replace function private.get_conference_authorization(p_room_id uuid,p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_role text; v_permissions jsonb;
begin
  v_role:=private.conference_effective_role(p_room_id,p_user_id);
  if v_role is null then
    return jsonb_build_object('ok',false,'reason','not_authorized','role',null,'permissions','[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(rp.permission order by rp.permission),'[]'::jsonb)
  into v_permissions from private.conference_role_permissions rp where rp.role=v_role;
  return jsonb_build_object('ok',true,'role',v_role,'permissions',v_permissions);
end;
$$;

create or replace function public.get_my_conference_authorization(p_room_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select private.get_conference_authorization(p_room_id,auth.uid())
$$;
revoke execute on function public.get_my_conference_authorization(uuid) from public,anon;
grant execute on function public.get_my_conference_authorization(uuid) to authenticated,service_role;

revoke execute on function private.normalize_conference_rbac_role(text) from public,anon;
revoke execute on function private.conference_effective_role(uuid,uuid) from public,anon;
revoke execute on function private.conference_role_rank(text) from public,anon;
revoke execute on function private.has_conference_permission(uuid,text,uuid) from public,anon;
revoke execute on function private.has_conference_permission(uuid,text) from public,anon;
revoke execute on function private.get_conference_authorization(uuid,uuid) from public,anon;
grant usage on schema private to authenticated,service_role;
grant execute on function private.conference_effective_role(uuid,uuid) to authenticated,service_role;
grant execute on function private.has_conference_permission(uuid,text) to authenticated,service_role;
grant execute on function private.get_conference_authorization(uuid,uuid) to authenticated,service_role;

create or replace function public.get_conference_participants_rbac(p_room_id uuid)
returns table(user_id uuid,display_name text,role text,is_muted boolean,is_hand_raised boolean,hand_raised_at timestamptz,status text)
language sql stable security invoker set search_path='' as $$
  select p.user_id,p.display_name,private.conference_effective_role(p_room_id,p.user_id),
         p.is_muted,p.is_hand_raised,p.hand_raised_at,p.status
  from public.conference_participants p
  where p.room_id=p_room_id and p.status='joined'
  order by p.hand_raised_at asc nulls last,p.joined_at asc nulls last
$$;
revoke execute on function public.get_conference_participants_rbac(uuid) from public,anon;
grant execute on function public.get_conference_participants_rbac(uuid) to authenticated,service_role;

create or replace function private.can_manage_conference(p_room_id uuid,p_permission text)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_permission text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then return false; end if;
  v_permission:=case lower(trim(coalesce(p_permission,'')))
    when 'kick' then 'REMOVE_PARTICIPANT'
    when 'ban' then 'BAN_PARTICIPANT'
    when 'toggle_chat' then 'MANAGE_CHAT'
    when 'toggle_whiteboard' then 'MANAGE_WHITEBOARD'
    when 'mute_all' then 'MUTE_OTHERS'
    when 'mute_user' then 'MUTE_OTHERS'
    when 'manage_polls' then 'MANAGE_POLLS'
    when 'lower_hand' then 'MUTE_OTHERS'
    when 'manage_roles' then 'MANAGE_ROLES'
    when 'end_room' then 'END_MEETING'
    when 'transfer_host' then 'TRANSFER_OWNERSHIP'
    else upper(trim(coalesce(p_permission,''))) end;
  return private.has_conference_permission(p_room_id,v_permission,auth.uid());
end;
$$;

create or replace function private.set_conference_participant_role(p_room_id uuid,p_target_user_id uuid,p_role text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=auth.uid(); v_new_role text; v_actor_role text; v_target_role text;
  v_actor_rank integer; v_target_rank integer; v_new_rank integer; v_host uuid; v_legacy_role text;
begin
  if v_actor is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated'); end if;
  if not private.has_conference_permission(p_room_id,'MANAGE_ROLES',v_actor) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  v_new_role:=private.normalize_conference_rbac_role(p_role);
  if v_new_role is null or v_new_role='OWNER' then
    return jsonb_build_object('ok',false,'reason','invalid_role'); end if;
  select r.host_id into v_host from public.conference_rooms r where r.id=p_room_id and r.status<>'ended';
  if not found then return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  if p_target_user_id=v_host then return jsonb_build_object('ok',false,'reason','cannot_change_owner_role'); end if;
  if p_target_user_id=v_actor then return jsonb_build_object('ok',false,'reason','cannot_target_self'); end if;
  if not exists(select 1 from public.conference_participants p
    where p.room_id=p_room_id and p.user_id=p_target_user_id and p.status='joined') then
    return jsonb_build_object('ok',false,'reason','participant_not_found'); end if;

  v_actor_role:=private.conference_effective_role(p_room_id,v_actor);
  v_target_role:=private.conference_effective_role(p_room_id,p_target_user_id);
  v_actor_rank:=private.conference_role_rank(v_actor_role);
  v_target_rank:=private.conference_role_rank(v_target_role);
  v_new_rank:=private.conference_role_rank(v_new_role);
  if v_actor_role<>'OWNER' and (
    v_actor_rank is null or v_new_rank is null or v_actor_rank<=v_new_rank
    or (v_target_rank is not null and v_actor_rank<=v_target_rank)
  ) then return jsonb_build_object('ok',false,'reason','forbidden_role_escalation'); end if;

  insert into private.conference_role_assignments(room_id,user_id,role,assigned_by,updated_at)
  values(p_room_id,p_target_user_id,v_new_role,v_actor,now())
  on conflict(room_id,user_id) do update
  set role=excluded.role,assigned_by=excluded.assigned_by,updated_at=now();

  v_legacy_role:=case v_new_role when 'HOST' then 'admin' when 'CO_HOST' then 'admin'
    when 'MODERATOR' then 'moderator' else 'member' end;
  update public.conference_participants set role=v_legacy_role,updated_at=now()
  where room_id=p_room_id and user_id=p_target_user_id;

  insert into public.conference_audit_events(room_id,actor_user_id,target_user_id,event_type,metadata)
  values(p_room_id,v_actor,p_target_user_id,'participant_permission_changed',jsonb_build_object('role',v_new_role));

  return jsonb_build_object('ok',true,'role',v_new_role,'permissions',(
    select coalesce(jsonb_agg(rp.permission order by rp.permission),'[]'::jsonb)
    from private.conference_role_permissions rp where rp.role=v_new_role
  ));
end;
$$;

create or replace function private.admit_livekit_conference_participant(p_room_id uuid,p_target_user_id uuid,p_admit boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_status text:=case when p_admit then 'admitted' else 'rejected' end;
begin
  if v_uid is null or not private.has_conference_permission(p_room_id,'MANAGE_WAITING_ROOM',v_uid) then
    return jsonb_build_object('ok',false,'reason','not_authorized'); end if;
  update public.conference_waiting_room set status=v_status,resolved_at=now()
  where id=(select w.id from public.conference_waiting_room w
    where w.room_id=p_room_id and w.user_id=p_target_user_id
    order by w.requested_at desc limit 1);
  if not found then return jsonb_build_object('ok',false,'reason','request_not_found'); end if;
  insert into public.conference_audit_events(room_id,actor_user_id,target_user_id,event_type)
  values(p_room_id,v_uid,p_target_user_id,case when p_admit then 'participant_admitted' else 'participant_rejected' end);
  return jsonb_build_object('ok',true,'status',v_status);
end;
$$;

create or replace function private.set_livekit_room_lock(p_room_id uuid,p_locked boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'LOCK_ROOM',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  update public.conference_rooms set is_locked=p_locked
  where id=p_room_id and media_topology='sfu' and status<>'ended';
  if not found then return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  insert into public.conference_audit_events(room_id,actor_user_id,event_type)
  values(p_room_id,auth.uid(),case when p_locked then 'meeting_locked' else 'meeting_unlocked' end);
  return jsonb_build_object('ok',true,'locked',p_locked);
end;
$$;

create or replace function private.moderate_conference_participant(p_room_id uuid,p_target_user_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_permission text;
begin
  v_permission:=case p_action when 'kick' then 'REMOVE_PARTICIPANT'
    when 'mute' then 'MUTE_OTHERS' when 'lower_hand' then 'MUTE_OTHERS' else null end;
  if v_permission is null or auth.uid() is null
     or not private.has_conference_permission(p_room_id,v_permission,auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_target_user_id=auth.uid() then return jsonb_build_object('ok',false,'reason','cannot_target_self'); end if;
  if p_action='kick' then
    update public.conference_participants set status='left',left_at=now(),last_seen=now()
    where room_id=p_room_id and user_id=p_target_user_id and status='joined';
    insert into public.room_mod_actions(room_id,by_admin_id,target_user_id,action_type)
    values(p_room_id,auth.uid()::text,p_target_user_id::text,'kick');
  elsif p_action='mute' then
    update public.conference_participants set is_muted=true
    where room_id=p_room_id and user_id=p_target_user_id and status='joined';
    insert into public.room_mod_actions(room_id,by_admin_id,target_user_id,action_type)
    values(p_room_id,auth.uid()::text,p_target_user_id::text,'mute');
  else
    update public.conference_participants set is_hand_raised=false,hand_raised_at=null,updated_at=now()
    where room_id=p_room_id and user_id=p_target_user_id and status='joined';
  end if;
  if not found and p_action='lower_hand' then return jsonb_build_object('ok',false,'reason','participant_not_found'); end if;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.ban_conference_participant(
  p_room_id uuid,p_target_user_id uuid,p_display_name text,p_duration_minutes integer default null,p_reason text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_exp timestamptz;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.has_conference_permission(p_room_id,'BAN_PARTICIPANT',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_target_user_id=auth.uid() then return jsonb_build_object('ok',false,'reason','cannot_target_self'); end if;
  v_exp:=case when p_duration_minutes is null then null else now()+make_interval(mins=>greatest(1,p_duration_minutes)) end;
  insert into public.banned_users(room_id,user_id,display_name,banned_by,expires_at,reason)
  values(p_room_id,p_target_user_id,left(coalesce(p_display_name,''),120),auth.uid(),v_exp,nullif(trim(p_reason),''))
  on conflict(room_id,user_id) do update
  set display_name=excluded.display_name,banned_by=excluded.banned_by,banned_at=now(),expires_at=excluded.expires_at,reason=excluded.reason;
  update public.conference_participants set status='left',left_at=now(),last_seen=now()
  where room_id=p_room_id and user_id=p_target_user_id and status='joined';
  insert into public.room_mod_actions(room_id,by_admin_id,target_user_id,action_type)
  values(p_room_id,auth.uid()::text,p_target_user_id::text,'ban');
  return jsonb_build_object('ok',true,'expires_at',v_exp);
end;
$$;

create or replace function private.set_conference_chat_enabled(p_room_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'MANAGE_CHAT',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  update public.conference_rooms set chat_enabled=p_enabled where id=p_room_id and status<>'ended';
  return jsonb_build_object('ok',found);
end;
$$;

create or replace function private.clear_conference_whiteboard(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'MANAGE_WHITEBOARD',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  delete from public.conference_whiteboard where room_id=p_room_id;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.mute_all_conference_participants(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'MUTE_OTHERS',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  insert into public.room_mod_actions(room_id,by_admin_id,target_user_id,action_type)
  select p_room_id,auth.uid()::text,p.user_id::text,'mute'
  from public.conference_participants p
  where p.room_id=p_room_id and p.status='joined' and p.user_id<>auth.uid();
  update public.conference_participants set is_muted=true
  where room_id=p_room_id and status='joined' and user_id<>auth.uid();
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.set_conference_participant_speaking_limit(p_room_id uuid,p_target_user_id uuid,p_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'MANAGE_TIMER',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_seconds<10 or p_seconds>600 then return jsonb_build_object('ok',false,'reason','invalid_limit'); end if;
  update public.conference_participants set speaking_limit_seconds=p_seconds
  where room_id=p_room_id and user_id=p_target_user_id;
  return jsonb_build_object('ok',found);
end;
$$;

create or replace function private.set_conference_speaking_limit_enabled(p_room_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'MANAGE_TIMER',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  update public.conference_rooms set speaking_limit_enabled=p_enabled
  where id=p_room_id and status<>'ended';
  return jsonb_build_object('ok',found);
end;
$$;

create or replace function private.set_conference_pinned_user(p_room_id uuid,p_user_id uuid default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'PIN_PARTICIPANT',auth.uid()) then return false; end if;
  if p_user_id is not null and not exists(select 1 from public.conference_participants p
    where p.room_id=p_room_id and p.user_id=p_user_id and p.status='joined') then return false; end if;
  update public.conference_rooms set pinned_user_id=p_user_id where id=p_room_id and status<>'ended';
  return found;
end;
$$;

create or replace function private.create_conference_breakouts(p_main_room_id uuid,p_names text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_name text; v_created jsonb:='[]'::jsonb; v_row public.conference_breakout_rooms%rowtype; v_code text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.has_conference_permission(p_main_room_id,'MANAGE_BREAKOUTS',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if coalesce(array_length(p_names,1),0)<1 or array_length(p_names,1)>10 then
    return jsonb_build_object('ok',false,'reason','invalid_count'); end if;
  update public.conference_breakout_rooms set status='ended',ended_at=now()
  where main_room_id=p_main_room_id and status='active';
  delete from public.conference_breakout_assignments where main_room_id=p_main_room_id;
  foreach v_name in array p_names loop
    if nullif(trim(v_name),'') is null then continue; end if;
    loop
      v_code:='BRK-'||upper(substr(encode(gen_random_bytes(5),'hex'),1,10));
      exit when not exists(select 1 from public.conference_breakout_rooms where code=v_code);
    end loop;
    insert into public.conference_breakout_rooms(main_room_id,name,code,status,created_by)
    values(p_main_room_id,left(trim(v_name),80),v_code,'active',auth.uid()) returning * into v_row;
    v_created:=v_created||jsonb_build_array(jsonb_build_object('id',v_row.id,'name',v_row.name,'status',v_row.status));
  end loop;
  return jsonb_build_object('ok',true,'rooms',v_created);
end;
$$;

create or replace function private.end_conference_breakouts(p_main_room_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
     or not private.has_conference_permission(p_main_room_id,'MANAGE_BREAKOUTS',auth.uid()) then return false; end if;
  update public.conference_breakout_rooms set status='ended',ended_at=now()
  where main_room_id=p_main_room_id and status='active';
  delete from public.conference_breakout_assignments where main_room_id=p_main_room_id;
  return true;
end;
$$;

create or replace function private.end_conference_room(p_room_id uuid,p_reason text default 'ended_by_host')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'END_MEETING',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  update public.conference_rooms
  set status='ended',ended_at=now(),ended_reason=coalesce(nullif(trim(p_reason),''),'ended_by_host')
  where id=p_room_id and status<>'ended';
  update public.conference_participants
  set status='left',left_at=coalesce(left_at,now()),last_seen=now()
  where room_id=p_room_id and status='joined';
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function private.transfer_conference_host(p_room_id uuid,p_target_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_old uuid; v_name text;
begin
  if auth.uid() is null or not private.has_conference_permission(p_room_id,'TRANSFER_OWNERSHIP',auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  select r.host_id into v_old from public.conference_rooms r
  where r.id=p_room_id and r.status<>'ended' for update;
  if v_old is null then return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  if v_old<>auth.uid() then return jsonb_build_object('ok',false,'reason','owner_only'); end if;
  select p.display_name into v_name from public.conference_participants p
  where p.room_id=p_room_id and p.user_id=p_target_user_id and p.status='joined';
  if v_name is null then return jsonb_build_object('ok',false,'reason','target_not_eligible'); end if;
  insert into private.conference_role_assignments(room_id,user_id,role,assigned_by,updated_at)
  values(p_room_id,v_old,'HOST',auth.uid(),now())
  on conflict(room_id,user_id) do update set role='HOST',assigned_by=excluded.assigned_by,updated_at=now();
  delete from private.conference_role_assignments where room_id=p_room_id and user_id=p_target_user_id;
  update public.conference_participants
  set role=case when user_id=p_target_user_id then 'host' when user_id=v_old then 'admin' else role end,updated_at=now()
  where room_id=p_room_id and user_id in (p_target_user_id,v_old);
  update public.conference_rooms set host_id=p_target_user_id where id=p_room_id;
  return jsonb_build_object('ok',true,'new_host_user_id',p_target_user_id,'new_host_name',v_name);
end;
$$;

create or replace function private.prepare_livekit_conference_join(p_room_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid(); v_room public.conference_rooms%rowtype; v_role text; v_display_name text:='';
  v_joined_count integer; v_waiting_status text; v_meeting_allowed boolean:=false;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated'); end if;
  select * into v_room from public.conference_rooms where id=p_room_id for update;
  if not found or v_room.media_topology<>'sfu' or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  if v_room.status='ended' or (v_room.expires_at is not null and v_room.expires_at<=now()) then
    return jsonb_build_object('ok',false,'reason','room_ended'); end if;
  if v_room.is_locked and v_room.host_id<>v_uid then
    return jsonb_build_object('ok',false,'reason','room_locked'); end if;
  if exists(select 1 from public.banned_users b
    where b.room_id=p_room_id and b.user_id=v_uid and (b.expires_at is null or b.expires_at>now())) then
    return jsonb_build_object('ok',false,'reason','banned'); end if;

  if v_room.meeting_id is not null then
    select exists(select 1 from public.meetings m
      where m.id=v_room.meeting_id
        and (m.user_id=v_uid or m.meeting_manager=v_uid or v_uid=any(coalesce(m.participant_user_ids,'{}'::uuid[]))))
    into v_meeting_allowed;
  else
    v_meeting_allowed:=v_room.host_id=v_uid or exists(
      select 1 from public.conference_participants p where p.room_id=p_room_id and p.user_id=v_uid
    );
  end if;

  if not v_meeting_allowed then return jsonb_build_object('ok',false,'reason','not_authorized'); end if;
  if not private.has_conference_permission(p_room_id,'JOIN_ROOM',v_uid) then
    return jsonb_build_object('ok',false,'reason','permission_denied'); end if;

  if v_room.host_id=v_uid then v_role:='host';
  else
    select p.role,p.display_name into v_role,v_display_name from public.conference_participants p
    where p.room_id=p_room_id and p.user_id=v_uid;
    if v_role not in ('admin','moderator') then v_role:='member'; end if;
  end if;

  if (v_room.waiting_room_enabled or v_room.require_approval) and v_room.host_id<>v_uid then
    select w.status into v_waiting_status from public.conference_waiting_room w
    where w.room_id=p_room_id and w.user_id=v_uid order by w.requested_at desc limit 1;
    if v_waiting_status is distinct from 'admitted' then
      if v_waiting_status is null then
        insert into public.conference_waiting_room(room_id,user_id,display_name,status,requested_at)
        values(p_room_id,v_uid,coalesce(v_display_name,''),'waiting',now());
      elsif v_waiting_status='rejected' then
        return jsonb_build_object('ok',false,'reason','rejected');
      end if;
      return jsonb_build_object('ok',false,'reason','waiting_for_admission');
    end if;
  end if;

  select count(*) into v_joined_count from public.conference_participants p
  where p.room_id=p_room_id and p.status='joined' and p.user_id<>v_uid;
  if v_joined_count>=least(v_room.max_participants,20) then
    return jsonb_build_object('ok',false,'reason','room_full'); end if;

  insert into public.conference_participants(room_id,user_id,display_name,role,status,joined_at,left_at,peer_id,last_seen)
  values(p_room_id,v_uid,coalesce(v_display_name,''),coalesce(v_role,'member'),'joined',now(),null,'',now())
  on conflict(room_id,user_id) do update
  set role=excluded.role,status='joined',joined_at=now(),left_at=null,last_seen=now();

  insert into public.conference_audit_events(room_id,actor_user_id,event_type)
  values(p_room_id,v_uid,'participant_joined');

  return jsonb_build_object(
    'ok',true,'reason','ok','room_id',v_room.id,'meeting_id',v_room.meeting_id,
    'livekit_room_name',v_room.livekit_room_name,'role',coalesce(v_role,'member'),
    'rbac_role',private.conference_effective_role(p_room_id,v_uid),
    'display_name',coalesce(v_display_name,''),'max_participants',least(v_room.max_participants,20)
  );
end;
$$;

create or replace function private.authorize_livekit_host_action(p_room_id uuid,p_target_user_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_room public.conference_rooms%rowtype; v_permission text; v_role text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated'); end if;
  select * into v_room from public.conference_rooms where id=p_room_id;
  if not found or v_room.media_topology<>'sfu' or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  v_permission:=case p_action
    when 'remove' then 'REMOVE_PARTICIPANT' when 'mute' then 'MUTE_OTHERS'
    when 'lower-hand' then 'MUTE_OTHERS' when 'promote' then 'MANAGE_ROLES'
    when 'demote' then 'MANAGE_ROLES' when 'lock' then 'LOCK_ROOM'
    when 'unlock' then 'LOCK_ROOM' when 'end' then 'END_MEETING' else null end;
  if v_permission is null or not private.has_conference_permission(p_room_id,v_permission,auth.uid()) then
    return jsonb_build_object('ok',false,'reason','forbidden'); end if;
  if p_target_user_id is not null and p_target_user_id=auth.uid() then
    return jsonb_build_object('ok',false,'reason','cannot_target_self'); end if;
  v_role:=private.conference_effective_role(p_room_id,auth.uid());
  return jsonb_build_object('ok',true,'role',v_role,'permission',v_permission,
    'livekit_room_name',v_room.livekit_room_name,'room_id',v_room.id);
end;
$$;

create or replace function public.authorize_livekit_host_action(p_room_id uuid,p_target_user_id uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.authorize_livekit_host_action(p_room_id,p_target_user_id,p_action)
$$;
revoke execute on function public.authorize_livekit_host_action(uuid,uuid,text) from public,anon;
grant execute on function public.authorize_livekit_host_action(uuid,uuid,text) to authenticated,service_role;

create or replace function private.authorize_livekit_recording(p_room_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=auth.uid(); v_room public.conference_rooms%rowtype; v_permission text; v_role text;
begin
  if v_uid is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated'); end if;
  select * into v_room from public.conference_rooms where id=p_room_id;
  if not found or v_room.media_topology<>'sfu' or v_room.livekit_room_name is null then
    return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  if v_room.status='ended' then return jsonb_build_object('ok',false,'reason','room_ended'); end if;
  v_permission:=case p_action when 'start' then 'START_RECORDING' when 'stop' then 'STOP_RECORDING' else null end;
  if v_permission is null or not private.has_conference_permission(p_room_id,v_permission,v_uid) then
    return jsonb_build_object('ok',false,'reason','not_authorized'); end if;
  v_role:=private.conference_effective_role(p_room_id,v_uid);
  return jsonb_build_object('ok',true,'room_id',v_room.id,'meeting_id',v_room.meeting_id,
    'livekit_room_name',v_room.livekit_room_name,'role',v_role,'permission',v_permission);
end;
$$;

create or replace function public.authorize_livekit_recording(p_room_id uuid,p_action text)
returns jsonb language sql security invoker set search_path='' as $$
  select private.authorize_livekit_recording(p_room_id,p_action)
$$;
revoke execute on function public.authorize_livekit_recording(uuid,text) from public,anon;
grant execute on function public.authorize_livekit_recording(uuid,text) to authenticated,service_role;

drop policy if exists "Authenticated users can send messages" on public.conference_messages;
create policy "Authenticated users can send messages" on public.conference_messages
for insert to authenticated with check (
  (select auth.uid())=user_id
  and private.is_conference_joined_actor_in_room(room_id)
  and private.has_conference_permission(room_id,'SEND_CHAT')
  and exists(select 1 from public.conference_rooms r
    where r.id=conference_messages.room_id and r.chat_enabled=true and r.status<>'ended')
);

drop policy if exists "conference_poll_votes_insert_auth" on public.conference_poll_votes;
create policy "conference_poll_votes_insert_auth" on public.conference_poll_votes
for insert to authenticated with check (
  user_id=(select auth.uid())
  and private.is_conference_joined_actor_in_room(room_id)
  and private.has_conference_permission(room_id,'VOTE_POLL')
  and exists(select 1 from public.conference_polls p
    where p.id=conference_poll_votes.poll_id and p.room_id=conference_poll_votes.room_id
      and p.is_active=true and conference_poll_votes.option_index>=0
      and conference_poll_votes.option_index<jsonb_array_length(p.options))
);

drop policy if exists "conference_polls_insert_managers" on public.conference_polls;
create policy "conference_polls_insert_managers" on public.conference_polls
for insert to authenticated with check (
  created_by=(select auth.uid()) and private.has_conference_permission(room_id,'CREATE_POLL')
);
drop policy if exists "conference_polls_update_managers" on public.conference_polls;
create policy "conference_polls_update_managers" on public.conference_polls
for update to authenticated
using (private.has_conference_permission(room_id,'MANAGE_POLLS'))
with check (private.has_conference_permission(room_id,'MANAGE_POLLS'));
drop policy if exists "conference_polls_delete_managers" on public.conference_polls;
create policy "conference_polls_delete_managers" on public.conference_polls
for delete to authenticated using (private.has_conference_permission(room_id,'MANAGE_POLLS'));

drop policy if exists "conference_whiteboard_insert_auth" on public.conference_whiteboard;
create policy "conference_whiteboard_insert_auth" on public.conference_whiteboard
for insert to authenticated with check (
  user_id=(select auth.uid())
  and private.is_conference_joined_actor_in_room(room_id)
  and private.has_conference_permission(room_id,'USE_WHITEBOARD')
);

drop policy if exists "Hosts can update waiting room" on public.conference_waiting_room;
drop policy if exists "RBAC managers can update waiting room" on public.conference_waiting_room;
create policy "RBAC managers can update waiting room" on public.conference_waiting_room
for update to authenticated
using (private.has_conference_permission(room_id,'MANAGE_WAITING_ROOM'))
with check (private.has_conference_permission(room_id,'MANAGE_WAITING_ROOM'));

drop policy if exists "Room participants can view waiting room" on public.conference_waiting_room;
create policy "Room participants can view waiting room" on public.conference_waiting_room
for select to authenticated using (
  user_id=(select auth.uid()) or private.has_conference_permission(room_id,'MANAGE_WAITING_ROOM')
);

drop policy if exists "delete_waiting_authenticated" on public.conference_waiting_room;
create policy "delete_waiting_authenticated" on public.conference_waiting_room
for delete to authenticated using (
  user_id=(select auth.uid()) or private.has_conference_permission(room_id,'MANAGE_WAITING_ROOM')
);

revoke execute on function public.authorize_livekit_host_action(uuid,uuid) from public,anon;
revoke execute on function public.authorize_livekit_recording(uuid) from public,anon;
revoke execute on function public.set_livekit_raise_hand(uuid,boolean) from public,anon;
revoke execute on function public.set_livekit_room_lock(uuid,boolean) from public,anon;
grant execute on function public.authorize_livekit_host_action(uuid,uuid) to authenticated,service_role;
grant execute on function public.authorize_livekit_recording(uuid) to authenticated,service_role;
grant execute on function public.set_livekit_raise_hand(uuid,boolean) to authenticated,service_role;
grant execute on function public.set_livekit_room_lock(uuid,boolean) to authenticated,service_role;

notify pgrst, 'reload schema';
