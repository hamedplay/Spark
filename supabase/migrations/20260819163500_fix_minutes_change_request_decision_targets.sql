-- Allow minutes change requests to target a resolution or one of its execution clauses.
-- Keep legacy agenda-result targets compatible while persisting the selected decision target.

alter table public.minutes_approval_comments
  add column if not exists decision_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'minutes_approval_comments_decision_id_fkey'
      AND conrelid = 'public.minutes_approval_comments'::regclass
  ) THEN
    ALTER TABLE public.minutes_approval_comments
      ADD CONSTRAINT minutes_approval_comments_decision_id_fkey
      FOREIGN KEY (decision_id)
      REFERENCES public.minutes_decisions(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'minutes_approval_comments_single_target_check'
      AND conrelid = 'public.minutes_approval_comments'::regclass
  ) THEN
    ALTER TABLE public.minutes_approval_comments
      ADD CONSTRAINT minutes_approval_comments_single_target_check
      CHECK (num_nonnulls(decision_id, agenda_result_id) <= 1);
  END IF;
END $$;

create index if not exists idx_minutes_approval_comments_decision_id
  on public.minutes_approval_comments(decision_id)
  where decision_id is not null;

alter table public.minutes_approval_comments
  drop constraint if exists minutes_approval_comments_general_objection_check;

alter table public.minutes_approval_comments
  add constraint minutes_approval_comments_general_objection_check
  check (
    decision_id is not null
    or agenda_result_id is not null
    or (suggested_correction is not null and btrim(suggested_correction) <> '')
  );

create or replace function private.request_minutes_changes(
  p_minute_id uuid,
  p_revision_number integer,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id             uuid;
  v_status              text;
  v_existing_updated_at timestamptz;
  v_new_updated_at      timestamptz;
  v_count               integer;
  v_first_reason        text;
  v_creator_id          uuid;
  v_secretary_id        uuid;
  v_minute_title        text;
  v_context             jsonb;
  v_recipient           uuid;
  v_seen                uuid[] := '{}'::uuid[];
  v_event_key           text;
  v_msg_text            text;
  v_diag_sqlstate       text;
  v_approver_name       text;
  v_approval_row        public.minutes_approvals%rowtype;
  v_item                jsonb;
  v_reason              text;
  v_correction          text;
  v_decision_id         uuid;
  v_agenda_result_id    uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  select status, updated_at, created_by_user_id, secretary_user_id, meeting_title_snapshot
  into v_status, v_existing_updated_at, v_creator_id, v_secretary_id, v_minute_title
  from public.minutes
  where id = p_minute_id
  for update;

  if not found then
    raise exception 'MINUTE_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'MINUTE_NOT_PENDING' using errcode = 'P0001';
  end if;

  select * into v_approval_row
  from public.minutes_approvals
  where minute_id = p_minute_id
    and revision_number = p_revision_number
    and (approver_user_id = v_user_id or delegate_user_id = v_user_id)
  for update;

  if not found then
    raise exception 'NOT_AN_APPROVER' using errcode = 'P0001';
  end if;

  if v_approval_row.status <> 'pending' then
    raise exception 'APPROVAL_NOT_PENDING' using errcode = 'P0001';
  end if;

  -- Validate every requested correction target before changing approval/minute state.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_reason := nullif(btrim(v_item->>'reason'), '');
    v_correction := nullif(btrim(v_item->>'suggested_correction'), '');
    v_decision_id := nullif(v_item->>'decision_id', '')::uuid;
    v_agenda_result_id := nullif(v_item->>'agenda_result_id', '')::uuid;

    if v_reason is null then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;

    if v_decision_id is not null and v_agenda_result_id is not null then
      raise exception 'CHANGE_TARGET_AMBIGUOUS' using errcode = 'P0001';
    end if;

    if v_decision_id is not null and not exists (
      select 1
      from public.minutes_decisions d
      where d.id = v_decision_id
        and d.minute_id = p_minute_id
    ) then
      raise exception 'DECISION_MISMATCH' using errcode = 'P0001';
    end if;

    if v_agenda_result_id is not null and not exists (
      select 1
      from public.minutes_agenda_results ar
      where ar.id = v_agenda_result_id
        and ar.minute_id = p_minute_id
    ) then
      raise exception 'AGENDA_RESULT_MISMATCH' using errcode = 'P0001';
    end if;

    if v_decision_id is null
       and v_agenda_result_id is null
       and v_correction is null then
      raise exception 'GENERAL_OBJECTION_NEEDS_CORRECTION' using errcode = 'P0001';
    end if;
  end loop;

  v_count := jsonb_array_length(p_items);
  v_first_reason := p_items->0->>'reason';

  update public.minutes_approvals
  set status = 'changes_requested',
      changes_requested_at = now(),
      updated_at = now(),
      acted_by_user_id = v_user_id
  where id = v_approval_row.id;

  update public.minutes
  set status = 'changes_requested',
      updated_at = now()
  where id = p_minute_id
  returning updated_at into v_new_updated_at;

  -- Persist every correction item, including the selected resolution/clause.
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_reason := btrim(v_item->>'reason');
    v_correction := nullif(btrim(v_item->>'suggested_correction'), '');
    v_decision_id := nullif(v_item->>'decision_id', '')::uuid;
    v_agenda_result_id := nullif(v_item->>'agenda_result_id', '')::uuid;

    insert into public.minutes_approval_comments (
      approval_id,
      minute_id,
      revision_number,
      decision_id,
      agenda_result_id,
      reason,
      suggested_correction,
      created_by_user_id
    ) values (
      v_approval_row.id,
      p_minute_id,
      p_revision_number,
      v_decision_id,
      v_agenda_result_id,
      v_reason,
      v_correction,
      v_user_id
    );
  end loop;

  v_approver_name := coalesce(
    (select nullif(btrim(full_name), '') from public.profiles where user_id = v_user_id limit 1),
    'تأییدکننده'
  );

  v_context := public._get_minute_notif_context(p_minute_id) ||
    jsonb_build_object(
      'change_reason', coalesce(v_first_reason, ''),
      'approver_name', v_approver_name,
      'minute_title', coalesce(v_minute_title, ''),
      'minute_revision', p_revision_number::text,
      'minute_link', '#minutes?minute=' || p_minute_id::text,
      'audience', 'creator'
    );

  foreach v_recipient in array array[v_creator_id, v_secretary_id]
  loop
    if v_recipient is null then continue; end if;
    if v_recipient = any(v_seen) then continue; end if;
    v_seen := array_append(v_seen, v_recipient);

    if v_recipient is distinct from v_user_id then
      v_event_key := 'minute:' || p_minute_id::text || ':' || p_revision_number::text || ':minute_changes_requested:' || v_recipient::text;
      perform public._create_minutes_notification(
        v_recipient,
        'minute_changes_requested',
        'درخواست اصلاح صورت‌جلسه',
        'برای صورت‌جلسه اصلاح درخواست شد: ' || coalesce(v_first_reason, ''),
        'minute',
        p_minute_id,
        p_minute_id,
        p_revision_number,
        v_user_id,
        v_context || jsonb_build_object('audience', 'creator'),
        v_event_key
      );
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'minute_id', p_minute_id,
    'status', 'changes_requested',
    'items_count', v_count,
    'message', 'درخواست اصلاح ثبت شد. صورت‌جلسه برای اصلاح به دبیر بازگردانده شد.'
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
  when invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
    get stacked diagnostics v_diag_sqlstate = returned_sqlstate;
    return jsonb_build_object(
      'success', false,
      'error_code', 'PAYLOAD_INVALID',
      'sqlstate', v_diag_sqlstate,
      'message', 'ساختار اطلاعات ارسالی معتبر نیست'
    );
  when others then
    get stacked diagnostics v_diag_sqlstate = returned_sqlstate;
    return jsonb_build_object(
      'success', false,
      'error_code', 'INTERNAL_ERROR',
      'sqlstate', v_diag_sqlstate,
      'message', 'خطای داخلی در درخواست اصلاح'
    );
end;
$$;
