-- Manual DB repair for configurable meeting SMS send windows.
-- This is intentionally NOT a Supabase migration. Apply manually to the target DB.

create table if not exists public.deferred_sms_queue (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid references auth.users(id) on delete cascade,
  target_phones text[] not null default '{}'::text[],
  category text not null,
  event_type text not null,
  audience text not null default 'all',
  context jsonb not null default '{}'::jsonb,
  meeting_id uuid references public.meetings(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_key text,
  idempotency_key text,
  available_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','processing','processed','failed')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists deferred_sms_queue_idempotency_key_key
  on public.deferred_sms_queue(idempotency_key)
  where idempotency_key is not null;

create index if not exists deferred_sms_queue_due_idx
  on public.deferred_sms_queue(status, available_at)
  where status in ('pending','failed');

alter table public.deferred_sms_queue enable row level security;
revoke all on table public.deferred_sms_queue from public, anon, authenticated;

insert into public.system_config(section,key,value,value_type,label)
values
  ('notifications','meeting_sms_window_meeting_created_enabled','false','boolean','محدودیت بازه پیامک ثبت جلسه'),
  ('notifications','meeting_sms_window_meeting_created_start','06:00','time','شروع بازه پیامک ثبت جلسه'),
  ('notifications','meeting_sms_window_meeting_created_end','20:00','time','پایان بازه پیامک ثبت جلسه'),
  ('notifications','meeting_sms_window_invite_enabled','false','boolean','محدودیت بازه پیامک دعوت به جلسه'),
  ('notifications','meeting_sms_window_invite_start','06:00','time','شروع بازه پیامک دعوت به جلسه'),
  ('notifications','meeting_sms_window_invite_end','20:00','time','پایان بازه پیامک دعوت به جلسه'),
  ('notifications','meeting_sms_window_meeting_confirmed_enabled','true','boolean','محدودیت بازه پیامک تأیید حضور'),
  ('notifications','meeting_sms_window_meeting_confirmed_start','06:00','time','شروع بازه پیامک تأیید حضور'),
  ('notifications','meeting_sms_window_meeting_confirmed_end','20:00','time','پایان بازه پیامک تأیید حضور'),
  ('notifications','meeting_sms_window_meeting_declined_enabled','false','boolean','محدودیت بازه پیامک رد حضور'),
  ('notifications','meeting_sms_window_meeting_declined_start','06:00','time','شروع بازه پیامک رد حضور'),
  ('notifications','meeting_sms_window_meeting_declined_end','20:00','time','پایان بازه پیامک رد حضور'),
  ('notifications','meeting_sms_window_change_enabled','false','boolean','محدودیت بازه پیامک تغییر جلسه'),
  ('notifications','meeting_sms_window_change_start','06:00','time','شروع بازه پیامک تغییر جلسه'),
  ('notifications','meeting_sms_window_change_end','20:00','time','پایان بازه پیامک تغییر جلسه'),
  ('notifications','meeting_sms_window_cancel_enabled','false','boolean','محدودیت بازه پیامک لغو جلسه'),
  ('notifications','meeting_sms_window_cancel_start','06:00','time','شروع بازه پیامک لغو جلسه'),
  ('notifications','meeting_sms_window_cancel_end','20:00','time','پایان بازه پیامک لغو جلسه'),
  ('notifications','meeting_sms_window_reminder_enabled','false','boolean','محدودیت بازه پیامک یادآور جلسه'),
  ('notifications','meeting_sms_window_reminder_start','06:00','time','شروع بازه پیامک یادآور جلسه'),
  ('notifications','meeting_sms_window_reminder_end','20:00','time','پایان بازه پیامک یادآور جلسه'),
  ('notifications','meeting_sms_window_meeting_representative_assigned_enabled','false','boolean','محدودیت بازه پیامک انتخاب جانشین'),
  ('notifications','meeting_sms_window_meeting_representative_assigned_start','06:00','time','شروع بازه پیامک انتخاب جانشین'),
  ('notifications','meeting_sms_window_meeting_representative_assigned_end','20:00','time','پایان بازه پیامک انتخاب جانشین')
on conflict(section,key) do nothing;


create or replace function public.claim_deferred_sms_queue(p_limit integer default 50)
returns table(
  id uuid,
  target_user_id uuid,
  target_phones text[],
  category text,
  event_type text,
  audience text,
  context jsonb,
  meeting_id uuid,
  actor_user_id uuid,
  event_key text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
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
      and d.available_at <= now()
    order by d.available_at, d.created_at
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
  select d.id,d.target_user_id,d.target_phones,d.category,d.event_type,d.audience,
         d.context,d.meeting_id,d.actor_user_id,d.event_key,d.attempt_count
  from public.deferred_sms_queue d
  where d.id=any(v_ids)
  order by d.available_at,d.created_at;
end;
$function$;

revoke all on function public.claim_deferred_sms_queue(integer) from public, anon, authenticated;
grant execute on function public.claim_deferred_sms_queue(integer) to service_role;
