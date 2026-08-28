create table if not exists public.conference_whiteboard_boards (
  room_id uuid primary key references public.conference_rooms(id) on delete cascade,
  is_locked boolean not null default false,
  revision bigint not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conference_whiteboard_pages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  title text not null default 'صفحه ۱',
  position integer not null,
  snapshot_data jsonb not null default '{"elements":[]}'::jsonb,
  revision bigint not null default 1,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conference_whiteboard_pages_title_check
    check(char_length(trim(title)) between 1 and 120),
  constraint conference_whiteboard_pages_position_check
    check(position>=0),
  constraint conference_whiteboard_pages_snapshot_check
    check(
      jsonb_typeof(snapshot_data)='object'
      and jsonb_typeof(snapshot_data->'elements')='array'
    ),
  constraint conference_whiteboard_pages_room_position_key
    unique(room_id,position)
);

create table if not exists public.conference_whiteboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  page_id uuid not null references public.conference_whiteboard_pages(id) on delete cascade,
  revision bigint not null,
  snapshot_data jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint conference_whiteboard_snapshots_snapshot_check
    check(
      jsonb_typeof(snapshot_data)='object'
      and jsonb_typeof(snapshot_data->'elements')='array'
    ),
  constraint conference_whiteboard_snapshots_page_revision_key
    unique(page_id,revision)
);

create index if not exists conference_whiteboard_pages_room_idx
  on public.conference_whiteboard_pages(room_id,position);

create index if not exists conference_whiteboard_snapshots_room_page_idx
  on public.conference_whiteboard_snapshots(room_id,page_id,revision desc);

alter table public.conference_whiteboard_boards enable row level security;
alter table public.conference_whiteboard_pages enable row level security;
alter table public.conference_whiteboard_snapshots enable row level security;

revoke all on table public.conference_whiteboard_boards
from public,anon,authenticated;
revoke all on table public.conference_whiteboard_pages
from public,anon,authenticated;
revoke all on table public.conference_whiteboard_snapshots
from public,anon,authenticated;

grant select on table public.conference_whiteboard_boards
to authenticated,service_role;
grant select on table public.conference_whiteboard_pages
to authenticated,service_role;
grant select on table public.conference_whiteboard_snapshots
to authenticated,service_role;

grant insert,update,delete on table public.conference_whiteboard_boards
to service_role;
grant insert,update,delete on table public.conference_whiteboard_pages
to service_role;
grant insert,update,delete on table public.conference_whiteboard_snapshots
to service_role;

create or replace function private.can_read_conference_whiteboard_v2(
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

revoke execute on function private.can_read_conference_whiteboard_v2(uuid,uuid)
from public,anon;
grant execute on function private.can_read_conference_whiteboard_v2(uuid,uuid)
to authenticated,service_role;

create or replace function private.can_edit_conference_whiteboard_v2(
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
    private.can_read_conference_whiteboard_v2(p_room_id,p_user_id)
    and private.has_conference_permission(
      p_room_id,'USE_WHITEBOARD',p_user_id
    )
    and (
      not coalesce((
        select b.is_locked
        from public.conference_whiteboard_boards b
        where b.room_id=p_room_id
      ),false)
      or private.has_conference_permission(
        p_room_id,'MANAGE_WHITEBOARD',p_user_id
      )
    )
$$;

revoke execute on function private.can_edit_conference_whiteboard_v2(uuid,uuid)
from public,anon;
grant execute on function private.can_edit_conference_whiteboard_v2(uuid,uuid)
to authenticated,service_role;

create policy "conference_whiteboard_boards_joined_select"
on public.conference_whiteboard_boards
for select to authenticated
using (
  private.can_read_conference_whiteboard_v2(
    conference_whiteboard_boards.room_id,
    (select auth.uid())
  )
);

create policy "conference_whiteboard_boards_full_auth_boundary"
on public.conference_whiteboard_boards
as restrictive
for select to authenticated
using ((select private.is_current_session_fully_authorized()));

create policy "conference_whiteboard_pages_joined_select"
on public.conference_whiteboard_pages
for select to authenticated
using (
  private.can_read_conference_whiteboard_v2(
    conference_whiteboard_pages.room_id,
    (select auth.uid())
  )
);

create policy "conference_whiteboard_pages_full_auth_boundary"
on public.conference_whiteboard_pages
as restrictive
for select to authenticated
using ((select private.is_current_session_fully_authorized()));

create policy "conference_whiteboard_snapshots_joined_select"
on public.conference_whiteboard_snapshots
for select to authenticated
using (
  private.can_read_conference_whiteboard_v2(
    conference_whiteboard_snapshots.room_id,
    (select auth.uid())
  )
);

create policy "conference_whiteboard_snapshots_full_auth_boundary"
on public.conference_whiteboard_snapshots
as restrictive
for select to authenticated
using ((select private.is_current_session_fully_authorized()));

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'conference-whiteboard-assets',
  'conference-whiteboard-assets',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

create or replace function private.whiteboard_asset_path_parts(
  p_name text
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_parts text[];
  v_room_id uuid;
  v_page_id uuid;
  v_owner_id uuid;
begin
  v_parts:=storage.foldername(p_name);
  if coalesce(array_length(v_parts,1),0)<3 then
    return jsonb_build_object('ok',false);
  end if;
  begin
    v_room_id:=v_parts[1]::uuid;
    v_page_id:=v_parts[2]::uuid;
    v_owner_id:=v_parts[3]::uuid;
  exception when invalid_text_representation then
    return jsonb_build_object('ok',false);
  end;
  return jsonb_build_object(
    'ok',true,'room_id',v_room_id,'page_id',v_page_id,'owner_id',v_owner_id
  );
end;
$$;

revoke execute on function private.whiteboard_asset_path_parts(text)
from public,anon;
grant execute on function private.whiteboard_asset_path_parts(text)
to authenticated,service_role;

create or replace function private.can_read_conference_whiteboard_asset(
  p_name text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_parts jsonb;
  v_room_id uuid;
  v_page_id uuid;
begin
  v_parts:=private.whiteboard_asset_path_parts(p_name);
  if coalesce((v_parts->>'ok')::boolean,false) is not true then
    return false;
  end if;
  v_room_id:=(v_parts->>'room_id')::uuid;
  v_page_id:=(v_parts->>'page_id')::uuid;
  return
    private.can_read_conference_whiteboard_v2(v_room_id,p_user_id)
    and exists(
      select 1 from public.conference_whiteboard_pages p
      where p.id=v_page_id and p.room_id=v_room_id
    );
end;
$$;

revoke execute on function private.can_read_conference_whiteboard_asset(text,uuid)
from public,anon;
grant execute on function private.can_read_conference_whiteboard_asset(text,uuid)
to authenticated,service_role;

create or replace function private.can_write_conference_whiteboard_asset(
  p_name text,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_parts jsonb;
  v_room_id uuid;
  v_page_id uuid;
  v_owner_id uuid;
begin
  v_parts:=private.whiteboard_asset_path_parts(p_name);
  if coalesce((v_parts->>'ok')::boolean,false) is not true then
    return false;
  end if;
  v_room_id:=(v_parts->>'room_id')::uuid;
  v_page_id:=(v_parts->>'page_id')::uuid;
  v_owner_id:=(v_parts->>'owner_id')::uuid;
  return
    v_owner_id=p_user_id
    and private.can_edit_conference_whiteboard_v2(v_room_id,p_user_id)
    and exists(
      select 1 from public.conference_whiteboard_pages p
      where p.id=v_page_id and p.room_id=v_room_id
    );
end;
$$;

revoke execute on function private.can_write_conference_whiteboard_asset(text,uuid)
from public,anon;
grant execute on function private.can_write_conference_whiteboard_asset(text,uuid)
to authenticated,service_role;

drop policy if exists "Conference whiteboard assets read" on storage.objects;
create policy "Conference whiteboard assets read"
on storage.objects for select to authenticated
using (
  bucket_id='conference-whiteboard-assets'
  and private.can_read_conference_whiteboard_asset(name,(select auth.uid()))
);

drop policy if exists "Conference whiteboard assets insert" on storage.objects;
create policy "Conference whiteboard assets insert"
on storage.objects for insert to authenticated
with check (
  bucket_id='conference-whiteboard-assets'
  and private.can_write_conference_whiteboard_asset(name,(select auth.uid()))
);

drop policy if exists "Conference whiteboard assets delete" on storage.objects;
create policy "Conference whiteboard assets delete"
on storage.objects for delete to authenticated
using (
  bucket_id='conference-whiteboard-assets'
  and (
    private.can_write_conference_whiteboard_asset(name,(select auth.uid()))
    or (
      private.can_read_conference_whiteboard_asset(name,(select auth.uid()))
      and private.has_conference_permission(
        (private.whiteboard_asset_path_parts(name)->>'room_id')::uuid,
        'MANAGE_WHITEBOARD',(select auth.uid())
      )
    )
  )
);

drop policy if exists "Conference whiteboard assets read boundary" on storage.objects;
create policy "Conference whiteboard assets read boundary"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id<>'conference-whiteboard-assets'
  or private.can_read_conference_whiteboard_asset(name,(select auth.uid()))
);

drop policy if exists "Conference whiteboard assets insert boundary" on storage.objects;
create policy "Conference whiteboard assets insert boundary"
on storage.objects as restrictive for insert to authenticated
with check (
  bucket_id<>'conference-whiteboard-assets'
  or private.can_write_conference_whiteboard_asset(name,(select auth.uid()))
);

drop policy if exists "Conference whiteboard assets delete boundary" on storage.objects;
create policy "Conference whiteboard assets delete boundary"
on storage.objects as restrictive for delete to authenticated
using (
  bucket_id<>'conference-whiteboard-assets'
  or private.can_write_conference_whiteboard_asset(name,(select auth.uid()))
  or (
    private.can_read_conference_whiteboard_asset(name,(select auth.uid()))
    and private.has_conference_permission(
      (private.whiteboard_asset_path_parts(name)->>'room_id')::uuid,
      'MANAGE_WHITEBOARD',(select auth.uid())
    )
  )
);

create or replace function private.ensure_conference_whiteboard_v2(
  p_room_id uuid,p_user_id uuid
)
returns void
language plpgsql volatile security definer set search_path=''
as $$
begin
  if not private.can_read_conference_whiteboard_v2(p_room_id,p_user_id) then
    raise exception 'whiteboard_not_joined';
  end if;
  insert into public.conference_whiteboard_boards(
    room_id,is_locked,revision,created_at,updated_at
  )
  values(p_room_id,false,1,clock_timestamp(),clock_timestamp())
  on conflict(room_id) do nothing;
  if not exists(
    select 1 from public.conference_whiteboard_pages p where p.room_id=p_room_id
  ) then
    insert into public.conference_whiteboard_pages(
      room_id,title,position,snapshot_data,revision,created_by,created_at,updated_at
    )
    values(
      p_room_id,'صفحه ۱',0,'{"elements":[]}'::jsonb,1,
      p_user_id,clock_timestamp(),clock_timestamp()
    )
    on conflict(room_id,position) do nothing;
  end if;
end;
$$;

revoke execute on function private.ensure_conference_whiteboard_v2(uuid,uuid)
from public,anon;
grant execute on function private.ensure_conference_whiteboard_v2(uuid,uuid)
to authenticated,service_role;

create or replace function private.get_conference_whiteboard_snapshot_v2(
  p_room_id uuid,p_user_id uuid
)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $$
declare
  v_room_status text;
  v_board public.conference_whiteboard_boards%rowtype;
  v_pages jsonb;
begin
  select r.status into v_room_status from public.conference_rooms r where r.id=p_room_id;
  if not found then return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  if not private.can_read_conference_whiteboard_v2(p_room_id,p_user_id) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;
  perform private.ensure_conference_whiteboard_v2(p_room_id,p_user_id);
  select * into v_board from public.conference_whiteboard_boards b where b.room_id=p_room_id;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'title',p.title,'position',p.position,'revision',p.revision,
      'snapshot',p.snapshot_data,'updatedAt',p.updated_at
    ) order by p.position,p.id
  ),'[]'::jsonb)
  into v_pages
  from public.conference_whiteboard_pages p where p.room_id=p_room_id;
  return jsonb_build_object(
    'ok',true,'roomStatus',v_room_status,'boardLocked',v_board.is_locked,
    'boardRevision',v_board.revision,
    'canUse',private.has_conference_permission(p_room_id,'USE_WHITEBOARD',p_user_id),
    'canManage',private.has_conference_permission(p_room_id,'MANAGE_WHITEBOARD',p_user_id),
    'pages',v_pages,'serverTime',clock_timestamp()
  );
end;
$$;

create or replace function public.get_conference_whiteboard_snapshot_v2(p_room_id uuid)
returns jsonb
language plpgsql volatile security invoker set search_path=''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;
  return private.get_conference_whiteboard_snapshot_v2(p_room_id,auth.uid());
end;
$$;

revoke execute on function public.get_conference_whiteboard_snapshot_v2(uuid)
from public,anon;
grant execute on function public.get_conference_whiteboard_snapshot_v2(uuid)
to authenticated,service_role;

create or replace function private.conference_whiteboard_action_allowed_v2(
  p_room_id uuid,p_actor_user_id uuid,p_action text,p_page_id uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_room_status text;
  v_is_locked boolean:=false;
begin
  if p_actor_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  select r.status into v_room_status from public.conference_rooms r where r.id=p_room_id;
  if not found then return jsonb_build_object('ok',false,'reason','room_not_found'); end if;
  if v_room_status='ended' then return jsonb_build_object('ok',false,'reason','room_ended'); end if;
  if not private.can_read_conference_whiteboard_v2(p_room_id,p_actor_user_id) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  if v_action in('add_page','delete_page','rename_page','lock','unlock','clear_page') then
    if not private.has_conference_permission(p_room_id,'MANAGE_WHITEBOARD',p_actor_user_id) then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
  elsif v_action in('upsert_element','delete_element') then
    if not private.has_conference_permission(p_room_id,'USE_WHITEBOARD',p_actor_user_id) then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;
    select coalesce(b.is_locked,false) into v_is_locked
    from public.conference_whiteboard_boards b where b.room_id=p_room_id;
    if v_is_locked and not private.has_conference_permission(
      p_room_id,'MANAGE_WHITEBOARD',p_actor_user_id
    ) then
      return jsonb_build_object('ok',false,'reason','board_locked');
    end if;
  else
    return jsonb_build_object('ok',false,'reason','unknown_action');
  end if;

  if p_page_id is not null and not exists(
    select 1 from public.conference_whiteboard_pages p
    where p.id=p_page_id and p.room_id=p_room_id
  ) then
    return jsonb_build_object('ok',false,'reason','page_not_found');
  end if;
  return jsonb_build_object('ok',true);
end;
$$;

revoke execute on function private.conference_whiteboard_action_allowed_v2(
  uuid,uuid,text,uuid
) from public,anon;
grant execute on function private.conference_whiteboard_action_allowed_v2(
  uuid,uuid,text,uuid
) to authenticated,service_role;

create or replace function public.authorize_conference_whiteboard_action_v2(
  p_room_id uuid,p_action text,p_page_id uuid default null
)
returns jsonb
language plpgsql stable security invoker set search_path=''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;
  return private.conference_whiteboard_action_allowed_v2(
    p_room_id,auth.uid(),p_action,p_page_id
  );
end;
$$;

revoke execute on function public.authorize_conference_whiteboard_action_v2(
  uuid,text,uuid
) from public,anon;
grant execute on function public.authorize_conference_whiteboard_action_v2(
  uuid,text,uuid
) to authenticated,service_role;

create or replace function private.apply_conference_whiteboard_action_v2(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_page_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_allowed jsonb;
  v_page public.conference_whiteboard_pages%rowtype;
  v_elements jsonb;
  v_element jsonb;
  v_sanitized jsonb;
  v_element_id text;
  v_type text;
  v_points jsonb;
  v_color text;
  v_width numeric;
  v_text text;
  v_asset_path text;
  v_now timestamptz:=clock_timestamp();
  v_new_revision bigint;
  v_livekit_room_name text;
  v_page_count integer;
  v_title text;
  v_new_page_id uuid;
  v_position integer;
  v_operation jsonb;
begin
  perform private.ensure_conference_whiteboard_v2(p_room_id,p_actor_user_id);
  v_allowed:=private.conference_whiteboard_action_allowed_v2(
    p_room_id,p_actor_user_id,v_action,p_page_id
  );
  if coalesce((v_allowed->>'ok')::boolean,false) is not true then return v_allowed; end if;

  select r.livekit_room_name into v_livekit_room_name
  from public.conference_rooms r where r.id=p_room_id;

  if v_action in('lock','unlock') then
    update public.conference_whiteboard_boards
    set is_locked=(v_action='lock'),revision=revision+1,
        updated_by=p_actor_user_id,updated_at=v_now
    where room_id=p_room_id
    returning revision into v_new_revision;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action',v_action,'roomId',p_room_id,
      'boardLocked',(v_action='lock'),'boardRevision',v_new_revision,
      'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  if v_action='add_page' then
    select count(*) into v_page_count
    from public.conference_whiteboard_pages p where p.room_id=p_room_id;
    if v_page_count>=20 then return jsonb_build_object('ok',false,'reason','page_limit_reached'); end if;
    v_title:=left(trim(coalesce(p_payload->>'title','صفحه '||(v_page_count+1)::text)),120);
    if v_title='' then v_title:='صفحه '||(v_page_count+1)::text; end if;
    select coalesce(max(p.position),-1)+1 into v_position
    from public.conference_whiteboard_pages p where p.room_id=p_room_id;
    insert into public.conference_whiteboard_pages(
      room_id,title,position,snapshot_data,revision,created_by,created_at,updated_at
    )
    values(
      p_room_id,v_title,v_position,'{"elements":[]}'::jsonb,1,
      p_actor_user_id,v_now,v_now
    ) returning id into v_new_page_id;
    insert into public.conference_whiteboard_snapshots(
      room_id,page_id,revision,snapshot_data,created_by,created_at
    )
    values(p_room_id,v_new_page_id,1,'{"elements":[]}'::jsonb,p_actor_user_id,v_now);
    update public.conference_whiteboard_boards
    set revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
    where room_id=p_room_id returning revision into v_new_revision;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action','add_page','roomId',p_room_id,
      'pageId',v_new_page_id,'title',v_title,'position',v_position,
      'boardRevision',v_new_revision,'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  if v_action='delete_page' then
    select count(*) into v_page_count
    from public.conference_whiteboard_pages p where p.room_id=p_room_id;
    if v_page_count<=1 then return jsonb_build_object('ok',false,'reason','last_page_required'); end if;
    delete from public.conference_whiteboard_pages where id=p_page_id and room_id=p_room_id;
    with ranked as (
      select p.id,row_number() over(order by p.position,p.id)-1 as new_position
      from public.conference_whiteboard_pages p where p.room_id=p_room_id
    )
    update public.conference_whiteboard_pages p
    set position=ranked.new_position,updated_at=v_now
    from ranked
    where p.id=ranked.id and p.position<>ranked.new_position;
    update public.conference_whiteboard_boards
    set revision=revision+1,updated_by=p_actor_user_id,updated_at=v_now
    where room_id=p_room_id returning revision into v_new_revision;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action','delete_page','roomId',p_room_id,
      'pageId',p_page_id,'boardRevision',v_new_revision,
      'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  select * into v_page
  from public.conference_whiteboard_pages p
  where p.id=p_page_id and p.room_id=p_room_id
  for update;
  if not found then return jsonb_build_object('ok',false,'reason','page_not_found'); end if;

  if v_action='rename_page' then
    v_title:=left(trim(coalesce(p_payload->>'title','')),120);
    if v_title='' then return jsonb_build_object('ok',false,'reason','invalid_title'); end if;
    update public.conference_whiteboard_pages
    set title=v_title,revision=revision+1,updated_at=v_now
    where id=v_page.id returning revision into v_new_revision;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action','rename_page','roomId',p_room_id,
      'pageId',v_page.id,'title',v_title,'revision',v_new_revision,
      'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  if v_action='clear_page' then
    update public.conference_whiteboard_pages
    set snapshot_data='{"elements":[]}'::jsonb,revision=revision+1,updated_at=v_now
    where id=v_page.id returning revision,snapshot_data into v_new_revision,v_elements;
    insert into public.conference_whiteboard_snapshots(
      room_id,page_id,revision,snapshot_data,created_by,created_at
    )
    values(p_room_id,v_page.id,v_new_revision,v_elements,p_actor_user_id,v_now)
    on conflict(page_id,revision) do nothing;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action','clear_page','roomId',p_room_id,
      'pageId',v_page.id,'revision',v_new_revision,
      'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  v_elements:=coalesce(v_page.snapshot_data->'elements','[]'::jsonb);

  if v_action='delete_element' then
    v_element_id:=trim(coalesce(p_payload->>'elementId',''));
    if v_element_id='' then return jsonb_build_object('ok',false,'reason','element_required'); end if;
    if not exists(
      select 1 from jsonb_array_elements(v_elements) e where e->>'id'=v_element_id
    ) then return jsonb_build_object('ok',true,'already_deleted',true); end if;
    select coalesce(jsonb_agg(e order by ordinality),'[]'::jsonb)
    into v_elements
    from jsonb_array_elements(v_elements) with ordinality a(e,ordinality)
    where e->>'id'<>v_element_id;
    update public.conference_whiteboard_pages
    set snapshot_data=jsonb_build_object('elements',v_elements),
        revision=revision+1,updated_at=v_now
    where id=v_page.id returning revision into v_new_revision;
    if v_new_revision%10=0 then
      insert into public.conference_whiteboard_snapshots(
        room_id,page_id,revision,snapshot_data,created_by,created_at
      )
      select p_room_id,v_page.id,v_new_revision,p.snapshot_data,p_actor_user_id,v_now
      from public.conference_whiteboard_pages p where p.id=v_page.id
      on conflict(page_id,revision) do nothing;
    end if;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action','delete_element','roomId',p_room_id,
      'pageId',v_page.id,'elementId',v_element_id,'revision',v_new_revision,
      'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  if v_action='upsert_element' then
    v_element:=p_payload->'element';
    if v_element is null or jsonb_typeof(v_element)<>'object'
       or octet_length(v_element::text)>150000 then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;
    v_element_id:=trim(coalesce(v_element->>'id',''));
    v_type:=lower(trim(coalesce(v_element->>'type','')));
    v_points:=coalesce(v_element->'points','[]'::jsonb);
    v_color:=lower(trim(coalesce(v_element->>'color','#111827')));
    v_text:=coalesce(v_element->>'text','');
    v_asset_path:=nullif(trim(coalesce(v_element->>'assetPath','')),'');
    begin
      v_width:=coalesce((v_element->>'width')::numeric,4);
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end;
    if v_element_id='' or char_length(v_element_id)>80 then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;
    if v_type not in(
      'pen','marker','line','arrow','rectangle','circle','text','sticky','image'
    ) then return jsonb_build_object('ok',false,'reason','invalid_element'); end if;
    if jsonb_typeof(v_points)<>'array'
       or jsonb_array_length(v_points)>2000
       or exists(
         select 1 from jsonb_array_elements(v_points) pt
         where jsonb_typeof(pt)<>'object'
           or jsonb_typeof(pt->'x')<>'number'
           or jsonb_typeof(pt->'y')<>'number'
           or abs((pt->>'x')::numeric)>1000000
           or abs((pt->>'y')::numeric)>1000000
       ) then return jsonb_build_object('ok',false,'reason','invalid_element'); end if;
    if (
      v_type in('pen','marker') and jsonb_array_length(v_points)<1
    ) or (
      v_type in('line','arrow','rectangle','circle','sticky','image')
      and jsonb_array_length(v_points)<>2
    ) or (
      v_type='text' and jsonb_array_length(v_points)<>1
    ) then return jsonb_build_object('ok',false,'reason','invalid_element'); end if;
    if v_color!~'^#[0-9a-f]{6}$' or v_width<1 or v_width>40 or char_length(v_text)>1000 then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;
    if v_type='image' then
      if v_asset_path is null or char_length(v_asset_path)>600
         or v_asset_path not like p_room_id::text||'/'||v_page.id::text||'/%' then
        return jsonb_build_object('ok',false,'reason','invalid_asset');
      end if;
    else
      v_asset_path:=null;
    end if;
    v_sanitized:=jsonb_strip_nulls(jsonb_build_object(
      'id',v_element_id,'type',v_type,'points',v_points,'color',v_color,
      'width',v_width,
      'text',case when v_type in('text','sticky') then v_text else null end,
      'assetPath',v_asset_path,'createdBy',p_actor_user_id,'updatedAt',v_now
    ));
    if exists(
      select 1 from jsonb_array_elements(v_elements) e where e->>'id'=v_element_id
    ) then
      select jsonb_agg(
        case when e->>'id'=v_element_id then v_sanitized else e end order by ordinality
      )
      into v_elements
      from jsonb_array_elements(v_elements) with ordinality a(e,ordinality);
    else
      if jsonb_array_length(v_elements)>=1000 then
        return jsonb_build_object('ok',false,'reason','element_limit_reached');
      end if;
      v_elements:=v_elements||jsonb_build_array(v_sanitized);
    end if;
    if octet_length(v_elements::text)>4000000 then
      return jsonb_build_object('ok',false,'reason','snapshot_too_large');
    end if;
    update public.conference_whiteboard_pages
    set snapshot_data=jsonb_build_object('elements',v_elements),
        revision=revision+1,updated_at=v_now
    where id=v_page.id returning revision into v_new_revision;
    if v_new_revision%10=0 then
      insert into public.conference_whiteboard_snapshots(
        room_id,page_id,revision,snapshot_data,created_by,created_at
      )
      select p_room_id,v_page.id,v_new_revision,p.snapshot_data,p_actor_user_id,v_now
      from public.conference_whiteboard_pages p where p.id=v_page.id
      on conflict(page_id,revision) do nothing;
    end if;
    v_operation:=jsonb_build_object(
      'id',gen_random_uuid(),'action','upsert_element','roomId',p_room_id,
      'pageId',v_page.id,'element',v_sanitized,'revision',v_new_revision,
      'actorUserId',p_actor_user_id,'timestamp',v_now
    );
    return jsonb_build_object('ok',true,'operation',v_operation,'livekit_room_name',v_livekit_room_name);
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.apply_conference_whiteboard_action_v2(
  p_room_id uuid,p_actor_user_id uuid,p_action text,
  p_page_id uuid default null,p_payload jsonb default '{}'::jsonb
)
returns jsonb
language sql security invoker set search_path=''
as $$
  select private.apply_conference_whiteboard_action_v2(
    p_room_id,p_actor_user_id,p_action,p_page_id,p_payload
  )
$$;

revoke execute on function private.apply_conference_whiteboard_action_v2(
  uuid,uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function private.apply_conference_whiteboard_action_v2(
  uuid,uuid,text,uuid,jsonb
) to service_role;

revoke execute on function public.apply_conference_whiteboard_action_v2(
  uuid,uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.apply_conference_whiteboard_action_v2(
  uuid,uuid,text,uuid,jsonb
) to service_role;

notify pgrst,'reload schema';
