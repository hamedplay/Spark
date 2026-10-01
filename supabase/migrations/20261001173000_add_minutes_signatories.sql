-- Separate meeting participation from minutes-signature responsibility.
-- Existing rows are backfilled as signatories to preserve historical behavior;
-- newly created participant rows default to non-signatory until explicitly selected.

alter table public.minutes_participants
  add column if not exists is_signatory boolean not null default false;

alter table public.minutes_external_participants
  add column if not exists is_signatory boolean not null default false;

update public.minutes_participants
set is_signatory = true
where is_signatory = false;

update public.minutes_external_participants
set is_signatory = true
where is_signatory = false;

create or replace function private.sync_minutes_signatories(
  p_minute_id uuid,
  p_internal_user_ids uuid[] default '{}'::uuid[],
  p_external_participant_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_status text;
  v_approval_mode text;
  v_created_by uuid;
  v_secretary_id uuid;
  v_chair_id uuid;
  v_internal_ids uuid[] := coalesce(p_internal_user_ids, '{}'::uuid[]);
  v_external_ids uuid[] := coalesce(p_external_participant_ids, '{}'::uuid[]);
  v_internal_count integer := 0;
  v_external_count integer := 0;
  v_msg_text text;
  v_sqlstate text;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  select m.status, m.approval_mode, m.created_by_user_id, m.secretary_user_id, m.chair_user_id
    into v_status, v_approval_mode, v_created_by, v_secretary_id, v_chair_id
    from public.minutes m
   where m.id = p_minute_id
   for update;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status not in ('draft', 'changes_requested') then
    raise exception 'MINUTE_NOT_EDITABLE' using errcode = 'P0001';
  end if;

  if not (
    public.is_current_user_admin()
    or v_created_by = v_user_id
    or v_secretary_id = v_user_id
    or v_chair_id = v_user_id
  ) then
    raise exception 'MINUTES_NO_PERMISSION' using errcode = 'P0001';
  end if;

  if v_approval_mode = 'system' and cardinality(v_external_ids) > 0 then
    raise exception 'SYSTEM_EXTERNAL_SIGNATORY_NOT_ALLOWED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from unnest(v_internal_ids) selected(user_id)
     where not exists (
       select 1
         from public.minutes_participants mp
        where mp.minute_id = p_minute_id
          and mp.user_id = selected.user_id
     )
  ) then
    raise exception 'SIGNATORY_NOT_PARTICIPANT' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from unnest(v_external_ids) selected(participant_id)
     where not exists (
       select 1
         from public.minutes_external_participants ep
        where ep.minute_id = p_minute_id
          and ep.id = selected.participant_id
     )
  ) then
    raise exception 'SIGNATORY_NOT_PARTICIPANT' using errcode = 'P0001';
  end if;

  update public.minutes_participants
     set is_signatory = false,
         updated_at = now()
   where minute_id = p_minute_id
     and is_signatory = true;

  update public.minutes_external_participants
     set is_signatory = false,
         updated_at = now()
   where minute_id = p_minute_id
     and is_signatory = true;

  if cardinality(v_internal_ids) > 0 then
    update public.minutes_participants
       set is_signatory = true,
           updated_at = now()
     where minute_id = p_minute_id
       and user_id = any(v_internal_ids);
    get diagnostics v_internal_count = row_count;
  end if;

  if cardinality(v_external_ids) > 0 then
    update public.minutes_external_participants
       set is_signatory = true,
           updated_at = now()
     where minute_id = p_minute_id
       and id = any(v_external_ids);
    get diagnostics v_external_count = row_count;
  end if;

  return jsonb_build_object(
    'success', true,
    'minute_id', p_minute_id,
    'internal_signatory_count', v_internal_count,
    'external_signatory_count', v_external_count
  );
exception
  when sqlstate 'P0001' then
    get stacked diagnostics v_msg_text = message_text;
    return jsonb_build_object(
      'success', false,
      'error_code', v_msg_text,
      'sqlstate', 'P0001',
      'message', v_msg_text
    );
  when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    return jsonb_build_object(
      'success', false,
      'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_sqlstate,
      'message', 'خطای داخلی در ذخیره امضاکنندگان'
    );
end;
$$;

revoke all on function private.sync_minutes_signatories(uuid, uuid[], uuid[]) from public, anon;
grant execute on function private.sync_minutes_signatories(uuid, uuid[], uuid[]) to authenticated, service_role;

create or replace function public.sync_minutes_signatories(
  p_minute_id uuid,
  p_internal_user_ids uuid[] default '{}'::uuid[],
  p_external_participant_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.sync_minutes_signatories($1, $2, $3)
$$;

revoke all on function public.sync_minutes_signatories(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.sync_minutes_signatories(uuid, uuid[], uuid[]) to authenticated, service_role;

-- Patch only the approver-source predicate in the current private submit RPC.
-- The guarded replacement preserves all existing revision/notification behavior
-- and fails the migration if the expected function shape has drifted.
do $$
declare
  v_definition text;
  v_patched text;
  v_old_fragment text := E'WHERE mp.minute_id = p_minute_id\nAND mp.user_id IS NOT NULL\nORDER BY mp.user_id';
  v_new_fragment text := E'WHERE mp.minute_id = p_minute_id\nAND mp.user_id IS NOT NULL\nAND mp.is_signatory = true\nORDER BY mp.user_id';
begin
  select pg_get_functiondef(
    'private.submit_minutes_for_approval(uuid,timestamp with time zone,text)'::regprocedure
  ) into v_definition;

  if position('AND mp.is_signatory = true' in v_definition) > 0 then
    return;
  end if;

  if position(v_old_fragment in v_definition) = 0 then
    raise exception 'SUBMIT_MINUTES_FUNCTION_SHAPE_CHANGED';
  end if;

  v_patched := replace(v_definition, v_old_fragment, v_new_fragment);
  execute v_patched;
end;
$$;
