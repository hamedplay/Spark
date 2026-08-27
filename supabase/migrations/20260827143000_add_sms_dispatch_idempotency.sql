alter table public.sms_dispatch_logs
  add column if not exists dispatch_key text,
  add column if not exists meeting_id uuid;

create unique index if not exists sms_dispatch_logs_dispatch_key_uidx
  on public.sms_dispatch_logs(dispatch_key)
  where dispatch_key is not null;

create index if not exists sms_dispatch_logs_meeting_id_idx
  on public.sms_dispatch_logs(meeting_id)
  where meeting_id is not null;

create or replace function private.claim_sms_dispatch_v1(
  p_dispatch_key text,
  p_target_user_id uuid,
  p_target_phone text,
  p_triggered_by_user_id uuid,
  p_category text,
  p_event_type text,
  p_audience text,
  p_message text,
  p_meeting_id uuid,
  p_provider_id uuid,
  p_provider_name text
)
returns table(log_id uuid, claimed boolean, existing_status text)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if p_dispatch_key is null or btrim(p_dispatch_key) = '' then
    raise exception 'DISPATCH_KEY_REQUIRED';
  end if;

  insert into public.sms_dispatch_logs(
    dispatch_key,
    meeting_id,
    target_user_id,
    target_phone,
    triggered_by_user_id,
    category,
    event_type,
    audience,
    message,
    provider_id,
    provider_name,
    status
  )
  values(
    p_dispatch_key,
    p_meeting_id,
    p_target_user_id,
    p_target_phone,
    p_triggered_by_user_id,
    p_category,
    p_event_type,
    p_audience,
    p_message,
    p_provider_id,
    p_provider_name,
    'pending'
  )
  on conflict (dispatch_key) where dispatch_key is not null do nothing
  returning id into v_id;

  if v_id is not null then
    return query select v_id, true, 'pending'::text;
    return;
  end if;

  select l.id, l.status
  into v_id, v_status
  from public.sms_dispatch_logs l
  where l.dispatch_key = p_dispatch_key
  limit 1;

  return query select v_id, false, v_status;
end;
$$;

revoke all on function private.claim_sms_dispatch_v1(text,uuid,text,uuid,text,text,text,text,uuid,uuid,text) from public;
grant execute on function private.claim_sms_dispatch_v1(text,uuid,text,uuid,text,text,text,text,uuid,uuid,text) to service_role;
