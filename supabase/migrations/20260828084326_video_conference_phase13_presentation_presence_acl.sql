
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
  v_annotators jsonb;
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

  select coalesce(jsonb_agg(cp.user_id order by cp.user_id),'[]'::jsonb)
  into v_annotators
  from public.conference_participants cp
  where cp.room_id=p_room_id
    and cp.status='joined'
    and private.has_conference_permission(
      p_room_id,'USE_WHITEBOARD',cp.user_id
    );

  return jsonb_build_object(
    'ok',true,
    'serverTime',clock_timestamp(),
    'canUpload',private.has_conference_permission(p_room_id,'SHARE_FILE',p_user_id),
    'canManage',private.can_manage_conference_presentations(p_room_id,p_user_id),
    'canAnnotate',private.can_annotate_conference_presentation(p_room_id,p_user_id),
    'annotatorUserIds',v_annotators,
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

notify pgrst,'reload schema';
