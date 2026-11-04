-- Only the ingress-overwritten address is client evidence; no XFF/server fallback.
CREATE FUNCTION private.request_client_ip_v2(p_headers jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN p_headers->>'x-spark-client-ip-source'='nginx-v2'
 THEN private.event_client_ip_v1(p_headers->>'x-spark-client-ip') END;
$$;
REVOKE ALL ON FUNCTION private.request_client_ip_v2(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.safe_client_hints_v1(p_value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_object_agg(key,value),'{}') FROM jsonb_each(CASE WHEN jsonb_typeof(p_value)='object' AND octet_length(p_value::text)<=4096 THEN p_value ELSE '{}' END)
 WHERE key IN ('platform','platformVersion','model','architecture','bitness','browser','browserVersion','mobile','maxTouchPoints')
 AND jsonb_typeof(value) IN ('string','number','boolean') AND length(value::text)<=120;
$$;
REVOKE ALL ON FUNCTION private.safe_client_hints_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE private.session_connection_context (
 session_id uuid PRIMARY KEY REFERENCES public.session_security_state(session_id) ON DELETE CASCADE,
 user_id uuid NOT NULL,first_observed_at timestamptz NOT NULL DEFAULT now(),
 initial_ip inet,initial_ip_source text,observation_kind text NOT NULL,
 last_observed_at timestamptz NOT NULL DEFAULT now(),last_ip inet,last_ip_source text,
 user_agent text,client_hints jsonb NOT NULL DEFAULT '{}',ended_at timestamptz,end_reason text
);
ALTER TABLE private.session_connection_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.session_connection_context FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.capture_session_connection_v1(p_session_id uuid,p_user_id uuid,p_ip text,p_user_agent text,p_hints jsonb,p_kind text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ip text:=private.event_client_ip_v1(p_ip);
BEGIN
 IF NOT EXISTS(SELECT FROM public.session_security_state s JOIN auth.sessions a ON a.id=s.session_id AND a.user_id=s.user_id
   WHERE s.session_id=p_session_id AND s.user_id=p_user_id AND s.revoked_at IS NULL AND (a.not_after IS NULL OR a.not_after>now())
   AND least(s.idle_expiry_at,s.absolute_expiry_at)>now()) THEN RETURN false; END IF;
 INSERT INTO private.session_connection_context(session_id,user_id,initial_ip,initial_ip_source,observation_kind,last_ip,last_ip_source,user_agent,client_hints)
 VALUES(p_session_id,p_user_id,v_ip::inet,CASE WHEN v_ip IS NOT NULL THEN 'trusted_ingress' END,p_kind,v_ip::inet,
   CASE WHEN v_ip IS NOT NULL THEN 'trusted_ingress' END,nullif(left(p_user_agent,512),''),private.safe_client_hints_v1(p_hints))
 ON CONFLICT(session_id) DO UPDATE SET
   last_observed_at=now(),last_ip=EXCLUDED.last_ip,last_ip_source=EXCLUDED.last_ip_source,
   user_agent=coalesce(EXCLUDED.user_agent,session_connection_context.user_agent),
   client_hints=session_connection_context.client_hints||EXCLUDED.client_hints;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION private.capture_session_connection_v1(uuid,uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.record_session_connection_service_v1(p_session_id uuid,p_user_id uuid,p_headers jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_ip text:=private.request_client_ip_v2(p_headers); v_new boolean;
BEGIN
 PERFORM 1 FROM public.session_security_state WHERE session_id=p_session_id AND user_id=p_user_id FOR UPDATE;
 SELECT NOT EXISTS(SELECT FROM private.session_connection_context WHERE session_id=p_session_id) INTO v_new;
 IF NOT private.capture_session_connection_v1(p_session_id,p_user_id,v_ip,p_headers->>'user-agent','{}','gateway_login') THEN RETURN false; END IF;
 IF v_new THEN
   INSERT INTO public.security_audit_events(user_id,actor_user_id,session_id,event_type,event_category,severity,result,ip_address,metadata)
   VALUES(p_user_id,p_user_id,p_session_id,'session.login_connection','session','info','success',v_ip,
    jsonb_strip_nulls(jsonb_build_object('source','login_gateway','ip_source',CASE WHEN v_ip IS NOT NULL THEN 'trusted_ingress' END,
     'user_agent',left(p_headers->>'user-agent',512),'details','اتصال هنگام ایجاد نشست ثبت شد؛ تکمیل مراحل ورود سامانه جداگانه بررسی می‌شود.')));
 END IF;
 RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_session_connection_service_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_session_connection_service_v1(uuid,uuid,jsonb) TO service_role;
CREATE FUNCTION private.remember_session_end_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 UPDATE private.session_connection_context SET ended_at=coalesce(ended_at,now()),end_reason=coalesce(end_reason,'auth_session_removed')
 WHERE session_id=OLD.id AND user_id=OLD.user_id;
 RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION private.remember_session_end_v1() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER spark_remember_session_end AFTER DELETE ON auth.sessions FOR EACH ROW EXECUTE FUNCTION private.remember_session_end_v1();
ALTER TABLE public.audit_log ADD COLUMN ip_source text;

CREATE OR REPLACE FUNCTION public.record_my_session_context_v1()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_sid uuid;
  v_state jsonb;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  v_state := private.get_my_auth_access_state_v3();
  if coalesce(v_state->>'access_level','BLOCKED') <> 'FULL' then
    raise exception 'FULL_SESSION_REQUIRED' using errcode='42501';
  end if;
  begin v_sid := nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return false; end;
  if v_sid is null or v_state->>'user_id' is distinct from v_uid::text
    or v_state->>'session_id' is distinct from v_sid::text then return false; end if;
  if exists(select 1 from private.event_session_context where session_id=v_sid) then return true; end if;
  begin v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when invalid_text_representation then v_headers := '{}'::jsonb; end;
  v_ip := private.request_client_ip_v2(v_headers);
  insert into private.event_session_context(session_id,user_id,ip_address,ip_source,user_agent)
    values(v_sid,v_uid,v_ip::inet,case when v_ip is not null then 'trusted_ingress' else null end,
           nullif(left(v_headers->>'user-agent',512),''))
    on conflict (session_id) do nothing;
  return true;
end;
$function$
;

CREATE FUNCTION public.record_my_session_connection_v1(p_client_hints jsonb DEFAULT '{}') RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_headers jsonb; v_sid uuid;
BEGIN
 PERFORM public.record_my_session_context_v1();
 v_sid:=nullif(auth.jwt()->>'session_id','')::uuid;
 BEGIN v_headers:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'); EXCEPTION WHEN invalid_text_representation THEN v_headers:='{}'; END;
 RETURN private.capture_session_connection_v1(v_sid,auth.uid(),private.request_client_ip_v2(v_headers),v_headers->>'user-agent',p_client_hints,'first_full_access');
END;
$$;
REVOKE ALL ON FUNCTION public.record_my_session_connection_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.record_my_session_connection_v1(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION private.get_user_session_security_state_impl(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_caller_uid uuid := auth.uid();
BEGIN
  IF v_caller_uid IS NOT NULL AND v_caller_uid <> p_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'FORBIDDEN');
  END IF;
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'USER_ID_REQUIRED');
  END IF;

  RETURN jsonb_build_object('ok', true, 'server_time',now(),'presence_grace_seconds',(SELECT least(3600,greatest(30,coalesce(session_heartbeat_interval_seconds,300)))+60 FROM public.auth_security_settings WHERE id=1),'sessions', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'session_id', s.session_id,
      'created_at', s.created_at,
      'last_activity_at', s.last_activity_at,
      'idle_expiry_at', s.idle_expiry_at,
      'absolute_expiry_at', s.absolute_expiry_at,
      'revoked_at', s.revoked_at,
      'revoke_reason', s.revoke_reason,
      'device_summary', coalesce(c.user_agent,s.device_summary),
      'initial_ip',host(c.initial_ip),'initial_ip_source',c.initial_ip_source,
      'last_ip',host(c.last_ip),'last_ip_source',c.last_ip_source,
      'first_observed_at',c.first_observed_at,'last_observed_at',c.last_observed_at,
      'observation_kind',c.observation_kind,'client_hints',coalesce(c.client_hints,'{}'::jsonb),
      'ended_at',coalesce(s.revoked_at,c.ended_at,CASE WHEN least(s.idle_expiry_at,s.absolute_expiry_at)<=now() THEN least(s.idle_expiry_at,s.absolute_expiry_at) END),
      'end_reason',coalesce(s.revoke_reason,c.end_reason),
      'presence',CASE WHEN s.revoked_at IS NOT NULL OR a.id IS NULL OR s.auth_epoch<>coalesce(p.auth_epoch,1)
        OR least(s.idle_expiry_at,s.absolute_expiry_at)<=now() THEN 'ended'
        WHEN c.last_observed_at>=now()-make_interval(secs=>least(3600,greatest(30,coalesce(cfg.session_heartbeat_interval_seconds,300)))+60)
          THEN 'online' ELSE 'offline' END,
      'status', CASE
        WHEN s.revoked_at IS NOT NULL THEN 'revoked'
        WHEN a.id IS NULL THEN 'expired'
        WHEN s.auth_epoch <> COALESCE(p.auth_epoch, 1) THEN 'epoch_expired'
        WHEN s.absolute_expiry_at <= now() THEN 'absolute_expired'
        WHEN s.idle_expiry_at <= now() THEN 'idle_expired'
        ELSE 'active'
      END
    ) ORDER BY s.created_at DESC)
    FROM public.session_security_state s
    LEFT JOIN private.session_connection_context c ON c.session_id=s.session_id AND c.user_id=s.user_id
    LEFT JOIN public.auth_security_settings cfg ON cfg.id=1
    LEFT JOIN auth.sessions a
      ON a.id = s.session_id
      AND a.user_id = s.user_id
      AND (a.not_after IS NULL OR a.not_after > now())
    LEFT JOIN public.profiles p ON p.user_id = s.user_id
    WHERE s.user_id = p_user_id
      AND (
        (s.revoked_at IS NULL AND a.id IS NOT NULL
         AND s.auth_epoch = COALESCE(p.auth_epoch, 1)
         AND s.idle_expiry_at > now() AND s.absolute_expiry_at > now())
        OR greatest(s.created_at, s.last_activity_at,
             COALESCE(s.revoked_at, least(s.idle_expiry_at, s.absolute_expiry_at)))
           >= now() - interval '30 days'
      )
  ), '[]'::jsonb));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.write_audit_log(p_module text, p_action text, p_entity_name text DEFAULT NULL::text, p_entity_id text DEFAULT NULL::text, p_details text DEFAULT NULL::text, p_severity text DEFAULT 'info'::text, p_user_agent text DEFAULT NULL::text, p_url text DEFAULT NULL::text, p_referrer text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_user_name text;
  v_headers jsonb := '{}'::jsonb;
  v_ip text;
  v_id uuid;
begin
  if v_uid is null then raise exception 'UNAUTHORIZED' using errcode='42501'; end if;
  if nullif(btrim(coalesce(p_action,'')),'') is null then
    raise exception 'AUDIT_ACTION_REQUIRED' using errcode='22023';
  end if;
  if coalesce(p_severity,'info') not in ('info','warning','error','critical') then
    raise exception 'INVALID_AUDIT_SEVERITY' using errcode='22023';
  end if;
  select coalesce(nullif(btrim(full_name),''),nullif(btrim(email),'')) into v_user_name
    from public.profiles where user_id = v_uid limit 1;
  begin v_headers := coalesce(nullif(current_setting('request.headers',true),'')::jsonb,'{}'::jsonb);
  exception when others then v_headers := '{}'::jsonb; end;
  v_ip := private.request_client_ip_v2(v_headers);
  insert into public.audit_log(user_id,user_name,ip_address,user_agent,module,action,entity_name,entity_id,
    details,severity,url,referrer,ip_source)
  values(v_uid,v_user_name,v_ip,left(p_user_agent,512),p_module,p_action,p_entity_name,p_entity_id,
    p_details,coalesce(p_severity,'info'),p_url,p_referrer,CASE WHEN v_ip IS NOT NULL THEN 'trusted_ingress' END)
  returning id into v_id;
  return v_id;
end;
$function$
;

CREATE FUNCTION private.event_network_projection_v1(p_event jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m jsonb:=coalesce(p_event->'metadata','{}'); sx jsonb:=m->'session_context';
BEGIN
 IF m->>'ip_source' IS DISTINCT FROM 'trusted_ingress' THEN
   m:=m||jsonb_strip_nulls(jsonb_build_object('reported_ip_address',p_event->>'ip_address','ip_status','unverified'));
   p_event:=p_event||jsonb_build_object('ip_address',null);
 END IF;
 IF sx IS NOT NULL AND sx->>'ip_source' IS DISTINCT FROM 'trusted_ingress' THEN
   m:=jsonb_set(m,'{session_context}',(sx-'ip_address')||jsonb_strip_nulls(jsonb_build_object('reported_ip_address',sx->>'ip_address')));
 END IF;
 RETURN p_event||jsonb_build_object('metadata',m);
END;
$$;
REVOKE ALL ON FUNCTION private.event_network_projection_v1(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.get_event_center_v1(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT NULL::text, p_severity text DEFAULT NULL::text, p_result text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_before_time timestamp with time zone DEFAULT NULL::timestamp with time zone, p_before_key text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  rows_json jsonb;
  more_rows boolean;
  from_time timestamptz := coalesce(p_from,now()-interval '7 days');
  to_time timestamptz := coalesce(p_to,now());
  search_text text := nullif(btrim(p_search),'');
begin
  if not (private.current_user_has_permission_v1('config_users.group_events')
    or private.current_user_has_permission_v1('config_audit.audit_log')) then
    raise exception 'FORBIDDEN' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or to_time<from_time or to_time-from_time>interval '93 days'
    or (p_before_time is null)<>(p_before_key is null) or length(coalesce(search_text,''))>200
    or (p_source is not null and p_source not in ('application','security')) then
    raise exception 'INVALID_FILTER' using errcode='22023';
  end if;
  with combined as (
    select 'application:'||a.id::text event_key,a.id,a.created_at,'application'::text source,
      a.action event_type,coalesce(a.module,'application') category,a.severity,null::text result,
      a.user_id actor_user_id,a.user_name actor_name,null::uuid target_user_id,
      a.ip_address,null::text ip_hash,null::uuid session_id,null::uuid request_id,null::text error_code,
      jsonb_build_object('entity_name',a.entity_name,'entity_id',a.entity_id,
        'ip_source',a.ip_source,'details',left(a.details,4000),'user_agent',left(a.user_agent,512),
        'url',split_part(split_part(a.url,'?',1),'#',1),'referrer',split_part(split_part(a.referrer,'?',1),'#',1)) metadata,
      null::jsonb before_state,null::jsonb after_state
    from public.audit_log a where a.created_at>=from_time and a.created_at<=to_time and (p_source is null or p_source='application')
    union all
    select 'security:'||e.id::text,e.id,e.created_at,'security',e.event_type,e.event_category,e.severity,e.result,
      coalesce(e.actor_user_id,e.user_id),p.full_name,e.target_user_id,e.ip_address,e.ip_hash,e.session_id,e.request_id,e.error_code,
      public.sanitize_audit_metadata(e.metadata) || jsonb_strip_nulls(jsonb_build_object(
        'session_context',case when cx.session_id is not null then jsonb_strip_nulls(jsonb_build_object(
          'ip_address',host(cx.ip_address),'ip_source',cx.ip_source,'user_agent',cx.user_agent,'observed_at',cx.created_at)) end,
        'session_device',case when cx.session_id is null and nullif(ss.device_summary,'unknown') is not null
          then jsonb_build_object('user_agent',left(ss.device_summary,512),'source','session_registry') end)),
      public.sanitize_audit_metadata(e.before_state),public.sanitize_audit_metadata(e.after_state)
    from public.security_audit_events e left join public.profiles p on p.user_id=coalesce(e.actor_user_id,e.user_id)
    left join private.event_session_context cx on cx.session_id=e.session_id and cx.user_id=coalesce(e.actor_user_id,e.user_id)
    left join public.session_security_state ss on ss.session_id=e.session_id and ss.user_id=coalesce(e.actor_user_id,e.user_id)
    where e.created_at>=from_time and e.created_at<=to_time and (p_source is null or p_source='security')
    union all
    -- Read the existing Auth audit source; never copy credentials, traits or raw payloads.
    -- Successful identity authentication is not a claim of FULL application/MFA access.
    select 'authentication:'||a.id::text,a.id,a.created_at,'security',
      'auth.'||(a.payload->>'action'),
      case when a.payload->>'action' in ('challenge_created','verification_attempted','factor_in_progress',
        'factor_unenrolled','factor_deleted','factor_updated','generate_recovery_codes','recovery_codes_deleted','mfa_code_login')
        then 'mfa' when a.payload->>'action'='user_recovery_requested' then 'recovery' else 'auth' end,
      'info',
      case when a.payload->>'action' in ('login','logout','user_signedup','user_updated_password','user_deleted','mfa_code_login')
        then 'success'::text else null::text end,
      actor.user_id,coalesce(nullif(p.full_name,''),nullif(p.username,'')),
      null::uuid,private.event_client_ip_v1(a.ip_address),null::text,null::uuid,null::uuid,null::text,
      jsonb_strip_nulls(jsonb_build_object('source','auth_service','auth_action',a.payload->>'action',
        'auth_provider',case when coalesce(a.payload::jsonb->'traits'->>'provider',a.payload::jsonb->'traits'->>'provider_type') ~ '^[a-z_]{1,40}$'
          then coalesce(a.payload::jsonb->'traits'->>'provider',a.payload::jsonb->'traits'->>'provider_type') else null end,
        'verification_scope','identity_service',
        'ip_source',case when private.event_client_ip_v1(a.ip_address) is not null then 'auth_service' end,
        'user_agent',nullif(left(a.payload->>'user_agent',512),''),
        'details',case a.payload->>'action' when 'login' then 'ورود کاربر در سرویس احراز هویت ثبت شد.'
          when 'logout' then 'خروج کاربر در سرویس احراز هویت ثبت شد.' else null end)),
      null::jsonb,null::jsonb
    from auth.audit_log_entries a
    cross join lateral (select case when a.payload->>'actor_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then (a.payload->>'actor_id')::uuid else null::uuid end user_id) actor
    left join public.profiles p on p.user_id=actor.user_id
    where a.created_at>=from_time and a.created_at<=to_time and (p_source is null or p_source='security')
      and a.payload->>'action' in ('login','logout','user_signedup','user_deleted','user_modified','user_updated_password',
        'user_invited','invite_accepted','user_recovery_requested','user_reauthenticate_requested',
        'user_confirmation_requested','user_repeated_signup','generate_recovery_codes','factor_in_progress',
        'factor_unenrolled','challenge_created','verification_attempted','factor_deleted','recovery_codes_deleted',
        'factor_updated','mfa_code_login','identity_unlinked')
    union all
    -- This is an observed FULL session, not a reconstruction of the Auth login timestamp.
    select 'session:'||c.id::text,c.id,c.created_at,'security','session.first_full_access','session','info','success',
      c.user_id,coalesce(nullif(p.full_name,''),nullif(p.username,'')),null::uuid,
      host(c.ip_address),null::text,c.session_id,null::uuid,null::text,
      jsonb_strip_nulls(jsonb_build_object('source','session_access','verification_scope','full_session',
        'user_agent',c.user_agent,'client_hints',cx.client_hints,'ip_source',c.ip_source,
        'details','نخستین درخواست ثبت‌شدهٔ این نشست پس از تأیید دسترسی کامل سامانه.')),
      null::jsonb,null::jsonb
    from private.event_session_context c left join public.profiles p on p.user_id=c.user_id
    left join private.session_connection_context cx on cx.session_id=c.session_id and cx.user_id=c.user_id
    where c.created_at>=from_time and c.created_at<=to_time and (p_source is null or p_source='security')

  ), filtered as (
    select * from combined c where (p_severity is null or c.severity=p_severity)
      and (p_result is null or c.result=p_result)
      and (search_text is null or strpos(lower(concat_ws(' ',c.event_type,c.category,c.actor_name,c.actor_user_id::text,
        c.target_user_id::text,c.request_id::text,c.session_id::text,c.ip_address,c.ip_hash,c.error_code,c.metadata::text)),lower(search_text))>0)
      and (p_before_time is null or (c.created_at,c.event_key)<(p_before_time,p_before_key))
    order by c.created_at desc,c.event_key desc limit p_limit+1
  ), page as (select * from filtered order by created_at desc,event_key desc limit p_limit)
  select coalesce((select jsonb_agg(private.event_network_projection_v1(to_jsonb(page)) order by created_at desc,event_key desc) from page),'[]'::jsonb),
    (select count(*)>p_limit from filtered) into rows_json,more_rows;
  return jsonb_build_object('events',rows_json,'has_more',more_rows,
    'next_cursor',case when more_rows then jsonb_build_object('time',rows_json->-1->>'created_at','key',rows_json->-1->>'event_key') else null end);
end $function$
;
NOTIFY pgrst,'reload schema';
