-- Multi-clause minutes decisions.
-- Parent resolutions remain the reporting/counting unit. Child rows are independently executable clauses.

alter table public.minutes_decisions
  add column if not exists parent_decision_id uuid,
  add column if not exists clause_order integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'minutes_decisions_minute_id_id_key'
      AND conrelid = 'public.minutes_decisions'::regclass
  ) THEN
    ALTER TABLE public.minutes_decisions
      ADD CONSTRAINT minutes_decisions_minute_id_id_key UNIQUE (minute_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'minutes_decisions_parent_same_minute_fkey'
      AND conrelid = 'public.minutes_decisions'::regclass
  ) THEN
    ALTER TABLE public.minutes_decisions
      ADD CONSTRAINT minutes_decisions_parent_same_minute_fkey
      FOREIGN KEY (minute_id, parent_decision_id)
      REFERENCES public.minutes_decisions(minute_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'minutes_decisions_parent_clause_shape_check'
      AND conrelid = 'public.minutes_decisions'::regclass
  ) THEN
    ALTER TABLE public.minutes_decisions
      ADD CONSTRAINT minutes_decisions_parent_clause_shape_check CHECK (
        (parent_decision_id IS NULL AND clause_order IS NULL)
        OR
        (parent_decision_id IS NOT NULL AND clause_order IS NOT NULL AND clause_order > 0 AND parent_decision_id <> id)
      );
  END IF;
END $$;

create unique index if not exists minutes_decisions_parent_clause_order_uidx
  on public.minutes_decisions(parent_decision_id, clause_order)
  where parent_decision_id is not null;

create index if not exists idx_minutes_decisions_parent_decision_id
  on public.minutes_decisions(parent_decision_id)
  where parent_decision_id is not null;

create or replace function private._refresh_minutes_parent_decision(p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_child_count integer;
  v_completed integer;
  v_stopped integer;
  v_in_progress integer;
  v_waiting_approval integer;
  v_waiting_coordination integer;
  v_planned integer;
  v_progress integer;
  v_status text;
  v_completed_at timestamptz;
  v_latest_update text;
begin
  if p_parent_id is null then return; end if;

  select
    count(*)::integer,
    count(*) filter (where status = 'completed')::integer,
    count(*) filter (where status = 'stopped')::integer,
    count(*) filter (where status = 'in_progress')::integer,
    count(*) filter (where status = 'waiting_approval')::integer,
    count(*) filter (where status = 'waiting_coordination')::integer,
    count(*) filter (where status = 'planned')::integer,
    coalesce(round(avg(progress_percent)), 0)::integer
  into v_child_count, v_completed, v_stopped, v_in_progress,
       v_waiting_approval, v_waiting_coordination, v_planned, v_progress
  from public.minutes_decisions
  where parent_decision_id = p_parent_id;

  if v_child_count = 0 then return; end if;

  v_status := case
    when v_completed = v_child_count then 'completed'
    when v_stopped = v_child_count then 'stopped'
    when v_in_progress > 0 or v_completed > 0 then 'in_progress'
    when v_waiting_approval > 0 then 'waiting_approval'
    when v_waiting_coordination > 0 then 'waiting_coordination'
    when v_planned > 0 then 'planned'
    else 'not_started'
  end;

  if v_status = 'completed' then
    v_progress := 100;
    select max(completed_at) into v_completed_at
    from public.minutes_decisions where parent_decision_id = p_parent_id;
    v_completed_at := coalesce(v_completed_at, now());
  else
    v_completed_at := null;
  end if;

  select latest_update into v_latest_update
  from public.minutes_decisions
  where parent_decision_id = p_parent_id and nullif(btrim(latest_update), '') is not null
  order by updated_at desc
  limit 1;

  update public.minutes_decisions
  set status = v_status,
      progress_percent = v_progress,
      completed_at = v_completed_at,
      latest_update = v_latest_update,
      updated_at = now()
  where id = p_parent_id
    and parent_decision_id is null;
end;
$$;

create or replace function private._minutes_clause_refresh_parent_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.parent_decision_id is not null then
      perform private._refresh_minutes_parent_decision(old.parent_decision_id);
    end if;
    return old;
  end if;

  if new.parent_decision_id is not null then
    perform private._refresh_minutes_parent_decision(new.parent_decision_id);
  end if;
  if tg_op = 'UPDATE' and old.parent_decision_id is distinct from new.parent_decision_id and old.parent_decision_id is not null then
    perform private._refresh_minutes_parent_decision(old.parent_decision_id);
  end if;
  return new;
end;
$$;

drop trigger if exists tr_minutes_clause_refresh_parent on public.minutes_decisions;
create trigger tr_minutes_clause_refresh_parent
after insert or delete or update of status, progress_percent, completed_at, latest_update, parent_decision_id
on public.minutes_decisions
for each row execute function private._minutes_clause_refresh_parent_trigger();

create or replace function public._sync_minutes_decisions(
  p_minute_id uuid,
  p_decisions jsonb,
  p_deleted_decision_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_status text;
  v_created_by uuid;
  v_arr jsonb := coalesce(p_decisions, '[]'::jsonb);
  v_dec jsonb;
  v_exec jsonb;
  v_parent_json jsonb;
  v_delete_id uuid;
  v_dec_id uuid;
  v_parent_id uuid;
  v_title text;
  v_desc text;
  v_owner uuid;
  v_unit_id uuid;
  v_unit_name text;
  v_priority text;
  v_start_date date;
  v_due_date date;
  v_followup boolean;
  v_agenda_result_id uuid;
  v_meeting_agenda_item_id uuid;
  v_discussion text;
  v_result_type text;
  v_add_notes text;
  v_party_type text;
  v_ext_id_text text;
  v_ext_participant_id uuid;
  v_ext_name text;
  v_ext_org text;
  v_ext_position text;
  v_ext_part_minute_id uuid;
  v_clause_order integer;
  v_exists_minute uuid;
  i integer;
begin
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_decisions is not null and jsonb_typeof(p_decisions) is distinct from 'array' then
    raise exception 'PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  select m.status, m.created_by_user_id
  into v_existing_status, v_created_by
  from public.minutes m
  where m.id = p_minute_id
  for update;

  if not found then raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0001'; end if;
  if not (
    v_existing_status in ('draft', 'changes_requested') and (
      public.is_current_user_admin()
      or v_created_by = v_user_id
      or exists (select 1 from public.minutes where id = p_minute_id and secretary_user_id = v_user_id)
      or exists (select 1 from public.minutes where id = p_minute_id and chair_user_id = v_user_id)
    )
  ) then
    raise exception 'MINUTES_NO_PERMISSION' using errcode = 'P0001';
  end if;

  -- Validate structure and the execution owner only at the executable level.
  if jsonb_array_length(v_arr) > 0 then
    for i in 0..jsonb_array_length(v_arr) - 1 loop
      v_dec := v_arr->i;
      v_title := v_dec->>'title';
      if v_title is null or btrim(v_title) = '' then
        raise exception 'DECISION_TITLE_REQUIRED' using errcode = 'P0001';
      end if;

      if nullif(v_dec->>'id', '') is not null and not public._is_valid_uuid(v_dec->>'id') then
        raise exception 'INVALID_DECISION_ID' using errcode = 'P0001';
      end if;
      if nullif(v_dec->>'parent_decision_id', '') is not null and not public._is_valid_uuid(v_dec->>'parent_decision_id') then
        raise exception 'INVALID_PARENT_DECISION_ID' using errcode = 'P0001';
      end if;

      v_dec_id := nullif(v_dec->>'id', '')::uuid;
      v_parent_id := nullif(v_dec->>'parent_decision_id', '')::uuid;
      v_clause_order := nullif(v_dec->>'clause_order', '')::integer;

      if v_parent_id is not null then
        if v_dec_id is null or v_clause_order is null or v_clause_order < 1 or v_parent_id = v_dec_id then
          raise exception 'INVALID_DECISION_CLAUSE' using errcode = 'P0001';
        end if;
        select elem into v_parent_json
        from jsonb_array_elements(v_arr) elem
        where nullif(elem->>'id', '') = v_parent_id::text
        limit 1;
        if v_parent_json is not null and nullif(v_parent_json->>'parent_decision_id', '') is not null then
          raise exception 'NESTED_DECISION_CLAUSES_NOT_ALLOWED' using errcode = 'P0001';
        end if;
        if v_parent_json is null and not exists (
          select 1 from public.minutes_decisions p
          where p.id = v_parent_id and p.minute_id = p_minute_id and p.parent_decision_id is null
        ) then
          raise exception 'DECISION_PARENT_NOT_FOUND' using errcode = 'P0001';
        end if;
        v_exec := v_dec;
      else
        -- Parent with clauses is deliberately not required to carry a UI owner.
        -- Mirror the first clause internally to satisfy the existing DB contract.
        select elem into v_exec
        from jsonb_array_elements(v_arr) elem
        where v_dec_id is not null
          and nullif(elem->>'parent_decision_id', '') = v_dec_id::text
        order by coalesce(nullif(elem->>'clause_order', '')::integer, 2147483647)
        limit 1;
        v_exec := coalesce(v_exec, v_dec);
      end if;

      v_party_type := coalesce(v_exec->>'responsible_party_type', 'internal');
      v_owner := nullif(v_exec->>'primary_owner_user_id', '')::uuid;
      v_start_date := nullif(v_exec->>'start_date', '')::date;
      v_due_date := nullif(v_exec->>'due_date', '')::date;

      if v_party_type = 'internal' then
        if v_owner is null then raise exception 'DECISION_OWNER_REQUIRED' using errcode = 'P0001'; end if;
        if nullif(v_exec->>'external_responsible_name_snapshot', '') is not null
          or nullif(v_exec->>'external_responsible_participant_id', '') is not null then
          raise exception 'INTERNAL_DECISION_CANNOT_HAVE_EXTERNAL_FIELDS' using errcode = 'P0001';
        end if;
      elsif v_party_type = 'external' then
        if nullif(v_exec->>'external_responsible_name_snapshot', '') is null then
          raise exception 'DECISION_OWNER_REQUIRED' using errcode = 'P0001';
        end if;
        if v_owner is not null then
          raise exception 'EXTERNAL_DECISION_CANNOT_HAVE_INTERNAL_OWNER' using errcode = 'P0001';
        end if;
        v_ext_id_text := nullif(v_exec->>'external_responsible_participant_id', '');
        if v_ext_id_text is not null and not public._is_valid_uuid(v_ext_id_text) then
          raise exception 'INVALID_EXTERNAL_PARTICIPANT_ID' using errcode = 'P0001';
        end if;
        v_ext_participant_id := v_ext_id_text::uuid;
        if v_ext_participant_id is not null then
          select ep.minute_id into v_ext_part_minute_id
          from public.minutes_external_participants ep where ep.id = v_ext_participant_id limit 1;
          if not found then raise exception 'EXTERNAL_PARTICIPANT_NOT_FOUND' using errcode = 'P0001'; end if;
          if v_ext_part_minute_id is distinct from p_minute_id then
            raise exception 'EXTERNAL_PARTICIPANT_SCOPE_INVALID' using errcode = 'P0001';
          end if;
        end if;
      else
        raise exception 'INVALID_RESPONSIBLE_PARTY_TYPE' using errcode = 'P0001';
      end if;

      if v_start_date is not null and v_due_date is not null and v_due_date < v_start_date then
        raise exception 'DECISION_DUE_BEFORE_START' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- Deletions happen after validation but before upserts. Transaction rollback keeps this fail-safe.
  foreach v_delete_id in array coalesce(p_deleted_decision_ids, '{}'::uuid[]) loop
    delete from public.minutes_decisions where id = v_delete_id and minute_id = p_minute_id;
  end loop;

  -- Pass 1: parents. Parent execution columns mirror the first clause when clauses exist.
  if jsonb_array_length(v_arr) > 0 then
    for i in 0..jsonb_array_length(v_arr) - 1 loop
      v_dec := v_arr->i;
      if nullif(v_dec->>'parent_decision_id', '') is not null then continue; end if;

      v_dec_id := nullif(v_dec->>'id', '')::uuid;
      if v_dec_id is null then v_dec_id := gen_random_uuid(); end if;
      select d.minute_id into v_exists_minute from public.minutes_decisions d where d.id = v_dec_id;
      if found and v_exists_minute is distinct from p_minute_id then
        raise exception 'DECISION_SCOPE_INVALID' using errcode = 'P0001';
      end if;

      select elem into v_exec
      from jsonb_array_elements(v_arr) elem
      where nullif(elem->>'parent_decision_id', '') = v_dec_id::text
      order by coalesce(nullif(elem->>'clause_order', '')::integer, 2147483647)
      limit 1;
      v_exec := coalesce(v_exec, v_dec);

      v_title := v_dec->>'title'; v_desc := v_dec->>'description';
      v_owner := nullif(v_exec->>'primary_owner_user_id', '')::uuid;
      v_unit_id := nullif(v_exec->>'responsible_unit_id', '')::uuid;
      v_unit_name := v_exec->>'responsible_unit_name_snapshot';
      v_priority := coalesce(v_exec->>'priority', 'normal');
      v_start_date := nullif(v_exec->>'start_date', '')::date;
      v_due_date := nullif(v_exec->>'due_date', '')::date;
      v_followup := coalesce((v_exec->>'requires_followup')::boolean, true);
      v_meeting_agenda_item_id := nullif(v_dec->>'meeting_agenda_item_id', '')::uuid;
      v_discussion := v_dec->>'discussion_result'; v_result_type := v_dec->>'result_type'; v_add_notes := v_dec->>'additional_notes';
      v_party_type := coalesce(v_exec->>'responsible_party_type', 'internal');
      v_ext_id_text := nullif(v_exec->>'external_responsible_participant_id', '');
      v_ext_participant_id := case when v_ext_id_text is null then null else v_ext_id_text::uuid end;
      v_ext_name := v_exec->>'external_responsible_name_snapshot';
      v_ext_org := v_exec->>'external_responsible_organization_snapshot';
      v_ext_position := v_exec->>'external_responsible_position_snapshot';
      if v_party_type = 'internal' then
        v_ext_participant_id := null; v_ext_name := null; v_ext_org := null; v_ext_position := null;
      end if;

      v_agenda_result_id := null;
      if v_meeting_agenda_item_id is not null then
        select ar.id into v_agenda_result_id from public.minutes_agenda_results ar
        where ar.minute_id = p_minute_id and ar.meeting_agenda_item_id = v_meeting_agenda_item_id limit 1;
      elsif nullif(v_dec->>'agenda_result_id', '') is not null then
        select ar.id into v_agenda_result_id from public.minutes_agenda_results ar
        where ar.id = nullif(v_dec->>'agenda_result_id', '')::uuid and ar.minute_id = p_minute_id limit 1;
      end if;

      insert into public.minutes_decisions (
        id, minute_id, agenda_result_id, parent_decision_id, clause_order,
        title, description, primary_owner_user_id, responsible_unit_id, responsible_unit_name_snapshot,
        priority, status, progress_percent, completed_at, start_date, due_date, requires_followup, latest_update,
        created_by_user_id, discussion_result, result_type, additional_notes, responsible_party_type,
        external_responsible_participant_id, external_responsible_name_snapshot,
        external_responsible_organization_snapshot, external_responsible_position_snapshot
      ) values (
        v_dec_id, p_minute_id, v_agenda_result_id, null, null,
        v_title, v_desc, v_owner, v_unit_id, v_unit_name,
        v_priority, 'not_started', 0, null, v_start_date, v_due_date, v_followup, null,
        v_user_id, v_discussion, v_result_type, v_add_notes, v_party_type,
        v_ext_participant_id, v_ext_name, v_ext_org, v_ext_position
      )
      on conflict (id) do update set
        agenda_result_id = excluded.agenda_result_id,
        parent_decision_id = null, clause_order = null,
        title = excluded.title, description = excluded.description,
        primary_owner_user_id = excluded.primary_owner_user_id,
        responsible_unit_id = excluded.responsible_unit_id,
        responsible_unit_name_snapshot = excluded.responsible_unit_name_snapshot,
        priority = excluded.priority, start_date = excluded.start_date, due_date = excluded.due_date,
        requires_followup = excluded.requires_followup,
        discussion_result = excluded.discussion_result, result_type = excluded.result_type,
        additional_notes = excluded.additional_notes, responsible_party_type = excluded.responsible_party_type,
        external_responsible_participant_id = excluded.external_responsible_participant_id,
        external_responsible_name_snapshot = excluded.external_responsible_name_snapshot,
        external_responsible_organization_snapshot = excluded.external_responsible_organization_snapshot,
        external_responsible_position_snapshot = excluded.external_responsible_position_snapshot,
        updated_at = now();
    end loop;

    -- Pass 2: clauses. Parents now exist, so the self-FK is always satisfiable.
    for i in 0..jsonb_array_length(v_arr) - 1 loop
      v_dec := v_arr->i;
      v_parent_id := nullif(v_dec->>'parent_decision_id', '')::uuid;
      if v_parent_id is null then continue; end if;

      v_dec_id := nullif(v_dec->>'id', '')::uuid;
      v_clause_order := nullif(v_dec->>'clause_order', '')::integer;
      select d.minute_id into v_exists_minute from public.minutes_decisions d where d.id = v_dec_id;
      if found and v_exists_minute is distinct from p_minute_id then
        raise exception 'DECISION_SCOPE_INVALID' using errcode = 'P0001';
      end if;
      if not exists (
        select 1 from public.minutes_decisions p
        where p.id = v_parent_id and p.minute_id = p_minute_id and p.parent_decision_id is null
      ) then
        raise exception 'DECISION_PARENT_NOT_FOUND' using errcode = 'P0001';
      end if;

      v_title := v_dec->>'title'; v_desc := v_dec->>'description';
      v_owner := nullif(v_dec->>'primary_owner_user_id', '')::uuid;
      v_unit_id := nullif(v_dec->>'responsible_unit_id', '')::uuid;
      v_unit_name := v_dec->>'responsible_unit_name_snapshot';
      v_priority := coalesce(v_dec->>'priority', 'normal');
      v_start_date := nullif(v_dec->>'start_date', '')::date;
      v_due_date := nullif(v_dec->>'due_date', '')::date;
      v_followup := coalesce((v_dec->>'requires_followup')::boolean, true);
      v_meeting_agenda_item_id := nullif(v_dec->>'meeting_agenda_item_id', '')::uuid;
      v_discussion := v_dec->>'discussion_result'; v_result_type := v_dec->>'result_type'; v_add_notes := v_dec->>'additional_notes';
      v_party_type := coalesce(v_dec->>'responsible_party_type', 'internal');
      v_ext_id_text := nullif(v_dec->>'external_responsible_participant_id', '');
      v_ext_participant_id := case when v_ext_id_text is null then null else v_ext_id_text::uuid end;
      v_ext_name := v_dec->>'external_responsible_name_snapshot';
      v_ext_org := v_dec->>'external_responsible_organization_snapshot';
      v_ext_position := v_dec->>'external_responsible_position_snapshot';
      if v_party_type = 'internal' then
        v_ext_participant_id := null; v_ext_name := null; v_ext_org := null; v_ext_position := null;
      end if;

      v_agenda_result_id := null;
      if v_meeting_agenda_item_id is not null then
        select ar.id into v_agenda_result_id from public.minutes_agenda_results ar
        where ar.minute_id = p_minute_id and ar.meeting_agenda_item_id = v_meeting_agenda_item_id limit 1;
      end if;

      insert into public.minutes_decisions (
        id, minute_id, agenda_result_id, parent_decision_id, clause_order,
        title, description, primary_owner_user_id, responsible_unit_id, responsible_unit_name_snapshot,
        priority, status, progress_percent, completed_at, start_date, due_date, requires_followup, latest_update,
        created_by_user_id, discussion_result, result_type, additional_notes, responsible_party_type,
        external_responsible_participant_id, external_responsible_name_snapshot,
        external_responsible_organization_snapshot, external_responsible_position_snapshot
      ) values (
        v_dec_id, p_minute_id, v_agenda_result_id, v_parent_id, v_clause_order,
        v_title, v_desc, v_owner, v_unit_id, v_unit_name,
        v_priority, 'not_started', 0, null, v_start_date, v_due_date, v_followup, null,
        v_user_id, v_discussion, v_result_type, v_add_notes, v_party_type,
        v_ext_participant_id, v_ext_name, v_ext_org, v_ext_position
      )
      on conflict (id) do update set
        agenda_result_id = excluded.agenda_result_id,
        parent_decision_id = excluded.parent_decision_id, clause_order = excluded.clause_order,
        title = excluded.title, description = excluded.description,
        primary_owner_user_id = excluded.primary_owner_user_id,
        responsible_unit_id = excluded.responsible_unit_id,
        responsible_unit_name_snapshot = excluded.responsible_unit_name_snapshot,
        priority = excluded.priority, start_date = excluded.start_date, due_date = excluded.due_date,
        requires_followup = excluded.requires_followup,
        discussion_result = excluded.discussion_result, result_type = excluded.result_type,
        additional_notes = excluded.additional_notes, responsible_party_type = excluded.responsible_party_type,
        external_responsible_participant_id = excluded.external_responsible_participant_id,
        external_responsible_name_snapshot = excluded.external_responsible_name_snapshot,
        external_responsible_organization_snapshot = excluded.external_responsible_organization_snapshot,
        external_responsible_position_snapshot = excluded.external_responsible_position_snapshot,
        updated_at = now();
    end loop;
  end if;

  for v_parent_id in select id from public.minutes_decisions where minute_id = p_minute_id and parent_decision_id is null loop
    perform private._refresh_minutes_parent_decision(v_parent_id);
  end loop;

  return jsonb_build_object('success', true, 'minute_id', p_minute_id);
end;
$$;

-- Edit/view RPCs need hierarchy metadata. Their public wrappers depend on the exact return shape.
drop function if exists public.get_minutes_decisions_for_edit(uuid);
drop function if exists private.get_minutes_decisions_for_edit(uuid);

create function private.get_minutes_decisions_for_edit(p_minute_id uuid)
returns table(
  id uuid, agenda_result_id uuid, meeting_agenda_item_id uuid,
  parent_decision_id uuid, clause_order integer,
  title text, description text, primary_owner_user_id uuid,
  responsible_unit_id uuid, responsible_unit_name_snapshot text,
  priority text, status text, progress_percent integer, start_date date, due_date date,
  completed_at timestamptz, requires_followup boolean, latest_update text,
  created_by_user_id uuid, created_at timestamptz, updated_at timestamptz,
  discussion_result text, result_type text, additional_notes text,
  responsible_party_type text, external_responsible_participant_id uuid,
  external_responsible_name_snapshot text, external_responsible_organization_snapshot text,
  external_responsible_position_snapshot text
)
language plpgsql security definer set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_minute_status text; v_created_by uuid; v_secretary_id uuid; v_chair_id uuid;
begin
  if v_user_id is null then raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001'; end if;
  select m.status, m.created_by_user_id, m.secretary_user_id, m.chair_user_id
  into v_minute_status, v_created_by, v_secretary_id, v_chair_id
  from public.minutes m where m.id = p_minute_id;
  if not found then raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_minute_status not in ('draft','changes_requested') then raise exception 'MINUTE_NOT_EDITABLE' using errcode = 'P0001'; end if;
  if not (public.is_current_user_admin() or v_created_by = v_user_id or v_secretary_id = v_user_id or v_chair_id = v_user_id) then
    raise exception 'MINUTES_NO_PERMISSION' using errcode = 'P0001';
  end if;
  return query
  select d.id, d.agenda_result_id, ar.meeting_agenda_item_id,
         d.parent_decision_id, d.clause_order,
         d.title, d.description, d.primary_owner_user_id,
         d.responsible_unit_id, d.responsible_unit_name_snapshot,
         d.priority, d.status, d.progress_percent, d.start_date, d.due_date,
         d.completed_at, d.requires_followup, d.latest_update,
         d.created_by_user_id, d.created_at, d.updated_at,
         d.discussion_result, d.result_type, d.additional_notes,
         d.responsible_party_type, d.external_responsible_participant_id,
         d.external_responsible_name_snapshot, d.external_responsible_organization_snapshot,
         d.external_responsible_position_snapshot
  from public.minutes_decisions d
  left join public.minutes_decisions parent on parent.id = d.parent_decision_id
  left join public.minutes_agenda_results ar on ar.id = d.agenda_result_id
  where d.minute_id = p_minute_id
  order by coalesce(parent.created_at, d.created_at),
           case when d.parent_decision_id is null then 0 else 1 end,
           d.clause_order nulls first, d.created_at;
end;
$$;

create function public.get_minutes_decisions_for_edit(p_minute_id uuid)
returns table(
  id uuid, agenda_result_id uuid, meeting_agenda_item_id uuid,
  parent_decision_id uuid, clause_order integer,
  title text, description text, primary_owner_user_id uuid,
  responsible_unit_id uuid, responsible_unit_name_snapshot text,
  priority text, status text, progress_percent integer, start_date date, due_date date,
  completed_at timestamptz, requires_followup boolean, latest_update text,
  created_by_user_id uuid, created_at timestamptz, updated_at timestamptz,
  discussion_result text, result_type text, additional_notes text,
  responsible_party_type text, external_responsible_participant_id uuid,
  external_responsible_name_snapshot text, external_responsible_organization_snapshot text,
  external_responsible_position_snapshot text
)
language sql set search_path = ''
as $$select * from private.get_minutes_decisions_for_edit(p_minute_id)$$;
revoke all on function public.get_minutes_decisions_for_edit(uuid) from public, anon;
grant execute on function public.get_minutes_decisions_for_edit(uuid) to authenticated, service_role;

drop function if exists public.get_minutes_decisions_for_view(uuid);
drop function if exists private.get_minutes_decisions_for_view(uuid);

create function private.get_minutes_decisions_for_view(p_minute_id uuid)
returns table(
  id uuid, parent_decision_id uuid, clause_order integer,
  title text, description text, priority text, status text, progress_percent integer,
  start_date date, due_date date, responsible_unit_name_snapshot text,
  primary_owner_user_id uuid, owner_name text, requires_followup boolean, latest_update text,
  agenda_result_id uuid, agenda_title text, responsible_party_type text,
  external_responsible_participant_id uuid, external_responsible_name_snapshot text,
  external_responsible_organization_snapshot text, external_responsible_position_snapshot text
)
language plpgsql security definer set search_path = ''
as $$
begin
  if not public._user_can_view_minute(p_minute_id) then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return query
  select d.id, d.parent_decision_id, d.clause_order,
         d.title, d.description, d.priority, d.status::text, d.progress_percent,
         d.start_date, d.due_date, d.responsible_unit_name_snapshot,
         d.primary_owner_user_id,
         coalesce((select nullif(btrim(p.full_name), '') from public.profiles_public p where p.user_id = d.primary_owner_user_id limit 1), '') as owner_name,
         d.requires_followup, d.latest_update, d.agenda_result_id,
         ar.agenda_title_snapshot, d.responsible_party_type,
         d.external_responsible_participant_id, d.external_responsible_name_snapshot,
         d.external_responsible_organization_snapshot, d.external_responsible_position_snapshot
  from public.minutes_decisions d
  left join public.minutes_decisions parent on parent.id = d.parent_decision_id
  left join public.minutes_agenda_results ar on ar.id = d.agenda_result_id
  where d.minute_id = p_minute_id
  order by coalesce(parent.created_at, d.created_at),
           case when d.parent_decision_id is null then 0 else 1 end,
           d.clause_order nulls first, d.created_at;
end;
$$;

create function public.get_minutes_decisions_for_view(p_minute_id uuid)
returns table(
  id uuid, parent_decision_id uuid, clause_order integer,
  title text, description text, priority text, status text, progress_percent integer,
  start_date date, due_date date, responsible_unit_name_snapshot text,
  primary_owner_user_id uuid, owner_name text, requires_followup boolean, latest_update text,
  agenda_result_id uuid, agenda_title text, responsible_party_type text,
  external_responsible_participant_id uuid, external_responsible_name_snapshot text,
  external_responsible_organization_snapshot text, external_responsible_position_snapshot text
)
language sql set search_path = ''
as $$select * from private.get_minutes_decisions_for_view(p_minute_id)$$;
revoke all on function public.get_minutes_decisions_for_view(uuid) from public, anon;
grant execute on function public.get_minutes_decisions_for_view(uuid) to authenticated, service_role;

create or replace function private.get_minutes_decision_counts(p_minute_ids uuid[])
returns table(minute_id uuid, decision_count bigint)
language sql security definer set search_path = ''
as $$
select d.minute_id, count(*)::bigint
from public.minutes_decisions d
where d.minute_id = any(p_minute_ids)
  and d.parent_decision_id is null
  and d.minute_id in (select m.id from public.minutes m where public._user_can_view_minute(m.id))
group by d.minute_id
$$;

create or replace function private.get_minutes_dashboard_stats()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_total int; v_draft int; v_pending int; v_changes int; v_approved int; v_published int;
  v_open_dec int; v_overdue int; v_pending_my int;
  v_status_counts jsonb; v_dec_status_counts jsonb; v_created_30 int;
  v_near_deadline int; v_top_units jsonb;
begin
  if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  select count(*), count(*) filter (where status='draft'), count(*) filter (where status='pending_approval'),
         count(*) filter (where status='changes_requested'), count(*) filter (where status='approved'), count(*) filter (where status='published')
  into v_total, v_draft, v_pending, v_changes, v_approved, v_published
  from public.minutes m where public._user_can_view_minute(m.id);

  select count(*) filter (where d.status not in ('completed','stopped')),
         count(*) filter (where (
           (not exists (select 1 from public.minutes_decisions c where c.parent_decision_id=d.id)
             and d.due_date < current_date and d.status not in ('completed','stopped'))
           or exists (select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date < current_date and c.status not in ('completed','stopped'))
         ))
  into v_open_dec, v_overdue
  from public.minutes_decisions d
  where d.parent_decision_id is null and public._user_can_view_minute(d.minute_id);

  select count(*) into v_pending_my from public.minutes_approvals a
  where a.status='pending' and a.approver_user_id=v_uid and public._user_can_view_minute(a.minute_id);

  select coalesce(jsonb_object_agg(status,cnt),'{}'::jsonb) into v_status_counts
  from (select status,count(*) cnt from public.minutes where public._user_can_view_minute(id) group by status) s;

  select coalesce(jsonb_object_agg(status,cnt),'{}'::jsonb) into v_dec_status_counts
  from (select d.status,count(*) cnt from public.minutes_decisions d
        where d.parent_decision_id is null and public._user_can_view_minute(d.minute_id) group by d.status) s;

  select count(*) into v_created_30 from public.minutes
  where created_at >= now()-interval '30 days' and public._user_can_view_minute(id);

  select count(*) into v_near_deadline
  from public.minutes_decisions d
  where d.parent_decision_id is null and public._user_can_view_minute(d.minute_id)
    and (
      (not exists (select 1 from public.minutes_decisions c where c.parent_decision_id=d.id)
       and d.due_date between current_date and current_date + 7 and d.status not in ('completed','stopped'))
      or exists (select 1 from public.minutes_decisions c where c.parent_decision_id=d.id
                 and c.due_date between current_date and current_date + 7 and c.status not in ('completed','stopped'))
    );

  select coalesce(jsonb_agg(jsonb_build_object('unit',unit,'open_decisions',open_dec)),'[]'::jsonb) into v_top_units
  from (
    select coalesce(m.org_unit_name_snapshot,'—') unit, count(*) open_dec
    from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
    where d.parent_decision_id is null and public._user_can_view_minute(d.minute_id)
      and d.status not in ('completed','stopped')
    group by m.org_unit_name_snapshot order by open_dec desc limit 5
  ) t;

  return jsonb_build_object(
    'total_minutes',v_total,'draft',v_draft,'pending_approval',v_pending,'changes_requested',v_changes,
    'approved',v_approved,'published',v_published,'open_decisions',v_open_dec,'overdue_decisions',v_overdue,
    'pending_my_approval',v_pending_my,'status_counts',v_status_counts,'decision_status_counts',v_dec_status_counts,
    'created_last_30',v_created_30,'decisions_near_deadline',v_near_deadline,'top_units',v_top_units
  );
end;
$$;

create or replace function private.search_minutes_report(p_filters jsonb, p_limit integer, p_offset integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_limit int:=least(coalesce(p_limit,50),100); v_offset int:=greatest(coalesce(p_offset,0),0); v_rows jsonb; v_total int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'meeting_title',m.meeting_title_snapshot,'meeting_date',m.meeting_date_snapshot,'org_unit',m.org_unit_name_snapshot,
    'secretary',m.secretary_name_snapshot,'chair',m.chair_name_snapshot,'status',m.status,'approval_mode',m.approval_mode,
    'confidentiality',m.confidentiality,'revision_number',m.revision_number,'decision_count',dc.cnt,'published_at',m.published_at
  ) order by m.created_at desc),'[]'::jsonb) into v_rows
  from public.minutes m
  left join lateral (select count(*) cnt from public.minutes_decisions d where d.minute_id=m.id and d.parent_decision_id is null) dc on true
  where public._user_can_view_minute(m.id)
    and (p_filters->>'status' is null or m.status=p_filters->>'status')
    and (p_filters->>'approval_mode' is null or m.approval_mode=p_filters->>'approval_mode')
    and (p_filters->>'confidentiality' is null or m.confidentiality=p_filters->>'confidentiality')
    and (p_filters->>'org_unit_id' is null or m.org_unit_id=(p_filters->>'org_unit_id')::uuid)
    and (p_filters->>'secretary_user_id' is null or m.secretary_user_id=(p_filters->>'secretary_user_id')::uuid)
    and (p_filters->>'chair_user_id' is null or m.chair_user_id=(p_filters->>'chair_user_id')::uuid)
    and (p_filters->>'meeting_type' is null or m.meeting_type=p_filters->>'meeting_type')
    and (p_filters->>'has_decisions' is null
      or ((p_filters->>'has_decisions')::boolean and exists(select 1 from public.minutes_decisions d where d.minute_id=m.id and d.parent_decision_id is null))
      or (not (p_filters->>'has_decisions')::boolean and not exists(select 1 from public.minutes_decisions d where d.minute_id=m.id and d.parent_decision_id is null)))
  limit v_limit offset v_offset;

  select count(*) into v_total from public.minutes m
  where public._user_can_view_minute(m.id)
    and (p_filters->>'status' is null or m.status=p_filters->>'status')
    and (p_filters->>'approval_mode' is null or m.approval_mode=p_filters->>'approval_mode')
    and (p_filters->>'confidentiality' is null or m.confidentiality=p_filters->>'confidentiality')
    and (p_filters->>'org_unit_id' is null or m.org_unit_id=(p_filters->>'org_unit_id')::uuid)
    and (p_filters->>'secretary_user_id' is null or m.secretary_user_id=(p_filters->>'secretary_user_id')::uuid)
    and (p_filters->>'chair_user_id' is null or m.chair_user_id=(p_filters->>'chair_user_id')::uuid)
    and (p_filters->>'meeting_type' is null or m.meeting_type=p_filters->>'meeting_type')
    and (p_filters->>'has_decisions' is null
      or ((p_filters->>'has_decisions')::boolean and exists(select 1 from public.minutes_decisions d where d.minute_id=m.id and d.parent_decision_id is null))
      or (not (p_filters->>'has_decisions')::boolean and not exists(select 1 from public.minutes_decisions d where d.minute_id=m.id and d.parent_decision_id is null)));
  return jsonb_build_object('rows',v_rows,'total_count',v_total);
end;
$$;

create or replace function private.search_decisions_report(p_filters jsonb, p_limit integer, p_offset integer)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare v_limit int:=least(coalesce(p_limit,50),100); v_offset int:=greatest(coalesce(p_offset,0),0); v_rows jsonb; v_total int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
  with filtered as (
    select d.*,m.meeting_title_snapshot
    from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
    where d.parent_decision_id is null and public._user_can_view_minute(d.minute_id)
      and (p_filters->>'status' is null or d.status=p_filters->>'status')
      and (p_filters->>'priority' is null or d.priority=p_filters->>'priority')
      and (p_filters->>'owner_user_id' is null or d.primary_owner_user_id=(p_filters->>'owner_user_id')::uuid
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.primary_owner_user_id=(p_filters->>'owner_user_id')::uuid))
      and (p_filters->>'unit_id' is null or d.responsible_unit_id=(p_filters->>'unit_id')::uuid
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.responsible_unit_id=(p_filters->>'unit_id')::uuid))
      and (p_filters->>'minute_id' is null or d.minute_id=(p_filters->>'minute_id')::uuid)
      and (p_filters->>'org_unit_id' is null or m.org_unit_id=(p_filters->>'org_unit_id')::uuid)
      and (p_filters->>'requires_followup' is null or d.requires_followup=(p_filters->>'requires_followup')::boolean
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.requires_followup=(p_filters->>'requires_followup')::boolean))
      and (p_filters->>'due_from' is null or d.due_date is null or d.due_date >= (p_filters->>'due_from')::date
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date >= (p_filters->>'due_from')::date))
      and (p_filters->>'due_to' is null or d.due_date is null or d.due_date <= (p_filters->>'due_to')::date
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date <= (p_filters->>'due_to')::date))
      and (p_filters->>'overdue' is null or ((p_filters->>'overdue')::boolean and (
        (not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id) and d.due_date<current_date and d.status not in ('completed','stopped'))
        or exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id and c.due_date<current_date and c.status not in ('completed','stopped')))))
  ), page as (select * from filtered order by created_at desc limit v_limit offset v_offset)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'title',title,'minute_id',minute_id,'minute_title',meeting_title_snapshot,
    'owner_user_id',primary_owner_user_id,'unit',responsible_unit_name_snapshot,
    'priority',priority,'status',status,'progress',progress_percent,'due_date',due_date,
    'overdue',(due_date is not null and due_date<current_date and status not in ('completed','stopped')),
    'latest_update',latest_update
  ) order by created_at desc),'[]'::jsonb) into v_rows from page;
  select count(*) into v_total from filtered;
  return jsonb_build_object('rows',v_rows,'total_count',v_total);
end;
$$;

-- Execution queues contain clauses plus parent resolutions that have no clauses.
create or replace function private.get_my_minutes_decisions_summary()
returns table(total_count integer, active_count integer, completed_count integer, stopped_count integer, overdue_count integer)
language plpgsql security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_today date:=(now() at time zone 'Asia/Tehran')::date;
begin
  if v_user_id is null then raise exception 'NOT_AUTHENTICATED' using errcode='P0001'; end if;
  return query select
    count(*)::integer,
    count(*) filter(where d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval'))::integer,
    count(*) filter(where d.status='completed')::integer,
    count(*) filter(where d.status='stopped')::integer,
    count(*) filter(where d.due_date is not null and d.due_date<v_today and d.status not in ('completed','stopped'))::integer
  from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
  where d.primary_owner_user_id=v_user_id and m.status='published' and m.published_at is not null
    and (d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id));
end;
$$;

create or replace function private.get_trackable_minutes_decisions_summary()
returns table(total_count integer, active_count integer, completed_count integer, stopped_count integer, overdue_count integer, open_obstacle_count integer, requires_followup_count integer)
language plpgsql stable security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid(); v_today date:=(now() at time zone 'Asia/Tehran')::date;
begin
  if v_user_id is null then raise exception 'NOT_AUTHENTICATED' using errcode='P0001'; end if;
  return query select
    count(distinct d.id)::integer,
    count(distinct d.id) filter(where d.status in ('not_started','planned','in_progress','waiting_coordination','waiting_approval'))::integer,
    count(distinct d.id) filter(where d.status='completed')::integer,
    count(distinct d.id) filter(where d.status='stopped')::integer,
    count(distinct d.id) filter(where d.due_date is not null and d.due_date<v_today and d.status not in ('completed','stopped'))::integer,
    count(distinct d.id) filter(where exists(select 1 from public.minutes_decision_updates u where u.decision_id=d.id and u.is_blocking=true and u.resolved_at is null))::integer,
    count(distinct d.id) filter(where d.requires_followup=true and d.status not in ('completed','stopped'))::integer
  from public.minutes_decisions d
  where public._can_track_decisions(d.minute_id)
    and (d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id));
end;
$$;

create or replace function private.get_minutes_decision_filter_options()
returns table(option_type text, option_id text, option_label text)
language plpgsql stable security definer set search_path=''
as $$
declare v_user_id uuid:=auth.uid();
begin
  if v_user_id is null then raise exception 'NOT_AUTHENTICATED' using errcode='P0001'; end if;
  return query select distinct 'meeting'::text,d.minute_id::text,m.meeting_title_snapshot
    from public.minutes_decisions d join public.minutes m on m.id=d.minute_id
    where public._can_track_decisions(d.minute_id)
      and (d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
      and nullif(m.meeting_title_snapshot,'') is not null;
  return query select distinct 'unit'::text,d.responsible_unit_id::text,d.responsible_unit_name_snapshot
    from public.minutes_decisions d where public._can_track_decisions(d.minute_id)
      and (d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
      and d.responsible_unit_id is not null and nullif(d.responsible_unit_name_snapshot,'') is not null;
  return query select distinct 'owner'::text,d.primary_owner_user_id::text,coalesce(p.full_name,p.username,d.primary_owner_user_id::text)
    from public.minutes_decisions d left join public.profiles_public p on p.user_id=d.primary_owner_user_id
    where public._can_track_decisions(d.minute_id)
      and (d.parent_decision_id is not null or not exists(select 1 from public.minutes_decisions c where c.parent_decision_id=d.id))
      and d.primary_owner_user_id is not null;
end;
$$;

-- Prevent high-level parent rows from being mutated as execution work items through public RPCs.
create or replace function public.update_my_minutes_decision(
  p_decision_id uuid, p_expected_updated_at timestamptz,
  p_progress_percent integer default null, p_status text default null,
  p_report_text text default null, p_event_type text default 'progress',
  p_event_title text default null, p_event_metadata jsonb default '{}'::jsonb
)
returns jsonb language plpgsql set search_path=''
as $$
begin
  if exists(select 1 from public.minutes_decisions c where c.parent_decision_id=p_decision_id) then
    return jsonb_build_object('success',false,'error_code','DECISION_PARENT_NOT_EXECUTABLE','message','این مصوبه دارای بند اجرایی است؛ پیشرفت باید روی بندها ثبت شود.');
  end if;
  return private.update_my_minutes_decision(p_decision_id,p_expected_updated_at,p_progress_percent,p_status,p_report_text,p_event_type,p_event_title,p_event_metadata);
end;
$$;

create or replace function public.manage_minutes_decision(
  p_decision_id uuid, p_expected_updated_at timestamptz, p_operation text,
  p_new_status text default null, p_event_title text default null, p_report_text text default null,
  p_event_metadata jsonb default '{}'::jsonb, p_obstacle_update_id uuid default null,
  p_remind_at timestamptz default null
)
returns jsonb language plpgsql set search_path=''
as $$
begin
  if exists(select 1 from public.minutes_decisions c where c.parent_decision_id=p_decision_id) then
    return jsonb_build_object('success',false,'error_code','DECISION_PARENT_NOT_EXECUTABLE','message','این مصوبه دارای بند اجرایی است؛ عملیات پیگیری باید روی بندها انجام شود.');
  end if;
  return private.manage_minutes_decision(p_decision_id,p_expected_updated_at,p_operation,p_new_status,p_event_title,p_report_text,p_event_metadata,p_obstacle_update_id,p_remind_at);
end;
$$;

create or replace function public.resolve_my_minutes_decision_obstacle(
  p_decision_id uuid, p_expected_updated_at timestamptz, p_obstacle_update_id uuid,
  p_resolution_notes text default null
)
returns jsonb language plpgsql set search_path=''
as $$
begin
  if exists(select 1 from public.minutes_decisions c where c.parent_decision_id=p_decision_id) then
    return jsonb_build_object('success',false,'error_code','DECISION_PARENT_NOT_EXECUTABLE','message','این مصوبه دارای بند اجرایی است؛ مانع باید روی بند مربوطه مدیریت شود.');
  end if;
  return private.resolve_my_minutes_decision_obstacle(p_decision_id,p_expected_updated_at,p_obstacle_update_id,p_resolution_notes);
end;
$$;
