create or replace function public.claim_sms_dispatch_v1(
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
language sql
security definer
set search_path to ''
as $$
  select *
  from private.claim_sms_dispatch_v1(
    p_dispatch_key,
    p_target_user_id,
    p_target_phone,
    p_triggered_by_user_id,
    p_category,
    p_event_type,
    p_audience,
    p_message,
    p_meeting_id,
    p_provider_id,
    p_provider_name
  );
$$;

revoke all on function public.claim_sms_dispatch_v1(text,uuid,text,uuid,text,text,text,text,uuid,uuid,text) from public;
revoke all on function public.claim_sms_dispatch_v1(text,uuid,text,uuid,text,text,text,text,uuid,uuid,text) from anon;
revoke all on function public.claim_sms_dispatch_v1(text,uuid,text,uuid,text,text,text,text,uuid,uuid,text) from authenticated;
grant execute on function public.claim_sms_dispatch_v1(text,uuid,text,uuid,text,text,text,text,uuid,uuid,text) to service_role;

notify pgrst, 'reload schema';