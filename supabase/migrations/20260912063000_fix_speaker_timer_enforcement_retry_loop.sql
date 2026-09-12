-- Prevent stale or permanently invalid speaker-timer enforcement jobs from
-- being dispatched forever and flooding conference_audit_events.
--
-- conference_livekit_policy_for_user() intentionally rejects ended rooms,
-- while the previous dispatcher retried FAILED rows without checking the room
-- lifecycle or whether the failure was a permanent payload error.

create or replace function private.dispatch_conference_speaker_timer_enforcement()
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_url text;
  v_secret text;
  v_row record;
  v_count integer := 0;
begin
  perform private.expire_conference_speaker_sessions();

  select c.value into v_url
  from private.conference_speaker_timer_worker_config c
  where c.key = 'worker_url';

  select s.decrypted_secret into v_secret
  from vault.decrypted_secrets s
  where s.name = 'conference_speaker_timer_worker_secret';

  if nullif(v_url, '') is null or nullif(v_secret, '') is null then
    return 0;
  end if;

  for v_row in
    select s.id
    from public.conference_speaker_sessions s
    join public.conference_rooms r on r.id = s.room_id
    where r.status <> 'ended'
      and r.media_topology = 'sfu'
      and nullif(r.livekit_room_name, '') is not null
      and (
        s.enforcement_status = 'PENDING'
        or (
          s.enforcement_status = 'FAILED'
          and coalesce(s.last_enforcement_error, '') <> 'ENFORCEMENT_PAYLOAD_INVALID'
        )
        or (
          s.enforcement_status = 'DISPATCHED'
          and s.last_dispatched_at < clock_timestamp() - interval '15 seconds'
        )
      )
    order by s.enforcement_requested_at
    limit 20
    for update of s skip locked
  loop
    begin
      update public.conference_speaker_sessions
      set enforcement_status = 'DISPATCHED',
          last_dispatched_at = clock_timestamp(),
          enforcement_attempts = enforcement_attempts + 1,
          updated_at = clock_timestamp()
      where id = v_row.id;

      perform net.http_post(
        url := v_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-Speaker-Timer-Secret', v_secret
        ),
        body := jsonb_build_object('sessionId', v_row.id),
        timeout_milliseconds := 5000
      );
      v_count := v_count + 1;
    exception when others then
      update public.conference_speaker_sessions
      set enforcement_status = 'FAILED',
          last_enforcement_error = left(sqlerrm, 500),
          updated_at = clock_timestamp()
      where id = v_row.id;
    end;
  end loop;

  return v_count;
end;
$function$;
