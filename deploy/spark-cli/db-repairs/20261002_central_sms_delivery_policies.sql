-- Central SMS delivery policy for all Spark SMS events.
-- Manual DB repair: NOT a migration and NOT executed by Update Supabase.

create table if not exists public.sms_delivery_policies (
  category text not null,
  event_type text not null,
  delivery_mode text not null default 'immediate'
    check (delivery_mode in ('immediate','window','fixed_time')),
  window_start time not null default time '06:00',
  window_end time not null default time '20:00',
  fixed_time time not null default time '09:00',
  timezone text not null default 'Asia/Tehran',
  locked_immediate boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key(category,event_type),
  constraint sms_delivery_policy_window_nonzero check (window_start <> window_end)
);

alter table public.sms_delivery_policies enable row level security;

drop policy if exists sms_delivery_policies_admin_select on public.sms_delivery_policies;
create policy sms_delivery_policies_admin_select
on public.sms_delivery_policies
for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.is_admin=true
      and p.is_active is distinct from false
  )
);

drop policy if exists sms_delivery_policies_admin_insert on public.sms_delivery_policies;
create policy sms_delivery_policies_admin_insert
on public.sms_delivery_policies
for insert to authenticated
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.is_admin=true
      and p.is_active is distinct from false
  )
);

drop policy if exists sms_delivery_policies_admin_update on public.sms_delivery_policies;
create policy sms_delivery_policies_admin_update
on public.sms_delivery_policies
for update to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.is_admin=true
      and p.is_active is distinct from false
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.is_admin=true
      and p.is_active is distinct from false
  )
);

revoke all on table public.sms_delivery_policies from public,anon;
grant select,insert,update on table public.sms_delivery_policies to authenticated;
grant all on table public.sms_delivery_policies to service_role;

-- Upgrade the previously introduced deferred queue into a generic SMS queue.
create table if not exists public.deferred_sms_queue (
  id uuid primary key default gen_random_uuid(),
  delivery_mode text not null default 'dispatch'
    check (delivery_mode in ('dispatch','external','send')),
  target_user_id uuid references auth.users(id) on delete cascade,
  target_phones text[] not null default '{}'::text[],
  category text not null,
  event_type text not null,
  audience text not null default 'all',
  context jsonb not null default '{}'::jsonb,
  meeting_id uuid references public.meetings(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_key text,
  raw_message text,
  provider_id uuid references public.sms_providers(id) on delete set null,
  idempotency_key text,
  available_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending','processing','processed','failed')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.deferred_sms_queue
  add column if not exists delivery_mode text not null default 'dispatch',
  add column if not exists raw_message text,
  add column if not exists provider_id uuid;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.deferred_sms_queue'::regclass
      and conname='deferred_sms_queue_delivery_mode_check'
  ) then
    alter table public.deferred_sms_queue
      add constraint deferred_sms_queue_delivery_mode_check
      check (delivery_mode in ('dispatch','external','send'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.deferred_sms_queue'::regclass
      and conname='deferred_sms_queue_provider_id_fkey'
  ) then
    alter table public.deferred_sms_queue
      add constraint deferred_sms_queue_provider_id_fkey
      foreign key(provider_id) references public.sms_providers(id) on delete set null;
  end if;
end
$do$;

create unique index if not exists deferred_sms_queue_idempotency_key_key
  on public.deferred_sms_queue(idempotency_key)
  where idempotency_key is not null;

create index if not exists deferred_sms_queue_due_idx
  on public.deferred_sms_queue(status,available_at)
  where status in ('pending','failed');

alter table public.deferred_sms_queue enable row level security;
revoke all on table public.deferred_sms_queue from public,anon,authenticated;
grant all on table public.deferred_sms_queue to service_role;

-- Seed every SMS template/event currently known by the database.
insert into public.sms_delivery_policies(category,event_type)
select distinct st.category,st.event_type
from public.sms_templates st
where st.category is not null and st.event_type is not null
on conflict(category,event_type) do nothing;

insert into public.sms_delivery_policies(category,event_type)
values
  ('daily_report','daily_meetings'),
  ('auth','login_otp'),
  ('auth','registration_phone_otp')
on conflict(category,event_type) do nothing;

-- Preserve the requested practical defaults.
update public.sms_delivery_policies
set delivery_mode='window',
    window_start=time '06:00',
    window_end=time '20:00',
    timezone='Asia/Tehran',
    updated_at=now()
where category='meeting'
  and event_type='meeting_confirmed'
  and delivery_mode='immediate';

update public.sms_delivery_policies
set delivery_mode='fixed_time',
    fixed_time=time '09:00',
    timezone='Asia/Tehran',
    updated_at=now()
where category='decision'
  and event_type in ('decision_due_soon','decision_overdue','decision_followup_due')
  and delivery_mode='immediate';

update public.sms_delivery_policies
set delivery_mode='immediate',
    locked_immediate=true,
    updated_at=now()
where category='auth'
  and event_type in ('login_otp','registration_phone_otp');

create or replace function public.claim_deferred_sms_queue(p_limit integer default 50)
returns table(
  id uuid,
  delivery_mode text,
  target_user_id uuid,
  target_phones text[],
  category text,
  event_type text,
  audience text,
  context jsonb,
  meeting_id uuid,
  actor_user_id uuid,
  event_key text,
  raw_message text,
  provider_id uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_ids uuid[];
begin
  select array_agg(q.id)
  into v_ids
  from (
    select d.id
    from public.deferred_sms_queue d
    where d.status in ('pending','failed')
      and d.available_at<=now()
    order by d.available_at,d.created_at
    limit least(greatest(p_limit,1),100)
    for update skip locked
  ) q;

  if v_ids is null then return; end if;

  update public.deferred_sms_queue d
  set status='processing',
      attempt_count=d.attempt_count+1,
      last_error=null
  where d.id=any(v_ids);

  return query
  select d.id,d.delivery_mode,d.target_user_id,d.target_phones,d.category,d.event_type,
         d.audience,d.context,d.meeting_id,d.actor_user_id,d.event_key,d.raw_message,
         d.provider_id,d.attempt_count
  from public.deferred_sms_queue d
  where d.id=any(v_ids)
  order by d.available_at,d.created_at;
end;
$function$;

revoke all on function public.claim_deferred_sms_queue(integer) from public,anon,authenticated;
grant execute on function public.claim_deferred_sms_queue(integer) to service_role;

notify pgrst,'reload schema';
