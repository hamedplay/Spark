-- Synchronize the conference worker configuration contract that already exists
-- in the Spark reference database but was not guaranteed by the repository
-- migration set used by older Air-Gap bundles.
--
-- This migration is intentionally idempotent so an Air-Gap manager can safely
-- apply it as a narrow compatibility repair before LiveKit end-to-end checks.

create table if not exists private.conference_speaker_timer_worker_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.conference_phase_worker_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create or replace function private.configure_conference_speaker_timer_worker(p_url text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if nullif(trim(p_url), '') is null or p_url !~ '^https?://' then
    raise exception 'invalid worker url';
  end if;

  insert into private.conference_speaker_timer_worker_config(key, value, updated_at)
  values ('worker_url', trim(p_url), now())
  on conflict (key) do update
  set value = excluded.value,
      updated_at = now();
end;
$function$;

create or replace function private.configure_conference_phase_worker(p_url text)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if nullif(trim(p_url), '') is null or p_url !~ '^https?://' then
    raise exception 'invalid worker url';
  end if;

  insert into private.conference_phase_worker_config(key, value, updated_at)
  values ('worker_url', trim(p_url), now())
  on conflict (key) do update
  set value = excluded.value,
      updated_at = now();
end;
$function$;

revoke all on function private.configure_conference_speaker_timer_worker(text)
  from public, anon, authenticated;
grant execute on function private.configure_conference_speaker_timer_worker(text)
  to service_role;

revoke all on function private.configure_conference_phase_worker(text)
  from public, anon, authenticated;
grant execute on function private.configure_conference_phase_worker(text)
  to service_role;
