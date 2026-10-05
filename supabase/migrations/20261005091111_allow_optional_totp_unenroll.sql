create or replace function private.deactivate_canonical_totp_mfa_impl()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_session_ok boolean := false;
  v_method text;
  v_enrollment_required boolean := false;
  v_policy text := 'disabled';
  v_totp_proof_time timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED');
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    return jsonb_build_object('ok', false, 'error', 'STEP_UP_REQUIRED');
  end if;

  begin
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  end;

  select exists(
    select 1
    from auth.sessions s
    where s.id = v_session_id
      and s.user_id = v_uid
      and (s.not_after is null or s.not_after > clock_timestamp())
      and s.aal::text = 'aal2'
  ) into v_session_ok;

  if not v_session_ok then
    return jsonb_build_object('ok', false, 'error', 'SESSION_INVALID');
  end if;

  select greatest(c.created_at, c.updated_at)
  into v_totp_proof_time
  from auth.mfa_amr_claims c
  where c.session_id = v_session_id
    and c.authentication_method = 'totp'
  order by greatest(c.created_at, c.updated_at) desc
  limit 1;

  if v_totp_proof_time is null
     or v_totp_proof_time > clock_timestamp()
     or v_totp_proof_time < clock_timestamp() - interval '5 minutes'
  then
    return jsonb_build_object('ok', false, 'error', 'RECENT_TOTP_REQUIRED');
  end if;

  select p.mfa_method, coalesce(p.mfa_enrollment_required, false)
  into v_method, v_enrollment_required
  from public.profiles p
  where p.user_id = v_uid
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'PROFILE_NOT_FOUND');
  end if;

  select coalesce(s.mfa_policy, 'disabled')
  into v_policy
  from public.auth_security_settings s
  where s.id = 1;

  if v_method is null then
    return jsonb_build_object('ok', true, 'already_inactive', true, 'mfa_method', null);
  end if;

  if v_method <> 'totp' then
    return jsonb_build_object('ok', false, 'error', 'MFA_METHOD_INVALID');
  end if;

  if v_enrollment_required or v_policy = 'required' then
    return jsonb_build_object('ok', false, 'error', 'MFA_REQUIRED');
  end if;

  perform set_config('app.mfa_method_write', 'true', true);
  update public.profiles
  set mfa_method = null,
      updated_at = now()
  where user_id = v_uid;
  perform set_config('app.mfa_method_write', 'false', true);

  insert into public.security_audit_events(
    user_id, actor_user_id, target_user_id,
    event_type, event_category, severity,
    session_id, result, metadata
  ) values (
    v_uid, v_uid, v_uid,
    'mfa_method_disabled', 'mfa', 'warning',
    v_session_id, 'success',
    jsonb_build_object('from_method', 'totp', 'to_method', null)
  );

  return jsonb_build_object('ok', true, 'mfa_method', null);
exception when others then
  perform set_config('app.mfa_method_write', 'false', true);
  raise;
end;
$$;

create or replace function public.deactivate_canonical_totp_mfa()
returns jsonb
language sql
set search_path to ''
as $$
  select private.deactivate_canonical_totp_mfa_impl();
$$;

revoke all on function private.deactivate_canonical_totp_mfa_impl() from public;
grant execute on function private.deactivate_canonical_totp_mfa_impl() to authenticated, service_role;

revoke all on function public.deactivate_canonical_totp_mfa() from public;
grant execute on function public.deactivate_canonical_totp_mfa() to authenticated, service_role;
