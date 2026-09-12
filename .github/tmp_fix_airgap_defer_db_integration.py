from pathlib import Path

p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')

old = r'''livekit_worker_config_contracts_ready() {
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -U postgres -d postgres -Atq <<'SQL'
select case when
  to_regclass('private.conference_speaker_timer_worker_config') is not null
  and to_regclass('private.conference_phase_worker_config') is not null
  and to_regprocedure('private.configure_conference_speaker_timer_worker(text)') is not null
  and to_regprocedure('private.configure_conference_phase_worker(text)') is not null
then 1 else 0 end;
SQL
  ) 2>>"$CURRENT_LOG" | grep -qx '1'
}

livekit_record_worker_contract_migration() {
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
DO $spark$
BEGIN
  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE $migration$
      insert into supabase_migrations.schema_migrations(version, statements, name)
      values ('20260912075003', array[]::text[], 'sync_conference_worker_config_contracts')
      on conflict (version) do nothing
    $migration$;
  END IF;
END
$spark$;
SQL
  ) >>"$CURRENT_LOG" 2>&1
}

livekit_apply_worker_contract_migration() {
  [[ -f "$AIRGAP_WORKER_CONTRACT_MIGRATION_FILE" ]] || {
    printf 'Required Air-Gap compatibility migration is missing: %s\n' "$AIRGAP_WORKER_CONTRACT_MIGRATION_FILE" >>"$CURRENT_LOG"
    return 1
  }
  printf 'Applying Air-Gap compatibility migration %s (%s) sha256=%s\n' \
    "$AIRGAP_WORKER_CONTRACT_MIGRATION_VERSION" "$AIRGAP_WORKER_CONTRACT_MIGRATION_NAME" \
    "$(sha256sum "$AIRGAP_WORKER_CONTRACT_MIGRATION_FILE" | awk '{print $1}')" >>"$CURRENT_LOG"
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
      <"$AIRGAP_WORKER_CONTRACT_MIGRATION_FILE"
  ) >>"$CURRENT_LOG" 2>&1 || return 1
  livekit_record_worker_contract_migration || return 1
}

livekit_ensure_worker_config_contracts() {
  livekit_worker_config_contracts_ready && return 0
  printf 'Conference worker DB contracts are missing; applying the Manager compatibility migration.\n' >>"$CURRENT_LOG"
  livekit_apply_worker_contract_migration || return 1
  livekit_worker_config_contracts_ready
}
'''
new = r'''spark_application_database_provisioned() {
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -U postgres -d postgres -Atq <<'SQL'
select case when
  to_regclass('public.meetings') is not null
  and to_regclass('public.profiles') is not null
  and to_regclass('public.participants') is not null
then 1 else 0 end;
SQL
  ) 2>>"$CURRENT_LOG" | grep -qx '1'
}

livekit_worker_config_contracts_ready() {
  (
    cd "$SUPABASE_ROOT"
    docker compose exec -T db psql -U postgres -d postgres -Atq <<'SQL'
select case when
  to_regclass('private.conference_speaker_timer_worker_config') is not null
  and to_regclass('private.conference_phase_worker_config') is not null
  and to_regprocedure('private.configure_conference_speaker_timer_worker(text)') is not null
  and to_regprocedure('private.configure_conference_phase_worker(text)') is not null
then 1 else 0 end;
SQL
  ) 2>>"$CURRENT_LOG" | grep -qx '1'
}

livekit_defer_database_integration() {
  install -d -m 0700 "$STATE_DIR"
  printf '%s\n' "$(date -Is)" >"${STATE_DIR}/airgap-db-integration.pending"
  chmod 0600 "${STATE_DIR}/airgap-db-integration.pending"
  printf '[DEFER] Spark application database is not provisioned yet; conference DB contracts and worker URL configuration are deferred until database restore.\n' | tee -a "$CURRENT_LOG"
}

livekit_clear_database_integration_pending() {
  rm -f "${STATE_DIR}/airgap-db-integration.pending"
}
'''
if old not in s:
    raise SystemExit('worker contract block anchor not found')
s = s.replace(old, new, 1)

old2 = r'''  livekit_airgap_validation_check "LiveKit RoomService API smoke test" livekit_api_smoke || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Conference worker DB contracts" livekit_ensure_worker_config_contracts || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Configure speaker timer worker" livekit_configure_speaker_timer_worker || { livekit_airgap_validation_report_failure; return 1; }
  livekit_airgap_validation_check "Configure conference phase worker" livekit_configure_phase_worker || { livekit_airgap_validation_report_failure; return 1; }

  for function in \
'''
new2 = r'''  livekit_airgap_validation_check "LiveKit RoomService API smoke test" livekit_api_smoke || { livekit_airgap_validation_report_failure; return 1; }

  if spark_application_database_provisioned; then
    livekit_airgap_validation_check "Conference worker DB contracts" livekit_worker_config_contracts_ready || { livekit_airgap_validation_report_failure; return 1; }
    livekit_airgap_validation_check "Configure speaker timer worker" livekit_configure_speaker_timer_worker || { livekit_airgap_validation_report_failure; return 1; }
    livekit_airgap_validation_check "Configure conference phase worker" livekit_configure_phase_worker || { livekit_airgap_validation_report_failure; return 1; }
    livekit_clear_database_integration_pending
  else
    livekit_defer_database_integration
  fi

  for function in \
'''
if old2 not in s:
    raise SystemExit('Step 21 DB integration anchor not found')
s = s.replace(old2, new2, 1)

# Surface deferred DB integration in Air-Gap status.
old3 = r'''  printf 'Local TLS req. : NO (provided later by bank security / reverse proxy)\n'
  [[ -n "$root" ]] && printf 'Active bundle  : %s\n' "$root"
'''
new3 = r'''  printf 'Local TLS req. : NO (provided later by bank security / reverse proxy)\n'
  if [[ -f "${STATE_DIR}/airgap-db-integration.pending" ]]; then
    printf 'DB integration : DEFERRED - restore the Spark database, then rerun Step 21\n'
  else
    printf 'DB integration : ready/not-deferred\n'
  fi
  [[ -n "$root" ]] && printf 'Active bundle  : %s\n' "$root"
'''
if old3 in s:
    s = s.replace(old3, new3, 1)

p.write_text(s, encoding='utf-8')

# Remove Manager-side compatibility migration download/install wiring. App DB
# migrations belong to the application database lifecycle, not infrastructure
# validation before a database restore.
p = Path('deploy/spark-cli/bootstrap.sh')
s = p.read_text(encoding='utf-8')
s = s.replace('MIGRATION_RAW_BASE="${RAW_ROOT}/supabase/migrations"\n', '')
s = s.replace('mkdir -p "$tmp/lib" "$tmp/livekit" "$tmp/migrations"', 'mkdir -p "$tmp/lib" "$tmp/livekit"')
start = s.find('manager_migrations=(\n')
if start != -1:
    end = s.find('\nlivekit_files=(', start)
    if end == -1:
        raise SystemExit('bootstrap migration block end not found')
    s = s[:start] + s[end+1:]
validation = '''grep -Fq 'configure_conference_speaker_timer_worker' "$tmp/migrations/20260912075003_sync_conference_worker_config_contracts.sql" || {\n  echo "Spark Air-Gap conference worker compatibility migration is incomplete." >&2\n  exit 1\n}\n'''
s = s.replace(validation, '')
s = s.replace('install -d -m 0755 "$stage/lib" "$stage/livekit" "$stage/migrations"', 'install -d -m 0755 "$stage/lib" "$stage/livekit"')
copy_block = '''for file in "$tmp"/migrations/*.sql; do\n  install -m 0644 "$file" "$stage/migrations/$(basename "$file")"\ndone\n'''
s = s.replace(copy_block, '')
p.write_text(s, encoding='utf-8')

p = Path('deploy/spark-cli/lib/airgap.sh')
s = p.read_text(encoding='utf-8')
s = s.replace('install -d -m 0755 "$stage/lib" "$stage/livekit" "$stage/migrations"', 'install -d -m 0755 "$stage/lib" "$stage/livekit"')
block = '''  if [[ -f "${SPARK_ROOT}/supabase/migrations/20260912075003_sync_conference_worker_config_contracts.sql" ]]; then\n    install -m 0644 "${SPARK_ROOT}/supabase/migrations/20260912075003_sync_conference_worker_config_contracts.sql" "$stage/migrations/20260912075003_sync_conference_worker_config_contracts.sql"\n  fi\n'''
s = s.replace(block, '')
p.write_text(s, encoding='utf-8')

# Remove now-unused manager migration constants from airgap-ip.sh.
p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')
for line in (
    'AIRGAP_WORKER_CONTRACT_MIGRATION_VERSION="20260912075003"\n',
    'AIRGAP_WORKER_CONTRACT_MIGRATION_NAME="sync_conference_worker_config_contracts"\n',
    'AIRGAP_WORKER_CONTRACT_MIGRATION_FILE="${SCRIPT_DIR}/migrations/20260912075003_sync_conference_worker_config_contracts.sql"\n',
):
    s = s.replace(line, '')
p.write_text(s, encoding='utf-8')

for path in ('deploy/spark-cli/bootstrap.sh','deploy/spark-cli/lib/airgap.sh','deploy/spark-cli/lib/airgap-ip.sh'):
    text = Path(path).read_text(encoding='utf-8')
    if 'livekit_apply_worker_contract_migration' in text:
        raise SystemExit(f'{path}: stale auto-migration helper remains')

text = Path('deploy/spark-cli/lib/airgap-ip.sh').read_text(encoding='utf-8')
for needle in ('spark_application_database_provisioned()', '[DEFER] Spark application database is not provisioned yet', 'airgap-db-integration.pending'):
    if needle not in text:
        raise SystemExit(f'missing expected marker: {needle}')
print('Air-Gap deferred DB integration patch: PASS')
