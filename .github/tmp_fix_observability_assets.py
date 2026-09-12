from pathlib import Path

# Patch online bootstrap to install the complete LiveKit observability tree.
p = Path('deploy/spark-cli/bootstrap.sh')
s = p.read_text(encoding='utf-8')
old = '''livekit_files=(
  .env.example
  docker-compose.yml
  docker-compose.spark-cli.yml
  Caddyfile
  redis.conf
  livekit.yaml
  egress.yaml
  ingress.yaml
  README.md
)
for file in "${livekit_files[@]}"; do
  echo "Downloading LiveKit asset ${file}..."
  curl -fsSL -H 'Cache-Control: no-cache' "${LIVEKIT_RAW_BASE}/${file}" -o "${tmp}/livekit/${file}"
done
'''
new = '''livekit_files=(
  .env.example
  docker-compose.yml
  docker-compose.spark-cli.yml
  Caddyfile
  redis.conf
  livekit.yaml
  egress.yaml
  ingress.yaml
  README.md
  monitoring/prometheus.yml
  monitoring/rules/livekit-alerts.yml
  monitoring/alertmanager.yml
  monitoring/blackbox.yml
  monitoring/loki.yml
  monitoring/alloy.alloy
  monitoring/grafana/provisioning/datasources/datasources.yml
  monitoring/grafana/provisioning/dashboards/dashboards.yml
  monitoring/grafana/dashboards/spark-livekit-overview.json
  monitoring/grafana/dashboards/spark-livekit-operations.json
  monitoring/targets/blackbox.json
)
for file in "${livekit_files[@]}"; do
  echo "Downloading LiveKit asset ${file}..."
  install -d -m 0755 "$(dirname "${tmp}/livekit/${file}")"
  curl -fsSL -H 'Cache-Control: no-cache' "${LIVEKIT_RAW_BASE}/${file}" -o "${tmp}/livekit/${file}"
done
'''
if s.count(old) != 1:
    raise SystemExit(f'bootstrap livekit_files block count={s.count(old)}')
s = s.replace(old, new, 1)
needle = '''grep -q '^  minio-init:' "$tmp/livekit/docker-compose.yml" || {
  echo "Spark LiveKit MinIO initialization service is missing from deployment assets." >&2
  exit 1
}
'''
insert = needle + '''for file in \
  monitoring/prometheus.yml \
  monitoring/rules/livekit-alerts.yml \
  monitoring/alertmanager.yml \
  monitoring/blackbox.yml \
  monitoring/loki.yml \
  monitoring/alloy.alloy \
  monitoring/grafana/provisioning/datasources/datasources.yml \
  monitoring/grafana/provisioning/dashboards/dashboards.yml \
  monitoring/grafana/dashboards/spark-livekit-overview.json \
  monitoring/grafana/dashboards/spark-livekit-operations.json \
  monitoring/targets/blackbox.json; do
  [[ -f "$tmp/livekit/$file" ]] || {
    echo "Spark LiveKit observability asset is missing: $file" >&2
    exit 1
  }
done
'''
if s.count(needle) != 1:
    raise SystemExit('bootstrap validation marker missing')
s = s.replace(needle, insert, 1)
p.write_text(s, encoding='utf-8')

# Patch Air-Gap Step 22 to self-heal the deployed monitoring tree from the
# manager's bundled LiveKit assets without touching runtime overrides/.env.
p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')
marker = '''livekit_airgap_observability_config_ready() {
'''
helper = r'''livekit_airgap_sync_observability_assets() {
  local source="${LIVEKIT_SOURCE_DIR}/monitoring"
  [[ -d "$source" ]] || {
    printf 'Manager observability asset directory is missing: %s\n' "$source" >>"$CURRENT_LOG"
    return 1
  }
  install -d -m 0755 "${LIVEKIT_ROOT}/monitoring"
  rsync -a --delete "${source}/" "${LIVEKIT_ROOT}/monitoring/" >>"$CURRENT_LOG" 2>&1
}

'''
if s.count(marker) != 1:
    raise SystemExit('observability config marker missing')
s = s.replace(marker, helper + marker, 1)
old_step = '''  run_logged "Generate observability HTTP targets" livekit_write_observability_targets || return 1
'''
new_step = '''  run_logged "Sync bundled observability assets" livekit_airgap_sync_observability_assets || {
    fail "Bundled observability assets are missing from the installed Spark Manager. Update the Manager and retry Step 22."
    unmark_step 22
    return 1
  }
  run_logged "Generate observability HTTP targets" livekit_write_observability_targets || return 1
'''
if s.count(old_step) != 1:
    raise SystemExit(f'Step 22 target marker count={s.count(old_step)}')
s = s.replace(old_step, new_step, 1)
p.write_text(s, encoding='utf-8')

print('observability asset self-heal patch: PASS')
