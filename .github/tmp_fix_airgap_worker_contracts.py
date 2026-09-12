from pathlib import Path

MIGRATION = "20260912075003_sync_conference_worker_config_contracts.sql"
VERSION = "20260912075003"
NAME = "sync_conference_worker_config_contracts"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor, found {count}")
    return text.replace(old, new, 1)

# bootstrap.sh: install the compatibility migration beside the Manager so an
# already-imported older application bundle does not need to be rebuilt.
p = Path("deploy/spark-cli/bootstrap.sh")
s = p.read_text(encoding="utf-8")
s = replace_once(
    s,
    'RAW_BASE="https://raw.githubusercontent.com/hamedplay/Spark/${MAIN_SHA}/deploy/spark-cli"\nLIVEKIT_RAW_BASE="https://raw.githubusercontent.com/hamedplay/Spark/${MAIN_SHA}/deploy/livekit"',
    'RAW_ROOT="https://raw.githubusercontent.com/hamedplay/Spark/${MAIN_SHA}"\nRAW_BASE="${RAW_ROOT}/deploy/spark-cli"\nLIVEKIT_RAW_BASE="${RAW_ROOT}/deploy/livekit"\nMIGRATION_RAW_BASE="${RAW_ROOT}/supabase/migrations"',
    "bootstrap raw roots",
)
s = replace_once(
    s,
    'mkdir -p "$tmp/lib" "$tmp/livekit"',
    'mkdir -p "$tmp/lib" "$tmp/livekit" "$tmp/migrations"',
    "bootstrap tmp directories",
)
anchor = '''for file in "${files[@]}"; do
  echo "Downloading ${file}..."
  curl -fsSL -H 'Cache-Control: no-cache' "${RAW_BASE}/${file}" -o "${tmp}/${file}"
done

livekit_files=('''
block = f'''for file in "${{files[@]}}"; do
  echo "Downloading ${{file}}..."
  curl -fsSL -H 'Cache-Control: no-cache' "${{RAW_BASE}}/${{file}}" -o "${{tmp}}/${{file}}"
done

manager_migrations=(
  {MIGRATION}
)
for file in "${{manager_migrations[@]}}"; do
  echo "Downloading Manager compatibility migration ${{file}}..."
  curl -fsSL -H 'Cache-Control: no-cache' "${{MIGRATION_RAW_BASE}}/${{file}}" -o "${{tmp}}/migrations/${{file}}"
done

livekit_files=('''
s = replace_once(s, anchor, block, "bootstrap migration download")
s = replace_once(
    s,
    'grep -Fq \'AIRGAP_IP_MODE="internal_ip"\' "$tmp/lib/airgap-ip.sh" || {\n  echo "Spark Air-Gap internal-IP deployment mode is incomplete." >&2\n  exit 1\n}',
    'grep -Fq \'AIRGAP_IP_MODE="internal_ip"\' "$tmp/lib/airgap-ip.sh" || {\n  echo "Spark Air-Gap internal-IP deployment mode is incomplete." >&2\n  exit 1\n}\ngrep -Fq \'configure_conference_speaker_timer_worker\' "$tmp/migrations/' + MIGRATION + '" || {\n  echo "Spark Air-Gap conference worker compatibility migration is incomplete." >&2\n  exit 1\n}',
    "bootstrap migration validation",
)
s = replace_once(
    s,
    'install -d -m 0755 "$stage/lib" "$stage/livekit"',
    'install -d -m 0755 "$stage/lib" "$stage/livekit" "$stage/migrations"',
    "bootstrap stage directories",
)
s = replace_once(
    s,
    'for file in "$tmp"/lib/*.sh; do\n  install -m 0644 "$file" "$stage/lib/$(basename "$file")"\ndone\nrsync -a --delete "$tmp/livekit/" "$stage/livekit/"',
    'for file in "$tmp"/lib/*.sh; do\n  install -m 0644 "$file" "$stage/lib/$(basename "$file")"\ndone\nfor file in "$tmp"/migrations/*.sql; do\n  install -m 0644 "$file" "$stage/migrations/$(basename "$file")"\ndone\nrsync -a --delete "$tmp/livekit/" "$stage/livekit/"',
    "bootstrap stage migration copy",
)
p.write_text(s, encoding="utf-8")

# airgap.sh: future offline bundles install the same migration pack from their
# pinned Spark source snapshot.
p = Path("deploy/spark-cli/lib/airgap.sh")
s = p.read_text(encoding="utf-8")
s = replace_once(
    s,
    'install -d -m 0755 "$stage/lib" "$stage/livekit"',
    'install -d -m 0755 "$stage/lib" "$stage/livekit" "$stage/migrations"',
    "airgap manager stage directories",
)
s = replace_once(
    s,
    'for file in "${source_dir}"/lib/*.sh; do install -m 0644 "$file" "$stage/lib/$(basename "$file")"; done\n  cp -a "${SPARK_ROOT}/deploy/livekit/." "$stage/livekit/"',
    'for file in "${source_dir}"/lib/*.sh; do install -m 0644 "$file" "$stage/lib/$(basename "$file")"; done\n  if [[ -f "${SPARK_ROOT}/supabase/migrations/' + MIGRATION + '" ]]; then\n    install -m 0644 "${SPARK_ROOT}/supabase/migrations/' + MIGRATION + '" "$stage/migrations/' + MIGRATION + '"\n  fi\n  cp -a "${SPARK_ROOT}/deploy/livekit/." "$stage/livekit/"',
    "airgap manager migration copy",
)
p.write_text(s, encoding="utf-8")

# airgap-ip.sh: detect only the two missing DB contracts and repair them by
# applying the checked-in migration; never run ad-hoc DDL.
p = Path("deploy/spark-cli/lib/airgap-ip.sh")
s = p.read_text(encoding="utf-8")
s = replace_once(
    s,
    'AIRGAP_IP_CONF="${CONFIG_DIR}/airgap-ip.conf"\nAIRGAP_IP_MODE="internal_ip"',
    'AIRGAP_IP_CONF="${CONFIG_DIR}/airgap-ip.conf"\nAIRGAP_IP_MODE="internal_ip"\nAIRGAP_WORKER_CONTRACT_MIGRATION_VERSION="' + VERSION + '"\nAIRGAP_WORKER_CONTRACT_MIGRATION_NAME="' + NAME + '"\nAIRGAP_WORKER_CONTRACT_MIGRATION_FILE="${SCRIPT_DIR}/migrations/' + MIGRATION + '"',
    "airgap migration constants",
)
anchor = 'livekit_configure_speaker_timer_worker() {'
block = r'''livekit_worker_config_contracts_ready() {
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

livekit_configure_speaker_timer_worker() {'''
s = replace_once(s, anchor, block, "airgap worker contract helpers")
needle = '  livekit_airgap_validation_check "Configure speaker timer worker" livekit_configure_speaker_timer_worker || { livekit_airgap_validation_report_failure; return 1; }'
replacement = '  livekit_airgap_validation_check "Conference worker DB contracts" livekit_ensure_worker_config_contracts || { livekit_airgap_validation_report_failure; return 1; }\n' + needle
s = replace_once(s, needle, replacement, "airgap step21 worker contract validation")
p.write_text(s, encoding="utf-8")

for path, needles in {
    "deploy/spark-cli/bootstrap.sh": ["MIGRATION_RAW_BASE", MIGRATION, 'stage/migrations'],
    "deploy/spark-cli/lib/airgap.sh": [MIGRATION, 'stage/migrations'],
    "deploy/spark-cli/lib/airgap-ip.sh": ["Conference worker DB contracts", "livekit_ensure_worker_config_contracts", MIGRATION],
}.items():
    text = Path(path).read_text(encoding="utf-8")
    for needle in needles:
        if needle not in text:
            raise SystemExit(f"{path}: missing patch marker {needle}")

print("Air-Gap conference worker contract patch: PASS")
