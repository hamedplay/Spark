
insert into private.conference_permissions(permission)
values ('SPOTLIGHT_PARTICIPANT')
on conflict(permission) do nothing;

insert into private.conference_role_permissions(role,permission)
select r.role,'SPOTLIGHT_PARTICIPANT'
from private.conference_rbac_roles r
where r.role in ('OWNER','HOST','CO_HOST','MODERATOR')
on conflict(role,permission) do nothing;

create table if not exists public.conference_spotlights (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  user_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(room_id,user_id)
);

create index if not exists conference_spotlights_room_created_idx
  on public.conference_spotlights(room_id,created_at,id);

alter table public.conference_spotlights enable row level security;

revoke all on table public.conference_spotlights
  from public,anon,authenticated;

grant select on table public.conference_spotlights
  to authenticated;

grant select,insert,update,delete on table public.conference_spotlights
  to service_role;

create or replace function private.can_read_conference_spotlight(
  p_room_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    p_user_id is not null
    and exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id
        and p.user_id=p_user_id
        and p.status='joined'
    )
$$;

revoke all on function private.can_read_conference_spotlight(uuid,uuid)
  from public,anon;
grant execute on function private.can_read_conference_spotlight(uuid,uuid)
  to authenticated,service_role;

drop policy if exists conference_spotlights_full_auth_boundary
  on public.conference_spotlights;

create policy conference_spotlights_full_auth_boundary
on public.conference_spotlights
as restrictive
for select
to authenticated
using (
  (select private.is_current_session_fully_authorized())
);

drop policy if exists conference_spotlights_joined_select
  on public.conference_spotlights;

create policy conference_spotlights_joined_select
on public.conference_spotlights
for select
to authenticated
using (
  private.can_read_conference_spotlight(
    room_id,
    (select auth.uid())
  )
);

create or replace function public.get_conference_spotlight_snapshot(
  p_room_id uuid
)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_user_id uuid;
  v_items jsonb;
begin
  v_user_id:=auth.uid();

  if v_user_id is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  if not private.can_read_conference_spotlight(
    p_room_id,
    v_user_id
  ) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',s.id,
        'userId',s.user_id,
        'createdBy',s.created_by,
        'createdAt',s.created_at
      )
      order by s.created_at,s.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.conference_spotlights s
  where s.room_id=p_room_id;

  return jsonb_build_object(
    'ok',true,
    'serverTime',clock_timestamp(),
    'canManage',private.has_conference_permission(
      p_room_id,
      'SPOTLIGHT_PARTICIPANT',
      v_user_id
    ),
    'items',v_items
  );
end;
$$;

revoke all on function public.get_conference_spotlight_snapshot(uuid)
  from public,anon;
grant execute on function public.get_conference_spotlight_snapshot(uuid)
  to authenticated,service_role;

create or replace function private.manage_conference_spotlight(
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
  v_actor_id uuid;
  v_action text;
  v_changed integer:=0;
begin
  v_actor_id:=auth.uid();
  v_action:=lower(trim(coalesce(p_action,'')));

  if v_actor_id is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;

  if not exists(
    select 1
    from public.conference_rooms r
    where r.id=p_room_id
      and r.status<>'ended'
  ) then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if not exists(
    select 1
    from public.conference_participants p
    where p.room_id=p_room_id
      and p.user_id=v_actor_id
      and p.status='joined'
  ) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  if not private.has_conference_permission(
    p_room_id,
    'SPOTLIGHT_PARTICIPANT',
    v_actor_id
  ) then
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if v_action='add' then
    if p_target_user_id is null then
      return jsonb_build_object('ok',false,'reason','target_required');
    end if;

    if not exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id
        and p.user_id=p_target_user_id
        and p.status='joined'
    ) then
      return jsonb_build_object(
        'ok',false,'reason','participant_not_found'
      );
    end if;

    insert into public.conference_spotlights(
      room_id,user_id,created_by
    )
    values(
      p_room_id,p_target_user_id,v_actor_id
    )
    on conflict(room_id,user_id) do nothing;

    get diagnostics v_changed=row_count;

    if v_changed>0 then
      insert into public.conference_audit_events(
        room_id,actor_user_id,target_user_id,event_type,metadata
      )
      values(
        p_room_id,
        v_actor_id,
        p_target_user_id,
        'participant_spotlight_added',
        jsonb_build_object('source','phase19')
      );
    end if;

    return jsonb_build_object(
      'ok',true,
      'action','add',
      'targetUserId',p_target_user_id,
      'changed',v_changed>0,
      'idempotent',v_changed=0
    );
  end if;

  if v_action='remove' then
    if p_target_user_id is null then
      return jsonb_build_object('ok',false,'reason','target_required');
    end if;

    delete from public.conference_spotlights s
    where s.room_id=p_room_id
      and s.user_id=p_target_user_id;

    get diagnostics v_changed=row_count;

    if v_changed>0 then
      insert into public.conference_audit_events(
        room_id,actor_user_id,target_user_id,event_type,metadata
      )
      values(
        p_room_id,
        v_actor_id,
        p_target_user_id,
        'participant_spotlight_removed',
        jsonb_build_object('source','phase19')
      );
    end if;

    return jsonb_build_object(
      'ok',true,
      'action','remove',
      'targetUserId',p_target_user_id,
      'changed',v_changed>0,
      'idempotent',v_changed=0
    );
  end if;

  if v_action='clear' then
    delete from public.conference_spotlights s
    where s.room_id=p_room_id;

    get diagnostics v_changed=row_count;

    if v_changed>0 then
      insert into public.conference_audit_events(
        room_id,actor_user_id,event_type,metadata
      )
      values(
        p_room_id,
        v_actor_id,
        'participant_spotlights_cleared',
        jsonb_build_object(
          'source','phase19',
          'count',v_changed
        )
      );
    end if;

    return jsonb_build_object(
      'ok',true,
      'action','clear',
      'changed',v_changed>0,
      'count',v_changed
    );
  end if;

  return jsonb_build_object('ok',false,'reason','invalid_action');
end;
$$;

revoke all on function private.manage_conference_spotlight(
  uuid,uuid,text
) from public,anon;
grant execute on function private.manage_conference_spotlight(
  uuid,uuid,text
) to authenticated,service_role;

create or replace function public.manage_conference_spotlight(
  p_room_id uuid,
  p_target_user_id uuid,
  p_action text
)
returns jsonb
language sql
set search_path=''
as $$
  select private.manage_conference_spotlight(
    p_room_id,p_target_user_id,p_action
  )
$$;

revoke all on function public.manage_conference_spotlight(
  uuid,uuid,text
) from public,anon;
grant execute on function public.manage_conference_spotlight(
  uuid,uuid,text
) to authenticated,service_role;

create or replace function private.cleanup_conference_spotlight_on_leave()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.status<>'joined'
     and old.status is distinct from new.status
     and new.user_id is not null then
    delete from public.conference_spotlights s
    where s.room_id=new.room_id
      and s.user_id=new.user_id;
  end if;

  return new;
end;
$$;

revoke all on function private.cleanup_conference_spotlight_on_leave()
  from public,anon,authenticated;

drop trigger if exists conference_spotlight_participant_leave_cleanup
  on public.conference_participants;

create trigger conference_spotlight_participant_leave_cleanup
after update of status
on public.conference_participants
for each row
execute function private.cleanup_conference_spotlight_on_leave();

do $$
begin
  if not exists(
    select 1
    from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_spotlights'
  ) then
    alter publication supabase_realtime
      add table public.conference_spotlights;
  end if;
end
$$;

comment on table public.conference_spotlights is
  'Phase 19 shared Host-controlled spotlight state. Pin remains client-local.';

comment on column public.conference_rooms.pinned_user_id is
  'Legacy mesh pin/presenter state. LiveKit Phase 19 pin is client-local and shared spotlight state is conference_spotlights.';
