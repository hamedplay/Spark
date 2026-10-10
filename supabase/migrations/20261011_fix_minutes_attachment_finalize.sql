-- Fix runtime failure in private.finalize_minutes_attachment caused by selecting
-- six columns into five variables. upload_status is not used by the function,
-- so keep the existing behavior and select only the five required columns.

create or replace function private.finalize_minutes_attachment(p_attachment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_minute_id uuid;
  v_storage_path text;
  v_expected_size bigint;
  v_expected_mime text;
  v_filename text;
  v_obj_size bigint;
  v_obj_mime text;
  v_obj_metadata jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select minute_id, storage_path, size_bytes, mime_type, original_filename
    into v_minute_id, v_storage_path, v_expected_size, v_expected_mime, v_filename
    from public.minutes_attachments
    where id = p_attachment_id and deleted_at is null;

  if v_minute_id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if not public.is_current_user_admin() then
    perform 1
      from public.minutes_attachments
      where id = p_attachment_id
        and uploaded_by_user_id = auth.uid();
    if not found then
      raise exception 'NOT_AUTHORIZED' using errcode = '42501';
    end if;
  end if;

  begin
    select (metadata->>'size')::bigint, metadata->>'mimetype', metadata
      into v_obj_size, v_obj_mime, v_obj_metadata
      from storage.objects
      where bucket_id = 'minutes-attachments'
        and name = v_storage_path;
  exception when others then
    raise exception 'OBJECT_NOT_FOUND' using errcode = 'P0002';
  end;

  if v_obj_size is null then
    raise exception 'OBJECT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if abs(v_obj_size - v_expected_size) > 1024 then
    raise exception 'SIZE_MISMATCH expected=% actual=%', v_expected_size, v_obj_size
      using errcode = '23514';
  end if;

  update public.minutes_attachments
    set upload_status = 'ready'
    where id = p_attachment_id;

  perform public._write_minutes_audit(
    v_minute_id,
    'attachment_uploaded',
    'attachment',
    p_attachment_id,
    null,
    null,
    jsonb_build_object(
      'filename', v_filename,
      'size', v_obj_size,
      'mime', v_expected_mime
    ),
    null
  );

  return jsonb_build_object('success', true, 'attachment_id', p_attachment_id);
end;
$function$;
