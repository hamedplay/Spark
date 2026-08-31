
create or replace function private.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path=''
as $$
begin
  if p_value is null or trim(p_value)='' then
    return null;
  end if;
  return p_value::uuid;
exception
  when invalid_text_representation then
    return null;
end;
$$;

revoke execute on function private.try_uuid(text)
from public,anon;
grant execute on function private.try_uuid(text)
to authenticated,service_role;

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
    where p.id=private.try_uuid(
      private.presentation_asset_path_parts(p_name)->>'presentation_id'
    )
      and p.room_id=private.try_uuid(
        private.presentation_asset_path_parts(p_name)->>'room_id'
      )
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
    where p.id=private.try_uuid(
      private.presentation_asset_path_parts(p_name)->>'presentation_id'
    )
      and p.room_id=private.try_uuid(
        private.presentation_asset_path_parts(p_name)->>'room_id'
      )
      and p.created_by=p_user_id
      and p.status='UPLOADING'
      and private.can_read_conference_presentation(p.room_id,p_user_id)
      and private.has_conference_permission(
        p.room_id,'SHARE_FILE',p_user_id
      )
      and (
        private.presentation_asset_path_parts(p_name)->>'user_id'
      )=p_user_id::text
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
    where p.id=private.try_uuid(
      private.presentation_asset_path_parts(p_name)->>'presentation_id'
    )
      and p.room_id=private.try_uuid(
        private.presentation_asset_path_parts(p_name)->>'room_id'
      )
      and (
        p.created_by=p_user_id
        or private.can_manage_conference_presentations(
          p.room_id,p_user_id
        )
      )
  )
$$;

notify pgrst,'reload schema';
