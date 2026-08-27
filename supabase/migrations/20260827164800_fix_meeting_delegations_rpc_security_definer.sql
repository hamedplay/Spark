create or replace function public.get_my_meeting_delegations_v1()
returns table(
  meeting_id uuid,
  delegate_user_id uuid,
  delegate_name text,
  status text,
  delegated_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select *
  from private.get_my_meeting_delegations_v1()
$$;

revoke all on function public.get_my_meeting_delegations_v1() from public;
revoke all on function public.get_my_meeting_delegations_v1() from anon;
grant execute on function public.get_my_meeting_delegations_v1() to authenticated;

notify pgrst, 'reload schema';