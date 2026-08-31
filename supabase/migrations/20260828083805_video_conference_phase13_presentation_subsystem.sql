
insert into private.conference_permissions(permission)
values('MANAGE_PRESENTATIONS')
on conflict(permission) do nothing;

insert into private.conference_role_permissions(role,permission)
values
  ('OWNER','MANAGE_PRESENTATIONS'),
  ('HOST','MANAGE_PRESENTATIONS'),
  ('CO_HOST','MANAGE_PRESENTATIONS'),
  ('MODERATOR','MANAGE_PRESENTATIONS'),
  ('PRESENTER','MANAGE_PRESENTATIONS')
on conflict(role,permission) do nothing;

create table if not exists public.conference_presentations (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  created_by uuid not null,
  title text not null,
  original_file_name text not null,
  source_kind text not null,
  source_mime_type text not null,
  source_path text not null unique,
  rendered_path text,
  rendered_mime_type text,
  status text not null default 'UPLOADING',
  file_size_bytes bigint not null,
  page_count integer,
  conversion_error text,
  revision bigint not null default 1,
  created_at timestamptz not null default now(),
  conversion_started_at timestamptz,
  conversion_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint conference_presentations_title_check
    check(char_length(trim(title)) between 1 and 240),
  constraint conference_presentations_file_name_check
    check(char_length(trim(original_file_name)) between 1 and 255),
  constraint conference_presentations_source_kind_check
    check(source_kind in('PDF','IMAGE','SLIDES','DOCUMENT')),
  constraint conference_presentations_status_check
    check(status in('UPLOADING','CONVERTING','READY','FAILED','DELETED')),
  constraint conference_presentations_file_size_check
    check(file_size_bytes between 1 and 52428800),
  constraint conference_presentations_page_count_check
    check(page_count is null or page_count between 1 and 1000)
);

create index if not exists conference_presentations_room_created_idx
  on public.conference_presentations(room_id,created_at desc)
  where status<>'DELETED';

create table if not exists public.conference_presentation_state (
  room_id uuid primary key references public.conference_rooms(id) on delete cascade,
  presentation_id uuid references public.conference_presentations(id) on delete set null,
  presenter_user_id uuid,
  current_page integer not null default 1,
  is_active boolean not null default false,
  revision bigint not null default 1,
  activated_at timestamptz,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint conference_presentation_state_page_check
    check(current_page between 1 and 1000)
);

create index if not exists conference_presentation_state_presentation_idx
  on public.conference_presentation_state(presentation_id)
  where presentation_id is not null;

create table if not exists public.conference_presentation_annotations (
  presentation_id uuid not null references public.conference_presentations(id) on delete cascade,
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  page_number integer not null,
  snapshot_data jsonb not null default '{"elements":[]}'::jsonb,
  revision bigint not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(presentation_id,page_number),
  constraint conference_presentation_annotations_page_check
    check(page_number between 1 and 1000)
);

create index if not exists conference_presentation_annotations_room_idx
  on public.conference_presentation_annotations(room_id,presentation_id,page_number);

insert into storage.buckets(
  id,name,public,file_size_limit,allowed_mime_types
)
values(
  'conference-presentations',
  'conference-presentations',
  false,
  52428800,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-powerpoint',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.oasis.opendocument.text'
  ]::text[]
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

alter table public.conference_presentations enable row level security;
alter table public.conference_presentation_state enable row level security;
alter table public.conference_presentation_annotations enable row level security;

revoke all on table public.conference_presentations from public,anon,authenticated;
revoke all on table public.conference_presentation_state from public,anon,authenticated;
revoke all on table public.conference_presentation_annotations from public,anon,authenticated;

grant select on table public.conference_presentations to authenticated,service_role;
grant select on table public.conference_presentation_state to authenticated,service_role;
grant select on table public.conference_presentation_annotations to authenticated,service_role;
grant insert,update,delete on table public.conference_presentations to service_role;
grant insert,update,delete on table public.conference_presentation_state to service_role;
grant insert,update,delete on table public.conference_presentation_annotations to service_role;

create or replace function private.can_read_conference_presentation(
  p_room_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select p_user_id is not null
    and exists(
      select 1
      from public.conference_participants p
      where p.room_id=p_room_id
        and p.user_id=p_user_id
        and p.status='joined'
    )
$$;

revoke execute on function private.can_read_conference_presentation(uuid,uuid)
from public,anon;
grant execute on function private.can_read_conference_presentation(uuid,uuid)
to authenticated,service_role;

create or replace function private.can_manage_conference_presentations(
  p_room_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.can_read_conference_presentation(p_room_id,p_user_id)
    and private.has_conference_permission(
      p_room_id,'MANAGE_PRESENTATIONS',p_user_id
    )
$$;

revoke execute on function private.can_manage_conference_presentations(uuid,uuid)
from public,anon;
grant execute on function private.can_manage_conference_presentations(uuid,uuid)
to authenticated,service_role;

create or replace function private.can_annotate_conference_presentation(
  p_room_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select private.can_read_conference_presentation(p_room_id,p_user_id)
    and private.has_conference_permission(
      p_room_id,'USE_WHITEBOARD',p_user_id
    )
$$;

revoke execute on function private.can_annotate_conference_presentation(uuid,uuid)
from public,anon;
grant execute on function private.can_annotate_conference_presentation(uuid,uuid)
to authenticated,service_role;

create or replace function private.presentation_asset_path_parts(p_name text)
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_build_object(
    'room_id',split_part(p_name,'/',1),
    'presentation_id',split_part(p_name,'/',2),
    'user_id',split_part(p_name,'/',3),
    'file_name',split_part(p_name,'/',4)
  )
$$;

create or replace function private.can_read_conference_presentation_asset(
  p_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.conference_presentations p
    where p.id=(nullif(private.presentation_asset_path_parts(p_name)->>'presentation_id',''))::uuid
      and p.room_id=(nullif(private.presentation_asset_path_parts(p_name)->>'room_id',''))::uuid
      and p.status<>'DELETED'
      and private.can_read_conference_presentation(p.room_id,p_user_id)
  )
$$;

create or replace function private.can_write_conference_presentation_asset(
  p_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.conference_presentations p
    where p.id=(nullif(private.presentation_asset_path_parts(p_name)->>'presentation_id',''))::uuid
      and p.room_id=(nullif(private.presentation_asset_path_parts(p_name)->>'room_id',''))::uuid
      and p.created_by=p_user_id
      and p.status='UPLOADING'
      and private.can_read_conference_presentation(p.room_id,p_user_id)
      and private.has_conference_permission(p.room_id,'SHARE_FILE',p_user_id)
      and (private.presentation_asset_path_parts(p_name)->>'user_id')=p_user_id::text
  )
$$;

create or replace function private.can_delete_conference_presentation_asset(
  p_name text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.conference_presentations p
    where p.id=(nullif(private.presentation_asset_path_parts(p_name)->>'presentation_id',''))::uuid
      and p.room_id=(nullif(private.presentation_asset_path_parts(p_name)->>'room_id',''))::uuid
      and (
        p.created_by=p_user_id
        or private.can_manage_conference_presentations(p.room_id,p_user_id)
      )
  )
$$;

revoke execute on function private.presentation_asset_path_parts(text) from public,anon;
revoke execute on function private.can_read_conference_presentation_asset(text,uuid) from public,anon;
revoke execute on function private.can_write_conference_presentation_asset(text,uuid) from public,anon;
revoke execute on function private.can_delete_conference_presentation_asset(text,uuid) from public,anon;
grant execute on function private.presentation_asset_path_parts(text) to authenticated,service_role;
grant execute on function private.can_read_conference_presentation_asset(text,uuid) to authenticated,service_role;
grant execute on function private.can_write_conference_presentation_asset(text,uuid) to authenticated,service_role;
grant execute on function private.can_delete_conference_presentation_asset(text,uuid) to authenticated,service_role;

drop policy if exists "Conference presentation assets read" on storage.objects;
drop policy if exists "Conference presentation assets read boundary" on storage.objects;
drop policy if exists "Conference presentation assets insert" on storage.objects;
drop policy if exists "Conference presentation assets insert boundary" on storage.objects;
drop policy if exists "Conference presentation assets delete" on storage.objects;
drop policy if exists "Conference presentation assets delete boundary" on storage.objects;

create policy "Conference presentation assets read"
on storage.objects
for select
to authenticated
using (
  bucket_id='conference-presentations'
  and private.can_read_conference_presentation_asset(name,(select auth.uid()))
);

create policy "Conference presentation assets read boundary"
on storage.objects
as restrictive
for select
to authenticated
using (
  bucket_id<>'conference-presentations'
  or (
    (select private.is_current_session_fully_authorized())
    and private.can_read_conference_presentation_asset(name,(select auth.uid()))
  )
);

create policy "Conference presentation assets insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id='conference-presentations'
  and private.can_write_conference_presentation_asset(name,(select auth.uid()))
);

create policy "Conference presentation assets insert boundary"
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id<>'conference-presentations'
  or (
    (select private.is_current_session_fully_authorized())
    and private.can_write_conference_presentation_asset(name,(select auth.uid()))
  )
);

create policy "Conference presentation assets delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id='conference-presentations'
  and private.can_delete_conference_presentation_asset(name,(select auth.uid()))
);

create policy "Conference presentation assets delete boundary"
on storage.objects
as restrictive
for delete
to authenticated
using (
  bucket_id<>'conference-presentations'
  or (
    (select private.is_current_session_fully_authorized())
    and private.can_delete_conference_presentation_asset(name,(select auth.uid()))
  )
);

do $$
declare v record;
begin
  for v in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename in(
        'conference_presentations',
        'conference_presentation_state',
        'conference_presentation_annotations'
      )
  loop
    execute format('drop policy if exists %I on %I.%I',v.policyname,v.schemaname,v.tablename);
  end loop;
end
$$;

create policy "conference_presentations_joined_select"
on public.conference_presentations
for select
to authenticated
using (
  private.can_read_conference_presentation(
    conference_presentations.room_id,(select auth.uid())
  )
);

create policy "conference_presentations_full_auth_boundary"
on public.conference_presentations
as restrictive
for select
to authenticated
using ((select private.is_current_session_fully_authorized()));

create policy "conference_presentation_state_joined_select"
on public.conference_presentation_state
for select
to authenticated
using (
  private.can_read_conference_presentation(
    conference_presentation_state.room_id,(select auth.uid())
  )
);

create policy "conference_presentation_state_full_auth_boundary"
on public.conference_presentation_state
as restrictive
for select
to authenticated
using ((select private.is_current_session_fully_authorized()));

create policy "conference_presentation_annotations_joined_select"
on public.conference_presentation_annotations
for select
to authenticated
using (
  private.can_read_conference_presentation(
    conference_presentation_annotations.room_id,(select auth.uid())
  )
);

create policy "conference_presentation_annotations_full_auth_boundary"
on public.conference_presentation_annotations
as restrictive
for select
to authenticated
using ((select private.is_current_session_fully_authorized()));

create or replace function private.get_conference_presentation_snapshot(
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
  v_state public.conference_presentation_state%rowtype;
  v_presentations jsonb;
begin
  if not private.can_read_conference_presentation(p_room_id,p_user_id) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  select * into v_state
  from public.conference_presentation_state s
  where s.room_id=p_room_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,
      'roomId',p.room_id,
      'createdBy',p.created_by,
      'title',p.title,
      'originalFileName',p.original_file_name,
      'sourceKind',p.source_kind,
      'sourceMimeType',p.source_mime_type,
      'sourcePath',p.source_path,
      'renderedPath',p.rendered_path,
      'renderedMimeType',p.rendered_mime_type,
      'status',p.status,
      'fileSizeBytes',p.file_size_bytes,
      'pageCount',p.page_count,
      'conversionError',p.conversion_error,
      'revision',p.revision,
      'createdAt',p.created_at,
      'updatedAt',p.updated_at,
      'canDelete',
        p.created_by=p_user_id
        or private.can_manage_conference_presentations(p.room_id,p_user_id)
    )
    order by p.created_at desc
  ),'[]'::jsonb)
  into v_presentations
  from public.conference_presentations p
  where p.room_id=p_room_id
    and p.status<>'DELETED';

  return jsonb_build_object(
    'ok',true,
    'serverTime',clock_timestamp(),
    'canUpload',private.has_conference_permission(p_room_id,'SHARE_FILE',p_user_id),
    'canManage',private.can_manage_conference_presentations(p_room_id,p_user_id),
    'canAnnotate',private.can_annotate_conference_presentation(p_room_id,p_user_id),
    'state',jsonb_build_object(
      'presentationId',v_state.presentation_id,
      'presenterUserId',v_state.presenter_user_id,
      'currentPage',coalesce(v_state.current_page,1),
      'isActive',coalesce(v_state.is_active,false),
      'revision',coalesce(v_state.revision,0),
      'activatedAt',v_state.activated_at,
      'updatedAt',v_state.updated_at
    ),
    'presentations',v_presentations
  );
end;
$$;

create or replace function public.get_conference_presentation_snapshot(p_room_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;
  return private.get_conference_presentation_snapshot(p_room_id,auth.uid());
end;
$$;

revoke execute on function public.get_conference_presentation_snapshot(uuid)
from public,anon;
grant execute on function public.get_conference_presentation_snapshot(uuid)
to authenticated,service_role;

create or replace function private.get_conference_presentation_annotation_snapshot(
  p_room_id uuid,
  p_presentation_id uuid,
  p_page_number integer,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_annotation public.conference_presentation_annotations%rowtype;
begin
  if p_page_number<1 or p_page_number>1000 then
    return jsonb_build_object('ok',false,'reason','invalid_page');
  end if;
  if not private.can_read_conference_presentation(p_room_id,p_user_id) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;
  if not exists(
    select 1 from public.conference_presentations p
    where p.id=p_presentation_id
      and p.room_id=p_room_id
      and p.status='READY'
  ) then
    return jsonb_build_object('ok',false,'reason','presentation_not_ready');
  end if;

  select * into v_annotation
  from public.conference_presentation_annotations a
  where a.presentation_id=p_presentation_id
    and a.page_number=p_page_number;

  return jsonb_build_object(
    'ok',true,
    'canAnnotate',private.can_annotate_conference_presentation(p_room_id,p_user_id),
    'revision',coalesce(v_annotation.revision,0),
    'snapshot',coalesce(v_annotation.snapshot_data,'{"elements":[]}'::jsonb),
    'updatedAt',v_annotation.updated_at
  );
end;
$$;

create or replace function public.get_conference_presentation_annotation_snapshot(
  p_room_id uuid,
  p_presentation_id uuid,
  p_page_number integer
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;
  return private.get_conference_presentation_annotation_snapshot(
    p_room_id,p_presentation_id,p_page_number,auth.uid()
  );
end;
$$;

revoke execute on function public.get_conference_presentation_annotation_snapshot(
  uuid,uuid,integer
) from public,anon;
grant execute on function public.get_conference_presentation_annotation_snapshot(
  uuid,uuid,integer
) to authenticated,service_role;

create or replace function private.conference_presentation_action_allowed(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_presentation_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_room_status text;
  v_owner uuid;
begin
  if p_actor_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  select r.status into v_room_status
  from public.conference_rooms r
  where r.id=p_room_id;

  if not found then
    return jsonb_build_object('ok',false,'reason','room_not_found');
  end if;

  if v_room_status='ended' then
    return jsonb_build_object('ok',false,'reason','room_ended');
  end if;

  if not private.can_read_conference_presentation(p_room_id,p_actor_user_id) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  if v_action='create' then
    return jsonb_build_object(
      'ok',private.has_conference_permission(p_room_id,'SHARE_FILE',p_actor_user_id),
      'reason',case when private.has_conference_permission(
        p_room_id,'SHARE_FILE',p_actor_user_id
      ) then null else 'forbidden' end
    );
  end if;

  if p_presentation_id is null then
    return jsonb_build_object('ok',false,'reason','presentation_required');
  end if;

  select p.created_by into v_owner
  from public.conference_presentations p
  where p.id=p_presentation_id
    and p.room_id=p_room_id
    and p.status<>'DELETED';

  if not found then
    return jsonb_build_object('ok',false,'reason','presentation_not_found');
  end if;

  if v_action in('finalize','delete','retry_conversion') then
    if v_owner=p_actor_user_id
       or private.can_manage_conference_presentations(p_room_id,p_actor_user_id) then
      return jsonb_build_object('ok',true);
    end if;
    return jsonb_build_object('ok',false,'reason','forbidden');
  end if;

  if v_action in('activate','deactivate','navigate') then
    return jsonb_build_object(
      'ok',private.can_manage_conference_presentations(p_room_id,p_actor_user_id),
      'reason',case when private.can_manage_conference_presentations(
        p_room_id,p_actor_user_id
      ) then null else 'forbidden' end
    );
  end if;

  if v_action in('annotation_upsert','annotation_delete','annotation_clear') then
    return jsonb_build_object(
      'ok',private.can_annotate_conference_presentation(p_room_id,p_actor_user_id),
      'reason',case when private.can_annotate_conference_presentation(
        p_room_id,p_actor_user_id
      ) then null else 'forbidden' end
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.authorize_conference_presentation_action(
  p_room_id uuid,
  p_action text,
  p_presentation_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path=''
as $$
begin
  if auth.uid() is null
     or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;
  if not private.is_current_session_fully_authorized() then
    return jsonb_build_object('ok',false,'reason','not_authorized');
  end if;
  return private.conference_presentation_action_allowed(
    p_room_id,auth.uid(),p_action,p_presentation_id
  );
end;
$$;

revoke execute on function public.authorize_conference_presentation_action(
  uuid,text,uuid
) from public,anon;
grant execute on function public.authorize_conference_presentation_action(
  uuid,text,uuid
) to authenticated,service_role;

create or replace function private.apply_conference_presentation_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_presentation_id uuid default null,
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
  v_now timestamptz:=clock_timestamp();
  v_id uuid;
  v_title text;
  v_name text;
  v_mime text;
  v_kind text;
  v_ext text;
  v_size bigint;
  v_path text;
  v_p public.conference_presentations%rowtype;
  v_page integer;
  v_state public.conference_presentation_state%rowtype;
  v_elements jsonb;
  v_element jsonb;
  v_element_id text;
  v_type text;
  v_points jsonb;
  v_color text;
  v_width numeric;
  v_text text;
  v_sanitized jsonb;
  v_revision bigint;
begin
  if v_action in('conversion_ready','conversion_failed') then
    if p_presentation_id is null then
      return jsonb_build_object('ok',false,'reason','presentation_required');
    end if;

    select * into v_p
    from public.conference_presentations p
    where p.id=p_presentation_id
      and p.room_id=p_room_id
      and p.status in('CONVERTING','FAILED')
    for update;

    if not found then
      return jsonb_build_object('ok',false,'reason','presentation_not_convertible');
    end if;

    if not (
      v_p.created_by=p_actor_user_id
      or private.can_manage_conference_presentations(p_room_id,p_actor_user_id)
    ) then
      return jsonb_build_object('ok',false,'reason','forbidden');
    end if;

    if v_action='conversion_ready' then
      v_path:=trim(coalesce(p_payload->>'renderedPath',''));
      if v_path='' or v_path not like p_room_id::text||'/'||p_presentation_id::text||'/%' then
        return jsonb_build_object('ok',false,'reason','invalid_rendered_path');
      end if;

      update public.conference_presentations
      set rendered_path=v_path,
          rendered_mime_type='application/pdf',
          status='READY',
          conversion_error=null,
          conversion_completed_at=v_now,
          revision=revision+1,
          updated_at=v_now
      where id=p_presentation_id
      returning * into v_p;

      return jsonb_build_object('ok',true,'presentation_id',v_p.id,'status',v_p.status);
    end if;

    update public.conference_presentations
    set status='FAILED',
        conversion_error=left(trim(coalesce(p_payload->>'error','conversion_failed')),1000),
        revision=revision+1,
        updated_at=v_now
    where id=p_presentation_id
    returning * into v_p;

    return jsonb_build_object('ok',true,'presentation_id',v_p.id,'status',v_p.status);
  end if;

  v_allowed:=private.conference_presentation_action_allowed(
    p_room_id,p_actor_user_id,v_action,p_presentation_id
  );
  if coalesce((v_allowed->>'ok')::boolean,false) is not true then
    return v_allowed;
  end if;

  if v_action='create' then
    v_title:=left(trim(coalesce(p_payload->>'title','')),240);
    v_name:=left(trim(coalesce(p_payload->>'originalFileName','')),255);
    v_mime:=lower(trim(coalesce(p_payload->>'sourceMimeType','')));
    begin
      v_size:=(p_payload->>'fileSizeBytes')::bigint;
    exception when others then
      return jsonb_build_object('ok',false,'reason','invalid_file_size');
    end;

    if v_title='' or v_name='' or v_size<1 or v_size>52428800 then
      return jsonb_build_object('ok',false,'reason','invalid_file');
    end if;

    if v_mime='application/pdf' then v_kind:='PDF'; v_ext:='pdf';
    elsif v_mime='image/jpeg' then v_kind:='IMAGE'; v_ext:='jpg';
    elsif v_mime='image/png' then v_kind:='IMAGE'; v_ext:='png';
    elsif v_mime='image/webp' then v_kind:='IMAGE'; v_ext:='webp';
    elsif v_mime='image/gif' then v_kind:='IMAGE'; v_ext:='gif';
    elsif v_mime='application/vnd.openxmlformats-officedocument.presentationml.presentation' then v_kind:='SLIDES'; v_ext:='pptx';
    elsif v_mime='application/vnd.ms-powerpoint' then v_kind:='SLIDES'; v_ext:='ppt';
    elsif v_mime='application/vnd.oasis.opendocument.presentation' then v_kind:='SLIDES'; v_ext:='odp';
    elsif v_mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' then v_kind:='DOCUMENT'; v_ext:='docx';
    elsif v_mime='application/msword' then v_kind:='DOCUMENT'; v_ext:='doc';
    elsif v_mime='application/vnd.oasis.opendocument.text' then v_kind:='DOCUMENT'; v_ext:='odt';
    else
      return jsonb_build_object('ok',false,'reason','unsupported_file_type');
    end if;

    v_id:=gen_random_uuid();
    v_path:=p_room_id::text||'/'||v_id::text||'/'||p_actor_user_id::text||'/source.'||v_ext;

    insert into public.conference_presentations(
      id,room_id,created_by,title,original_file_name,
      source_kind,source_mime_type,source_path,status,
      file_size_bytes,revision,created_at,updated_at
    )
    values(
      v_id,p_room_id,p_actor_user_id,v_title,v_name,
      v_kind,v_mime,v_path,'UPLOADING',
      v_size,1,v_now,v_now
    );

    return jsonb_build_object(
      'ok',true,
      'presentation_id',v_id,
      'source_path',v_path,
      'source_kind',v_kind
    );
  end if;

  select * into v_p
  from public.conference_presentations p
  where p.id=p_presentation_id
    and p.room_id=p_room_id
    and p.status<>'DELETED'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','presentation_not_found');
  end if;

  if v_action in('finalize','retry_conversion') then
    if v_p.source_kind in('PDF','IMAGE') then
      update public.conference_presentations
      set rendered_path=source_path,
          rendered_mime_type=source_mime_type,
          status='READY',
          page_count=case when source_kind='IMAGE' then 1 else page_count end,
          conversion_error=null,
          conversion_completed_at=v_now,
          revision=revision+1,
          updated_at=v_now
      where id=v_p.id
      returning * into v_p;

      return jsonb_build_object(
        'ok',true,
        'presentation_id',v_p.id,
        'status','READY',
        'needs_conversion',false
      );
    end if;

    update public.conference_presentations
    set status='CONVERTING',
        conversion_started_at=v_now,
        conversion_error=null,
        revision=revision+1,
        updated_at=v_now
    where id=v_p.id
    returning * into v_p;

    return jsonb_build_object(
      'ok',true,
      'presentation_id',v_p.id,
      'status','CONVERTING',
      'needs_conversion',true,
      'source_path',v_p.source_path,
      'source_mime_type',v_p.source_mime_type
    );
  end if;

  if v_action='activate' then
    if v_p.status<>'READY' then
      return jsonb_build_object('ok',false,'reason','presentation_not_ready');
    end if;

    insert into public.conference_presentation_state(
      room_id,presentation_id,presenter_user_id,current_page,
      is_active,revision,activated_at,updated_by,updated_at
    )
    values(
      p_room_id,v_p.id,p_actor_user_id,1,
      true,1,v_now,p_actor_user_id,v_now
    )
    on conflict(room_id) do update
    set presentation_id=excluded.presentation_id,
        presenter_user_id=excluded.presenter_user_id,
        current_page=1,
        is_active=true,
        revision=public.conference_presentation_state.revision+1,
        activated_at=v_now,
        updated_by=p_actor_user_id,
        updated_at=v_now;

    return jsonb_build_object('ok',true,'presentation_id',v_p.id);
  end if;

  if v_action='deactivate' then
    update public.conference_presentation_state
    set is_active=false,
        presentation_id=null,
        presenter_user_id=null,
        current_page=1,
        revision=revision+1,
        updated_by=p_actor_user_id,
        updated_at=v_now
    where room_id=p_room_id;

    return jsonb_build_object('ok',true);
  end if;

  if v_action='navigate' then
    begin
      v_page:=(p_payload->>'page')::integer;
    exception when others then
      return jsonb_build_object('ok',false,'reason','invalid_page');
    end;
    if v_page<1 or v_page>1000 then
      return jsonb_build_object('ok',false,'reason','invalid_page');
    end if;

    select * into v_state
    from public.conference_presentation_state s
    where s.room_id=p_room_id and s.is_active
    for update;

    if not found or v_state.presentation_id<>v_p.id then
      return jsonb_build_object('ok',false,'reason','presentation_not_active');
    end if;
    if v_p.page_count is not null and v_page>v_p.page_count then
      return jsonb_build_object('ok',false,'reason','page_out_of_range');
    end if;

    update public.conference_presentation_state
    set current_page=v_page,
        revision=revision+1,
        updated_by=p_actor_user_id,
        updated_at=v_now
    where room_id=p_room_id;

    return jsonb_build_object('ok',true,'page',v_page);
  end if;

  if v_action='delete' then
    update public.conference_presentation_state
    set is_active=false,
        presentation_id=null,
        presenter_user_id=null,
        current_page=1,
        revision=revision+1,
        updated_by=p_actor_user_id,
        updated_at=v_now
    where room_id=p_room_id and presentation_id=v_p.id;

    update public.conference_presentations
    set status='DELETED',
        revision=revision+1,
        updated_at=v_now
    where id=v_p.id;

    return jsonb_build_object(
      'ok',true,
      'source_path',v_p.source_path,
      'rendered_path',v_p.rendered_path
    );
  end if;

  begin
    v_page:=(p_payload->>'page')::integer;
  exception when others then
    return jsonb_build_object('ok',false,'reason','invalid_page');
  end;
  if v_page<1 or v_page>1000 then
    return jsonb_build_object('ok',false,'reason','invalid_page');
  end if;
  if v_p.status<>'READY' then
    return jsonb_build_object('ok',false,'reason','presentation_not_ready');
  end if;

  insert into public.conference_presentation_annotations(
    presentation_id,room_id,page_number,snapshot_data,
    revision,updated_by,created_at,updated_at
  )
  values(
    v_p.id,p_room_id,v_page,'{"elements":[]}'::jsonb,
    1,p_actor_user_id,v_now,v_now
  )
  on conflict(presentation_id,page_number) do nothing;

  select snapshot_data->'elements',revision
  into v_elements,v_revision
  from public.conference_presentation_annotations a
  where a.presentation_id=v_p.id and a.page_number=v_page
  for update;

  v_elements:=coalesce(v_elements,'[]'::jsonb);

  if v_action='annotation_clear' then
    update public.conference_presentation_annotations
    set snapshot_data='{"elements":[]}'::jsonb,
        revision=revision+1,
        updated_by=p_actor_user_id,
        updated_at=v_now
    where presentation_id=v_p.id and page_number=v_page
    returning revision into v_revision;
    return jsonb_build_object('ok',true,'revision',v_revision);
  end if;

  if v_action='annotation_delete' then
    v_element_id:=trim(coalesce(p_payload->>'elementId',''));
    if v_element_id='' then
      return jsonb_build_object('ok',false,'reason','element_required');
    end if;

    select coalesce(jsonb_agg(e order by ordinality),'[]'::jsonb)
    into v_elements
    from jsonb_array_elements(v_elements) with ordinality a(e,ordinality)
    where e->>'id'<>v_element_id;

    update public.conference_presentation_annotations
    set snapshot_data=jsonb_build_object('elements',v_elements),
        revision=revision+1,
        updated_by=p_actor_user_id,
        updated_at=v_now
    where presentation_id=v_p.id and page_number=v_page
    returning revision into v_revision;

    return jsonb_build_object('ok',true,'revision',v_revision);
  end if;

  if v_action='annotation_upsert' then
    v_element:=p_payload->'element';

    if v_element is null
       or jsonb_typeof(v_element)<>'object'
       or octet_length(v_element::text)>120000 then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;

    v_element_id:=trim(coalesce(v_element->>'id',''));
    v_type:=lower(trim(coalesce(v_element->>'type','')));
    v_points:=coalesce(v_element->'points','[]'::jsonb);
    v_color:=lower(trim(coalesce(v_element->>'color','#ef4444')));
    v_text:=coalesce(v_element->>'text','');

    begin
      v_width:=coalesce((v_element->>'width')::numeric,4);
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end;

    if v_element_id='' or char_length(v_element_id)>80
       or v_type not in('pen','marker','line','arrow','rectangle','circle','text','sticky')
       or jsonb_typeof(v_points)<>'array'
       or jsonb_array_length(v_points)>2000
       or v_color!~'^#[0-9a-f]{6}$'
       or v_width<1 or v_width>40
       or char_length(v_text)>1000 then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;

    if exists(
      select 1
      from jsonb_array_elements(v_points) pt
      where jsonb_typeof(pt)<>'object'
        or jsonb_typeof(pt->'x')<>'number'
        or jsonb_typeof(pt->'y')<>'number'
        or abs((pt->>'x')::numeric)>1000000
        or abs((pt->>'y')::numeric)>1000000
    ) then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;

    if (
      v_type in('pen','marker') and jsonb_array_length(v_points)<1
    ) or (
      v_type in('line','arrow','rectangle','circle','sticky')
      and jsonb_array_length(v_points)<>2
    ) or (
      v_type='text' and jsonb_array_length(v_points)<>1
    ) then
      return jsonb_build_object('ok',false,'reason','invalid_element');
    end if;

    v_sanitized:=jsonb_strip_nulls(jsonb_build_object(
      'id',v_element_id,
      'type',v_type,
      'points',v_points,
      'color',v_color,
      'width',v_width,
      'text',case when v_type in('text','sticky') then v_text else null end,
      'createdBy',p_actor_user_id,
      'updatedAt',v_now
    ));

    if exists(
      select 1 from jsonb_array_elements(v_elements) e
      where e->>'id'=v_element_id
    ) then
      select jsonb_agg(
        case when e->>'id'=v_element_id then v_sanitized else e end
        order by ordinality
      )
      into v_elements
      from jsonb_array_elements(v_elements) with ordinality a(e,ordinality);
    else
      if jsonb_array_length(v_elements)>=500 then
        return jsonb_build_object('ok',false,'reason','annotation_limit_reached');
      end if;
      v_elements:=v_elements||jsonb_build_array(v_sanitized);
    end if;

    if octet_length(v_elements::text)>2000000 then
      return jsonb_build_object('ok',false,'reason','annotation_too_large');
    end if;

    update public.conference_presentation_annotations
    set snapshot_data=jsonb_build_object('elements',v_elements),
        revision=revision+1,
        updated_by=p_actor_user_id,
        updated_at=v_now
    where presentation_id=v_p.id and page_number=v_page
    returning revision into v_revision;

    return jsonb_build_object(
      'ok',true,
      'revision',v_revision,
      'element',v_sanitized
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.apply_conference_presentation_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_presentation_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.apply_conference_presentation_action(
    p_room_id,p_actor_user_id,p_action,p_presentation_id,p_payload
  )
$$;

revoke execute on function private.apply_conference_presentation_action(
  uuid,uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function private.apply_conference_presentation_action(
  uuid,uuid,text,uuid,jsonb
) to service_role;

revoke execute on function public.apply_conference_presentation_action(
  uuid,uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.apply_conference_presentation_action(
  uuid,uuid,text,uuid,jsonb
) to service_role;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_presentations'
  ) then
    alter publication supabase_realtime add table public.conference_presentations;
  end if;
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_presentation_state'
  ) then
    alter publication supabase_realtime add table public.conference_presentation_state;
  end if;
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_presentation_annotations'
  ) then
    alter publication supabase_realtime add table public.conference_presentation_annotations;
  end if;
end
$$;

notify pgrst,'reload schema';
