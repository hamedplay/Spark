from pathlib import Path

p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')

# 1) Extend the Air-Gap compose override with observability-specific runtime settings.
old = '''        rtc_config:
          udp_port: 7885
          use_external_ip: false
        log_level: info
EOF_YAML
  chmod 0600 "$AIRGAP_LIVEKIT_OVERRIDE"
}'''
new = '''        rtc_config:
          udp_port: 7885
          use_external_ip: false
        log_level: info
  prometheus:
    command:
      - --config.file=/etc/prometheus/prometheus.yml
      - --storage.tsdb.path=/prometheus
      - --storage.tsdb.retention.time=15d
      - --web.listen-address=127.0.0.1:\\${SPARK_OBSERVABILITY_PROMETHEUS_PORT:-19090}
      - --web.enable-lifecycle
  alloy:
    user: "473:473"
    group_add:
      - "\\${DOCKER_SOCKET_GID:-0}"
EOF_YAML
  chmod 0600 "$AIRGAP_LIVEKIT_OVERRIDE"
}'''
if s.count(old) != 1:
    raise SystemExit(f'livekit override tail mismatch: {s.count(old)}')
s = s.replace(old, new, 1)

# 2) Replace sync helper with runtime prep + IP-only monitoring asset rewrites.
old = '''livekit_airgap_sync_observability_assets() {
  local source="${LIVEKIT_SOURCE_DIR}/monitoring"
  [[ -d "$source" ]] || {
    printf 'Manager observability asset directory is missing: %s\\n' "$source" >>"$CURRENT_LOG"
    return 1
  }
  install -d -m 0755 "${LIVEKIT_ROOT}/monitoring"
  rsync -a --delete "${source}/" "${LIVEKIT_ROOT}/monitoring/" >>"$CURRENT_LOG" 2>&1
}
'''
new = '''livekit_airgap_select_prometheus_port() {
  local current candidate listeners
  current="$(env_get "$LIVEKIT_ENV" SPARK_OBSERVABILITY_PROMETHEUS_PORT)"
  if [[ "$current" =~ ^[0-9]+$ ]] && (( current >= 1024 && current <= 65535 )); then
    printf '%s\\n' "$current"
    return 0
  fi

  listeners="$(ss -H -lnt 2>/dev/null || true)"
  for candidate in 19090 29090 39090 49090; do
    if ! grep -Eq "127\\.0\\.0\\.1:${candidate}\\\\b" <<<"$listeners"; then
      env_set "$LIVEKIT_ENV" SPARK_OBSERVABILITY_PROMETHEUS_PORT "$candidate"
      printf '%s\\n' "$candidate"
      return 0
    fi
  done
  printf 'No free loopback port is available for Spark Prometheus (tried 19090/29090/39090/49090).\\n' >>"$CURRENT_LOG"
  return 1
}

livekit_airgap_prepare_observability_runtime() {
  local prometheus_port docker_gid
  [[ -S /var/run/docker.sock ]] || {
    printf 'Docker socket is missing: /var/run/docker.sock\\n' >>"$CURRENT_LOG"
    return 1
  }
  prometheus_port="$(livekit_airgap_select_prometheus_port)" || return 1
  docker_gid="$(stat -c '%g' /var/run/docker.sock 2>>"$CURRENT_LOG")" || return 1
  [[ "$docker_gid" =~ ^[0-9]+$ ]] || return 1
  env_set "$LIVEKIT_ENV" DOCKER_SOCKET_GID "$docker_gid"
  airgap_ip_write_livekit_override || return 1
  printf 'Spark Prometheus loopback port: %s\\n' "$prometheus_port" >>"$CURRENT_LOG"
  printf 'Docker socket supplementary GID for Alloy: %s\\n' "$docker_gid" >>"$CURRENT_LOG"
}

livekit_airgap_sync_observability_assets() {
  local source="${LIVEKIT_SOURCE_DIR}/monitoring" prometheus_port
  [[ -d "$source" ]] || {
    printf 'Manager observability asset directory is missing: %s\\n' "$source" >>"$CURRENT_LOG"
    return 1
  }
  prometheus_port="$(env_get "$LIVEKIT_ENV" SPARK_OBSERVABILITY_PROMETHEUS_PORT)"
  [[ "$prometheus_port" =~ ^[0-9]+$ ]] || {
    printf 'Spark Prometheus loopback port is not configured.\\n' >>"$CURRENT_LOG"
    return 1
  }

  install -d -m 0755 "${LIVEKIT_ROOT}/monitoring"
  rsync -a --delete "${source}/" "${LIVEKIT_ROOT}/monitoring/" >>"$CURRENT_LOG" 2>&1 || return 1

  # Keep Spark observability loopback-only while avoiding collisions with an
  # existing host Prometheus on the conventional 9090 port.
  sed -i "s#127\\.0\\.0\\.1:9090#127.0.0.1:${prometheus_port}#g" \
    "${LIVEKIT_ROOT}/monitoring/prometheus.yml" \
    "${LIVEKIT_ROOT}/monitoring/grafana/provisioning/datasources/datasources.yml" || return 1

  # Grafana probes these standard provisioning directories even when Spark has
  # no plugins/alerting provisioning files yet. Create them to avoid noisy
  # startup errors while the whole provisioning tree remains read-only in the
  # container.
  install -d -m 0755 \
    "${LIVEKIT_ROOT}/monitoring/grafana/provisioning/plugins" \
    "${LIVEKIT_ROOT}/monitoring/grafana/provisioning/alerting"
}
'''
if s.count(old) != 1:
    raise SystemExit(f'observability sync helper mismatch: {s.count(old)}')
s = s.replace(old, new, 1)

# 3) Add an Air-Gap readiness implementation that follows the selected port.
marker = '\nlivekit_airgap_observability_image_list() {\n'
if marker not in s:
    raise SystemExit('observability image-list marker missing')
ready = r'''
livekit_observability_ready() {
  local service state prometheus_port listeners port result
  prometheus_port="$(env_get "$LIVEKIT_ENV" SPARK_OBSERVABILITY_PROMETHEUS_PORT)"
  [[ "$prometheus_port" =~ ^[0-9]+$ ]] || return 1

  for service in prometheus alertmanager loki alloy node-exporter blackbox-exporter grafana; do
    state="$(livekit_observability_service_state "$service" 2>/dev/null || true)"
    [[ "$state" == running* ]] || return 1
    [[ "$state" != *unhealthy* && "$state" != *restarting* ]] || return 1
  done

  curl -fsS --connect-timeout 3 "http://127.0.0.1:${prometheus_port}/-/ready" >/dev/null || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:9093/-/ready >/dev/null || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:3100/ready >/dev/null || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:12345/-/ready >/dev/null || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:9100/metrics >/dev/null || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:9115/metrics >/dev/null || return 1
  curl -fsS --connect-timeout 3 http://127.0.0.1:3000/api/health >/dev/null || return 1

  listeners="$(ss -H -lnt 2>/dev/null || true)"
  for port in 3000 "$prometheus_port" 9093 3100 12345 9100 9115; do
    grep -Eq "127\\.0\\.0\\.1:${port}\\b" <<<"$listeners" || return 1
    ! grep -Eq "(0\\.0\\.0\\.0|\\[::\\]|\\*):${port}\\b" <<<"$listeners" || return 1
  done

  result="$(curl -fsSG --connect-timeout 3 \
    --data-urlencode 'query=min(up{job=~"livekit|livekit-egress|livekit-ingress|node|blackbox-exporter|alloy|loki"})' \
    "http://127.0.0.1:${prometheus_port}/api/v1/query")" || return 1
  python3 -c '
import json,sys
payload=json.load(sys.stdin)
if payload.get("status")!="success":
    raise SystemExit(1)
items=payload.get("data",{}).get("result",[])
if not items or float(items[0].get("value",[0,"0"])[1]) < 1:
    raise SystemExit(1)
' <<<"$result"
}
'''
s = s.replace(marker, '\n' + ready + marker, 1)

# 4) Prepare runtime before syncing/validating assets in Step 22.
old = '''  run_logged "Sync bundled observability assets" livekit_airgap_sync_observability_assets || {
    fail "Bundled observability assets are missing from the installed Spark Manager. Update the Manager and retry Step 22."
    unmark_step 22
    return 1
  }
'''
new = '''  run_logged "Prepare Air-Gap observability runtime" livekit_airgap_prepare_observability_runtime || {
    fail "Unable to prepare the local-only observability runtime. See the Step 22 log for the exact port/socket error."
    unmark_step 22
    return 1
  }
  run_logged "Sync bundled observability assets" livekit_airgap_sync_observability_assets || {
    fail "Bundled observability assets are missing from the installed Spark Manager. Update the Manager and retry Step 22."
    unmark_step 22
    return 1
  }
'''
if s.count(old) != 1:
    raise SystemExit(f'Step 22 sync block mismatch: {s.count(old)}')
s = s.replace(old, new, 1)

p.write_text(s, encoding='utf-8')

out = p.read_text(encoding='utf-8')
for needle in (
    'SPARK_OBSERVABILITY_PROMETHEUS_PORT',
    'user: "473:473"',
    'DOCKER_SOCKET_GID',
    'Prepare Air-Gap observability runtime',
    'grafana/provisioning/plugins',
):
    if needle not in out:
        raise SystemExit(f'missing patch marker: {needle}')
print('Air-Gap observability runtime patch: PASS')
