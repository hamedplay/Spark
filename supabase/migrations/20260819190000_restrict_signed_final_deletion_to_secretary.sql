create or replace function private.delete_minutes_attachment(p_attachment_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_minute_id uuid;
  v_filename text;
  v_attachment_kind text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select minute_id, original_filename, attachment_kind::text
    into v_minute_id, v_filename, v_attachment_kind
  from public.minutes_attachments
  where id = p_attachment_id
    and deleted_at is null;

  if v_minute_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_attachment_kind = 'signed_final' then
    if not exists (
      select 1
      from public.minutes m
      where m.id = v_minute_id
        and m.secretary_user_id = auth.uid()
    ) then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
  elsif not public._user_can_manage_minute_content(v_minute_id) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  update public.minutes_attachments
  set deleted_at = now()
  where id = p_attachment_id;

  perform public._write_minutes_audit(
    v_minute_id, 'attachment_deleted', 'attachment', p_attachment_id,
    null, jsonb_build_object('filename', v_filename), null, null
  );
end;
$function$;

drop policy if exists minutes_attachments_delete on storage.objects;

create policy minutes_attachments_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'minutes-attachments'
  and exists (
    select 1
    from public.minutes_attachments a
    join public.minutes m on m.id = a.minute_id
    where a.storage_path = storage.objects.name
      and a.deleted_at is null
      and (
        (a.attachment_kind = 'signed_final' and m.secretary_user_id = auth.uid())
        or
        (a.attachment_kind is distinct from 'signed_final' and public._user_can_manage_minute_content(a.minute_id))
      )
  )
);
