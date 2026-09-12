from pathlib import Path

# 1) Ensure future bundles include observability profile images.
p = Path('deploy/spark-cli/lib/airgap-build.sh')
s = p.read_text(encoding='utf-8')
old = '''    (cd "$livekit_dir" && docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.spark-cli.yml config --images)'''
new = '''    (cd "$livekit_dir" && docker compose --env-file .env.example -f docker-compose.yml -f docker-compose.spark-cli.yml --profile observability config --images)'''
if s.count(old) != 1:
    raise SystemExit(f'expected one LiveKit image collection command, found {s.count(old)}')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# 2) Add an Air-Gap-specific Step 22 that never pulls from the Internet and
# provides exact config/image diagnostics.
p = Path('deploy/spark-cli/lib/airgap-ip.sh')
s = p.read_text(encoding='utf-8')
marker = '\nairgap_status() {\n'
if marker not in s:
    raise SystemExit('airgap_status marker not found')
block = r'''
livekit_airgap_observability_config_ready() {
  local file failed=0
  for file in \
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
    if [[ ! -f "${LIVEKIT_ROOT}/${file}" ]]; then
      printf 'Missing observability file: %s\n' "${LIVEKIT_ROOT}/${file}" >>"$CURRENT_LOG"
      failed=1
    fi
  done
  (( failed == 0 )) || return 1

  if ! python3 -m json.tool "${LIVEKIT_ROOT}/monitoring/targets/blackbox.json" >/dev/null 2>>"$CURRENT_LOG"; then
    printf 'Invalid JSON: monitoring/targets/blackbox.json\n' >>"$CURRENT_LOG"
    return 1
  fi
  if ! python3 -m json.tool "${LIVEKIT_ROOT}/monitoring/grafana/dashboards/spark-livekit-overview.json" >/dev/null 2>>"$CURRENT_LOG"; then
    printf 'Invalid JSON: spark-livekit-overview.json\n' >>"$CURRENT_LOG"
    return 1
  fi
  if ! python3 -m json.tool "${LIVEKIT_ROOT}/monitoring/grafana/dashboards/spark-livekit-operations.json" >/dev/null 2>>"$CURRENT_LOG"; then
    printf 'Invalid JSON: spark-livekit-operations.json\n' >>"$CURRENT_LOG"
    return 1
  fi

  if ! livekit_observability_compose config --quiet >>"$CURRENT_LOG" 2>&1; then
    printf 'Docker Compose observability configuration validation failed.\n' >>"$CURRENT_LOG"
    return 1
  fi
}

livekit_airgap_observability_image_list() {
  local output="$1"
  livekit_observability_compose config --images 2>>"$CURRENT_LOG" \
    | sed '/^[[:space:]]*$/d' | sort -u >"$output"
  [[ -s "$output" ]]
}

livekit_airgap_observability_images_ready() {
  local list_file="$1" image failed=0
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    if ! "$AIRGAP_REAL_DOCKER" image inspect "$image" >/dev/null 2>&1; then
      printf 'Missing observability Docker image: %s\n' "$image" >>"$CURRENT_LOG"
      failed=1
      continue
    fi
    if ! "$AIRGAP_REAL_DOCKER" image save "$image" >/dev/null 2>>"$CURRENT_LOG"; then
      printf 'Unreadable observability Docker image content: %s\n' "$image" >>"$CURRENT_LOG"
      failed=1
    fi
  done <"$list_file"
  (( failed == 0 ))
}

install_step_22() {
  title
  new_log "install-22-livekit-observability-airgap"

  test_livekit_full_validation || {
    fail "Complete Step 21 LiveKit validation first."
    return 1
  }

  run_logged "Generate observability HTTP targets" livekit_write_observability_targets || return 1
  if ! run_logged "Validate observability configuration" livekit_airgap_observability_config_ready; then
    fail "Observability configuration is not valid. See the Step 22 log for the exact missing/invalid file or Compose error."
    unmark_step 22
    return 1
  fi

  local image_list root
  image_list="$(mktemp)"
  if ! livekit_airgap_observability_image_list "$image_list"; then
    rm -f "$image_list"
    fail "Unable to resolve the observability Docker image list."
    unmark_step 22
    return 1
  fi

  if ! livekit_airgap_observability_images_ready "$image_list"; then
    root="$(airgap_current_root 2>/dev/null || true)"
    if [[ -n "$root" ]]; then
      warn "One or more observability images are missing/unreadable; attempting an offline reload from the active Air-Gap bundle."
      airgap_reload_image_archive "$root" >>"$CURRENT_LOG" 2>&1 || true
    fi
    if ! livekit_airgap_observability_images_ready "$image_list"; then
      rm -f "$image_list"
      fail "The active Air-Gap bundle does not provide a complete local observability image set. Rebuild/import the bundle with the updated builder; no Internet pull was attempted."
      unmark_step 22
      return 1
    fi
  fi
  rm -f "$image_list"

  if ! run_logged "Start bundled Prometheus/Grafana/Loki/Alertmanager observability" \
    livekit_observability_compose up -d prometheus alertmanager loki alloy node-exporter blackbox-exporter grafana; then
    livekit_report_observability_failure
    unmark_step 22
    return 1
  fi

  info "Waiting for observability readiness (max 90 seconds)..."
  local deadline=$((SECONDS + 90))
  while (( SECONDS < deadline )); do
    if livekit_observability_ready; then
      mark_step 22
      ok "Prometheus/Grafana/Loki/Alertmanager and exporters are ready."
      return 0
    fi
    sleep 3
  done

  unmark_step 22
  warn "Observability did not become ready within the deadline."
  livekit_report_observability_failure
  return 1
}
'''
s = s.replace(marker, '\n' + block + marker, 1)
p.write_text(s, encoding='utf-8')

print('Air-Gap observability patch: PASS')
