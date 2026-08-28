insert into private.conference_role_permissions(role,permission)
values('PRESENTER','CREATE_POLL')
on conflict(role,permission) do nothing;

alter table public.conference_polls
  add column if not exists poll_type text not null default 'SINGLE_CHOICE',
  add column if not exists is_anonymous boolean not null default false,
  add column if not exists result_visibility text not null default 'LIVE',
  add column if not exists status text not null default 'OPEN',
  add column if not exists time_limit_seconds integer,
  add column if not exists opened_at timestamptz,
  add column if not exists closes_at timestamptz,
  add column if not exists revision bigint not null default 1,
  add column if not exists updated_at timestamptz not null default now();

update public.conference_polls
set status=case when is_active then 'OPEN' else 'CLOSED' end,
    opened_at=coalesce(opened_at,created_at),
    updated_at=coalesce(updated_at,ended_at,created_at,now());

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.conference_polls'::regclass
      and conname='conference_polls_type_check'
  ) then
    alter table public.conference_polls
      add constraint conference_polls_type_check
      check(poll_type in('SINGLE_CHOICE','MULTIPLE_CHOICE','YES_NO','TRUE_FALSE'));
  end if;

  if not exists(
    select 1 from pg_constraint
    where conrelid='public.conference_polls'::regclass
      and conname='conference_polls_result_visibility_check'
  ) then
    alter table public.conference_polls
      add constraint conference_polls_result_visibility_check
      check(result_visibility in('LIVE','AFTER_VOTE','AFTER_CLOSE','HIDDEN'));
  end if;

  if not exists(
    select 1 from pg_constraint
    where conrelid='public.conference_polls'::regclass
      and conname='conference_polls_status_check'
  ) then
    alter table public.conference_polls
      add constraint conference_polls_status_check
      check(status in('DRAFT','OPEN','CLOSED'));
  end if;

  if not exists(
    select 1 from pg_constraint
    where conrelid='public.conference_polls'::regclass
      and conname='conference_polls_time_limit_check'
  ) then
    alter table public.conference_polls
      add constraint conference_polls_time_limit_check
      check(time_limit_seconds is null or time_limit_seconds between 10 and 86400);
  end if;
end
$$;

create table if not exists public.conference_poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.conference_polls(id) on delete cascade,
  room_id uuid not null references public.conference_rooms(id) on delete cascade,
  label text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint conference_poll_options_position_check check(position>=0),
  constraint conference_poll_options_label_check check(char_length(trim(label)) between 1 and 240),
  constraint conference_poll_options_poll_position_key unique(poll_id,position)
);

create unique index if not exists conference_poll_options_poll_label_key
  on public.conference_poll_options(poll_id,lower(trim(label)));

create index if not exists conference_poll_options_room_poll_idx
  on public.conference_poll_options(room_id,poll_id,position);

insert into public.conference_poll_options(poll_id,room_id,label,position)
select
  p.id,
  p.room_id,
  trim(e.value #>> '{}'),
  (e.ordinality-1)::integer
from public.conference_polls p
cross join lateral jsonb_array_elements(p.options) with ordinality e(value,ordinality)
where jsonb_typeof(p.options)='array'
  and trim(e.value #>> '{}')<>''
on conflict(poll_id,position) do nothing;

alter table public.conference_poll_votes
  add column if not exists option_id uuid;

update public.conference_poll_votes v
set option_id=o.id
from public.conference_poll_options o
where o.poll_id=v.poll_id
  and o.position=v.option_index
  and v.option_id is null;

do $$
begin
  if exists(
    select 1 from public.conference_poll_votes where option_id is null
  ) then
    raise exception 'conference_poll_votes contains unmapped legacy options';
  end if;

  if not exists(
    select 1 from pg_constraint
    where conrelid='public.conference_poll_votes'::regclass
      and conname='conference_poll_votes_option_id_fkey'
  ) then
    alter table public.conference_poll_votes
      add constraint conference_poll_votes_option_id_fkey
      foreign key(option_id)
      references public.conference_poll_options(id)
      on delete cascade;
  end if;
end
$$;

alter table public.conference_poll_votes
  alter column option_id set not null;

alter table public.conference_poll_votes
  drop constraint if exists conference_poll_votes_poll_id_user_id_key;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.conference_poll_votes'::regclass
      and conname='conference_poll_votes_poll_user_option_key'
  ) then
    alter table public.conference_poll_votes
      add constraint conference_poll_votes_poll_user_option_key
      unique(poll_id,user_id,option_id);
  end if;
end
$$;

create index if not exists conference_poll_votes_poll_user_idx
  on public.conference_poll_votes(poll_id,user_id);

create index if not exists conference_poll_votes_poll_option_idx
  on public.conference_poll_votes(poll_id,option_id);

alter table public.conference_poll_options enable row level security;
alter table public.conference_polls enable row level security;
alter table public.conference_poll_votes enable row level security;

revoke all on table public.conference_polls from public,anon,authenticated;
revoke all on table public.conference_poll_options from public,anon,authenticated;
revoke all on table public.conference_poll_votes from public,anon,authenticated;

grant select on table public.conference_polls to authenticated,service_role;
grant select on table public.conference_poll_options to authenticated,service_role;
grant select on table public.conference_poll_votes to authenticated,service_role;
grant insert,update,delete on table public.conference_polls to service_role;
grant insert,update,delete on table public.conference_poll_options to service_role;
grant insert,update,delete on table public.conference_poll_votes to service_role;

create or replace function private.can_read_conference_poll(
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
      from public.conference_participants cp
      where cp.room_id=p_room_id
        and cp.user_id=p_user_id
        and cp.status='joined'
    )
$$;

revoke execute on function private.can_read_conference_poll(uuid,uuid)
from public,anon;
grant execute on function private.can_read_conference_poll(uuid,uuid)
to authenticated,service_role;

create or replace function private.can_read_conference_poll_vote(
  p_poll_id uuid,
  p_room_id uuid,
  p_vote_user_id uuid,
  p_actor_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select
    p_actor_user_id is not null
    and private.can_read_conference_poll(p_room_id,p_actor_user_id)
    and (
      p_vote_user_id=p_actor_user_id
      or exists(
        select 1
        from public.conference_polls p
        where p.id=p_poll_id
          and p.room_id=p_room_id
          and not p.is_anonymous
          and (
            p.created_by=p_actor_user_id
            or private.has_conference_permission(
              p_room_id,'MANAGE_POLLS',p_actor_user_id
            )
          )
      )
    )
$$;

revoke execute on function private.can_read_conference_poll_vote(
  uuid,uuid,uuid,uuid
) from public,anon;
grant execute on function private.can_read_conference_poll_vote(
  uuid,uuid,uuid,uuid
) to authenticated,service_role;

do $$
declare
  v record;
begin
  for v in
    select schemaname,tablename,policyname
    from pg_policies
    where schemaname='public'
      and tablename in(
        'conference_polls',
        'conference_poll_options',
        'conference_poll_votes'
      )
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      v.policyname,v.schemaname,v.tablename
    );
  end loop;
end
$$;

create policy "conference_polls_joined_select"
on public.conference_polls
for select
to authenticated
using (
  private.can_read_conference_poll(
    conference_polls.room_id,
    (select auth.uid())
  )
);

create policy "conference_polls_full_auth_boundary"
on public.conference_polls
as restrictive
for select
to authenticated
using ((select private.is_current_session_fully_authorized()));

create policy "conference_poll_options_joined_select"
on public.conference_poll_options
for select
to authenticated
using (
  private.can_read_conference_poll(
    conference_poll_options.room_id,
    (select auth.uid())
  )
);

create policy "conference_poll_options_full_auth_boundary"
on public.conference_poll_options
as restrictive
for select
to authenticated
using ((select private.is_current_session_fully_authorized()));

create policy "conference_poll_votes_authorized_select"
on public.conference_poll_votes
for select
to authenticated
using (
  private.can_read_conference_poll_vote(
    conference_poll_votes.poll_id,
    conference_poll_votes.room_id,
    conference_poll_votes.user_id,
    (select auth.uid())
  )
);

create policy "conference_poll_votes_full_auth_boundary"
on public.conference_poll_votes
as restrictive
for select
to authenticated
using ((select private.is_current_session_fully_authorized()));

create or replace function private.conference_poll_effective_status(
  p_status text,
  p_closes_at timestamptz
)
returns text
language sql
stable
set search_path=''
as $$
  select case
    when p_status='OPEN'
      and p_closes_at is not null
      and p_closes_at<=clock_timestamp()
    then 'CLOSED'
    else p_status
  end
$$;

create or replace function private.can_manage_conference_poll(
  p_poll_id uuid,
  p_room_id uuid,
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
    from public.conference_polls p
    where p.id=p_poll_id
      and p.room_id=p_room_id
      and (
        p.created_by=p_user_id
        or private.has_conference_permission(
          p_room_id,'MANAGE_POLLS',p_user_id
        )
      )
  )
$$;

create or replace function private.get_conference_poll_snapshot(
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
  v_can_create boolean:=false;
  v_can_vote boolean:=false;
  v_polls jsonb;
begin
  if p_user_id is null then
    return jsonb_build_object('ok',false,'reason','not_authenticated');
  end if;

  if not private.can_read_conference_poll(p_room_id,p_user_id) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  v_can_create:=private.has_conference_permission(
    p_room_id,'CREATE_POLL',p_user_id
  );
  v_can_vote:=private.has_conference_permission(
    p_room_id,'VOTE_POLL',p_user_id
  );

  select coalesce(jsonb_agg(poll_payload order by created_at desc),'[]'::jsonb)
  into v_polls
  from (
    select
      p.created_at,
      jsonb_build_object(
        'id',p.id,
        'roomId',p.room_id,
        'createdBy',p.created_by,
        'question',p.question,
        'pollType',p.poll_type,
        'anonymous',p.is_anonymous,
        'resultVisibility',p.result_visibility,
        'status',private.conference_poll_effective_status(p.status,p.closes_at),
        'timeLimitSeconds',p.time_limit_seconds,
        'openedAt',p.opened_at,
        'closesAt',p.closes_at,
        'endedAt',p.ended_at,
        'createdAt',p.created_at,
        'revision',p.revision,
        'canManage',private.can_manage_conference_poll(
          p.id,p.room_id,p_user_id
        ),
        'hasVoted',exists(
          select 1 from public.conference_poll_votes mv
          where mv.poll_id=p.id and mv.user_id=p_user_id
        ),
        'canVote',
          v_can_vote
          and private.conference_poll_effective_status(
            p.status,p.closes_at
          )='OPEN'
          and not exists(
            select 1 from public.conference_poll_votes mv
            where mv.poll_id=p.id and mv.user_id=p_user_id
          ),
        'resultsVisible',
          (
            private.can_manage_conference_poll(p.id,p.room_id,p_user_id)
            or p.result_visibility='LIVE'
            or (
              p.result_visibility='AFTER_VOTE'
              and exists(
                select 1 from public.conference_poll_votes mv
                where mv.poll_id=p.id and mv.user_id=p_user_id
              )
            )
            or (
              p.result_visibility='AFTER_CLOSE'
              and private.conference_poll_effective_status(
                p.status,p.closes_at
              )='CLOSED'
            )
          ),
        'totalVoters',
          case when (
            private.can_manage_conference_poll(p.id,p.room_id,p_user_id)
            or p.result_visibility='LIVE'
            or (
              p.result_visibility='AFTER_VOTE'
              and exists(
                select 1 from public.conference_poll_votes mv
                where mv.poll_id=p.id and mv.user_id=p_user_id
              )
            )
            or (
              p.result_visibility='AFTER_CLOSE'
              and private.conference_poll_effective_status(
                p.status,p.closes_at
              )='CLOSED'
            )
          ) then (
            select count(distinct v.user_id)
            from public.conference_poll_votes v
            where v.poll_id=p.id
          ) else null end,
        'mySelectedOptionIds',coalesce((
          select jsonb_agg(v.option_id order by o.position)
          from public.conference_poll_votes v
          join public.conference_poll_options o on o.id=v.option_id
          where v.poll_id=p.id and v.user_id=p_user_id
        ),'[]'::jsonb),
        'options',coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id',o.id,
              'label',o.label,
              'position',o.position,
              'voteCount',
                case when (
                  private.can_manage_conference_poll(
                    p.id,p.room_id,p_user_id
                  )
                  or p.result_visibility='LIVE'
                  or (
                    p.result_visibility='AFTER_VOTE'
                    and exists(
                      select 1 from public.conference_poll_votes mv
                      where mv.poll_id=p.id and mv.user_id=p_user_id
                    )
                  )
                  or (
                    p.result_visibility='AFTER_CLOSE'
                    and private.conference_poll_effective_status(
                      p.status,p.closes_at
                    )='CLOSED'
                  )
                ) then (
                  select count(*)
                  from public.conference_poll_votes v
                  where v.poll_id=p.id and v.option_id=o.id
                ) else null end
            )
            order by o.position
          )
          from public.conference_poll_options o
          where o.poll_id=p.id
        ),'[]'::jsonb),
        'voters',
          case
            when not p.is_anonymous
              and private.can_manage_conference_poll(
                p.id,p.room_id,p_user_id
              )
            then coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'userId',v.user_id,
                  'displayName',coalesce(
                    nullif(trim(cp.display_name),''),
                    nullif(trim(pr.full_name),''),
                    'کاربر'
                  ),
                  'optionId',v.option_id
                )
                order by v.created_at,v.id
              )
              from public.conference_poll_votes v
              left join public.conference_participants cp
                on cp.room_id=p.room_id and cp.user_id=v.user_id
              left join public.profiles pr on pr.user_id=v.user_id
              where v.poll_id=p.id
            ),'[]'::jsonb)
            else '[]'::jsonb
          end
      ) as poll_payload
    from public.conference_polls p
    where p.room_id=p_room_id
  ) q;

  return jsonb_build_object(
    'ok',true,
    'serverTime',clock_timestamp(),
    'canCreate',v_can_create,
    'canVote',v_can_vote,
    'polls',v_polls
  );
end;
$$;

create or replace function public.get_conference_poll_snapshot(
  p_room_id uuid
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

  return private.get_conference_poll_snapshot(
    p_room_id,auth.uid()
  );
end;
$$;

revoke execute on function public.get_conference_poll_snapshot(uuid)
from public,anon;
grant execute on function public.get_conference_poll_snapshot(uuid)
to authenticated,service_role;

create or replace function private.conference_poll_action_allowed(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_poll_id uuid default null
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
  v_ok boolean;
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

  if not private.can_read_conference_poll(
    p_room_id,p_actor_user_id
  ) then
    return jsonb_build_object('ok',false,'reason','not_joined');
  end if;

  if v_action='create' then
    v_ok:=private.has_conference_permission(
      p_room_id,'CREATE_POLL',p_actor_user_id
    );
    return jsonb_build_object(
      'ok',v_ok,
      'reason',case when v_ok then null else 'forbidden' end
    );
  end if;

  if v_action='vote' then
    v_ok:=private.has_conference_permission(
      p_room_id,'VOTE_POLL',p_actor_user_id
    );
    return jsonb_build_object(
      'ok',v_ok,
      'reason',case when v_ok then null else 'forbidden' end
    );
  end if;

  if v_action in('open','close','delete') then
    if p_poll_id is null then
      return jsonb_build_object('ok',false,'reason','poll_required');
    end if;

    v_ok:=private.can_manage_conference_poll(
      p_poll_id,p_room_id,p_actor_user_id
    );
    return jsonb_build_object(
      'ok',v_ok,
      'reason',case when v_ok then null else 'forbidden' end
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.authorize_conference_poll_action(
  p_room_id uuid,
  p_action text,
  p_poll_id uuid default null
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

  return private.conference_poll_action_allowed(
    p_room_id,auth.uid(),p_action,p_poll_id
  );
end;
$$;

revoke execute on function public.authorize_conference_poll_action(
  uuid,text,uuid
) from public,anon;
grant execute on function public.authorize_conference_poll_action(
  uuid,text,uuid
) to authenticated,service_role;

create or replace function private.apply_conference_poll_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_poll_id uuid default null,
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
  v_poll public.conference_polls%rowtype;
  v_question text;
  v_type text;
  v_visibility text;
  v_options jsonb;
  v_option_count integer;
  v_unique_count integer;
  v_time_limit integer;
  v_open_immediately boolean;
  v_anonymous boolean;
  v_now timestamptz:=clock_timestamp();
  v_selected_ids uuid[];
  v_selected_count integer;
  v_valid_count integer;
  v_created_id uuid;
begin
  v_allowed:=private.conference_poll_action_allowed(
    p_room_id,p_actor_user_id,v_action,p_poll_id
  );

  if coalesce((v_allowed->>'ok')::boolean,false) is not true then
    return v_allowed;
  end if;

  if v_action='create' then
    v_question:=trim(coalesce(p_payload->>'question',''));
    v_type:=upper(trim(coalesce(p_payload->>'pollType','SINGLE_CHOICE')));
    v_visibility:=upper(trim(coalesce(
      p_payload->>'resultVisibility','LIVE'
    )));
    v_anonymous:=coalesce((p_payload->>'anonymous')::boolean,false);
    v_open_immediately:=coalesce(
      (p_payload->>'openImmediately')::boolean,true
    );

    begin
      v_time_limit:=nullif(p_payload->>'timeLimitSeconds','')::integer;
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'reason','invalid_time_limit');
    end;

    if char_length(v_question) not between 1 and 500 then
      return jsonb_build_object('ok',false,'reason','invalid_question');
    end if;

    if v_type not in(
      'SINGLE_CHOICE','MULTIPLE_CHOICE','YES_NO','TRUE_FALSE'
    ) then
      return jsonb_build_object('ok',false,'reason','invalid_poll_type');
    end if;

    if v_visibility not in(
      'LIVE','AFTER_VOTE','AFTER_CLOSE','HIDDEN'
    ) then
      return jsonb_build_object(
        'ok',false,'reason','invalid_result_visibility'
      );
    end if;

    if v_time_limit is not null
       and (v_time_limit<10 or v_time_limit>86400) then
      return jsonb_build_object('ok',false,'reason','invalid_time_limit');
    end if;

    if v_type='YES_NO' then
      v_options:='["بله","خیر"]'::jsonb;
    elsif v_type='TRUE_FALSE' then
      v_options:='["درست","نادرست"]'::jsonb;
    else
      v_options:=coalesce(p_payload->'options','[]'::jsonb);
    end if;

    if jsonb_typeof(v_options)<>'array' then
      return jsonb_build_object('ok',false,'reason','invalid_options');
    end if;

    select count(*),count(distinct lower(trim(value)))
    into v_option_count,v_unique_count
    from jsonb_array_elements_text(v_options);

    if v_option_count<2 or v_option_count>10 then
      return jsonb_build_object('ok',false,'reason','invalid_option_count');
    end if;

    if v_unique_count<>v_option_count
       or exists(
         select 1 from jsonb_array_elements_text(v_options)
         where char_length(trim(value)) not between 1 and 240
       ) then
      return jsonb_build_object('ok',false,'reason','invalid_options');
    end if;

    if (
      select count(*) from public.conference_polls p
      where p.room_id=p_room_id
    )>=50 then
      return jsonb_build_object('ok',false,'reason','poll_limit_reached');
    end if;

    insert into public.conference_polls(
      room_id,created_by,question,options,is_active,
      poll_type,is_anonymous,result_visibility,status,
      time_limit_seconds,opened_at,closes_at,revision,
      created_at,updated_at
    )
    values(
      p_room_id,p_actor_user_id,v_question,
      (
        select jsonb_agg(trim(value) order by ordinality)
        from jsonb_array_elements_text(v_options)
        with ordinality
      ),
      v_open_immediately,
      v_type,v_anonymous,v_visibility,
      case when v_open_immediately then 'OPEN' else 'DRAFT' end,
      v_time_limit,
      case when v_open_immediately then v_now else null end,
      case
        when v_open_immediately and v_time_limit is not null
        then v_now+make_interval(secs=>v_time_limit)
        else null
      end,
      1,v_now,v_now
    )
    returning id into v_created_id;

    insert into public.conference_poll_options(
      poll_id,room_id,label,position,created_at
    )
    select
      v_created_id,
      p_room_id,
      trim(value),
      (ordinality-1)::integer,
      v_now
    from jsonb_array_elements_text(v_options)
    with ordinality;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,null,'conference_poll_created',
      jsonb_build_object(
        'poll_id',v_created_id,
        'poll_type',v_type,
        'anonymous',v_anonymous,
        'result_visibility',v_visibility
      )
    );

    return jsonb_build_object('ok',true,'poll_id',v_created_id);
  end if;

  select * into v_poll
  from public.conference_polls p
  where p.id=p_poll_id
    and p.room_id=p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','poll_not_found');
  end if;

  if v_action='open' then
    if v_poll.status<>'DRAFT' then
      return jsonb_build_object('ok',false,'reason','poll_not_draft');
    end if;

    update public.conference_polls
    set status='OPEN',
        is_active=true,
        opened_at=v_now,
        closes_at=case
          when time_limit_seconds is null then null
          else v_now+make_interval(secs=>time_limit_seconds)
        end,
        ended_at=null,
        revision=revision+1,
        updated_at=v_now
    where id=v_poll.id;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,null,'conference_poll_opened',
      jsonb_build_object('poll_id',v_poll.id)
    );

    return jsonb_build_object('ok',true,'poll_id',v_poll.id);
  end if;

  if v_action='close' then
    if private.conference_poll_effective_status(
      v_poll.status,v_poll.closes_at
    )='CLOSED' then
      if v_poll.status<>'CLOSED' then
        update public.conference_polls
        set status='CLOSED',
            is_active=false,
            ended_at=coalesce(ended_at,v_now),
            revision=revision+1,
            updated_at=v_now
        where id=v_poll.id;
      end if;
      return jsonb_build_object(
        'ok',true,'poll_id',v_poll.id,'already_closed',true
      );
    end if;

    if v_poll.status<>'OPEN' then
      return jsonb_build_object('ok',false,'reason','poll_not_open');
    end if;

    update public.conference_polls
    set status='CLOSED',
        is_active=false,
        ended_at=v_now,
        revision=revision+1,
        updated_at=v_now
    where id=v_poll.id;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,null,'conference_poll_closed',
      jsonb_build_object('poll_id',v_poll.id)
    );

    return jsonb_build_object('ok',true,'poll_id',v_poll.id);
  end if;

  if v_action='delete' then
    delete from public.conference_polls
    where id=v_poll.id and room_id=p_room_id;

    insert into public.conference_audit_events(
      room_id,actor_user_id,target_user_id,event_type,metadata
    )
    values(
      p_room_id,p_actor_user_id,null,'conference_poll_deleted',
      jsonb_build_object('poll_id',v_poll.id)
    );

    return jsonb_build_object('ok',true,'poll_id',v_poll.id);
  end if;

  if v_action='vote' then
    if private.conference_poll_effective_status(
      v_poll.status,v_poll.closes_at
    )<>'OPEN' then
      return jsonb_build_object('ok',false,'reason','poll_closed');
    end if;

    if exists(
      select 1
      from public.conference_poll_votes v
      where v.poll_id=v_poll.id
        and v.user_id=p_actor_user_id
    ) then
      return jsonb_build_object('ok',false,'reason','already_voted');
    end if;

    if jsonb_typeof(coalesce(p_payload->'optionIds','null'::jsonb))<>'array' then
      return jsonb_build_object('ok',false,'reason','invalid_vote');
    end if;

    begin
      select
        array_agg(distinct value::uuid),
        count(*),
        count(distinct value)
      into v_selected_ids,v_selected_count,v_unique_count
      from jsonb_array_elements_text(p_payload->'optionIds');
    exception when invalid_text_representation then
      return jsonb_build_object('ok',false,'reason','invalid_vote');
    end;

    if v_selected_count is null or v_selected_count<1
       or v_selected_count<>v_unique_count then
      return jsonb_build_object('ok',false,'reason','invalid_vote');
    end if;

    if v_poll.poll_type in(
      'SINGLE_CHOICE','YES_NO','TRUE_FALSE'
    ) and v_selected_count<>1 then
      return jsonb_build_object('ok',false,'reason','single_choice_required');
    end if;

    select count(*)
    into v_valid_count
    from public.conference_poll_options o
    where o.poll_id=v_poll.id
      and o.room_id=p_room_id
      and o.id=any(v_selected_ids);

    if v_valid_count<>v_selected_count then
      return jsonb_build_object('ok',false,'reason','invalid_option');
    end if;

    insert into public.conference_poll_votes(
      poll_id,room_id,user_id,option_id,option_index,created_at
    )
    select
      v_poll.id,p_room_id,p_actor_user_id,o.id,o.position,v_now
    from public.conference_poll_options o
    where o.poll_id=v_poll.id
      and o.id=any(v_selected_ids)
    order by o.position;

    update public.conference_polls
    set revision=revision+1,
        updated_at=v_now
    where id=v_poll.id;

    return jsonb_build_object(
      'ok',true,
      'poll_id',v_poll.id,
      'selected_option_ids',to_jsonb(v_selected_ids)
    );
  end if;

  return jsonb_build_object('ok',false,'reason','unknown_action');
end;
$$;

create or replace function public.apply_conference_poll_action(
  p_room_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_poll_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select private.apply_conference_poll_action(
    p_room_id,p_actor_user_id,p_action,p_poll_id,p_payload
  )
$$;

revoke execute on function private.apply_conference_poll_action(
  uuid,uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function private.apply_conference_poll_action(
  uuid,uuid,text,uuid,jsonb
) to service_role;

revoke execute on function public.apply_conference_poll_action(
  uuid,uuid,text,uuid,jsonb
) from public,anon,authenticated;
grant execute on function public.apply_conference_poll_action(
  uuid,uuid,text,uuid,jsonb
) to service_role;

do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='conference_poll_options'
  ) then
    alter publication supabase_realtime
      add table public.conference_poll_options;
  end if;
end
$$;

notify pgrst,'reload schema';
