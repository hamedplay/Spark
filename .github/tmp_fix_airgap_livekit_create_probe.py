from pathlib import Path

P = Path('deploy/spark-cli/lib/airgap-runtime.sh')
s = P.read_text(encoding='utf-8')
old = r'''airgap_livekit_image_list() {
  local output="$1"
  livekit_compose config --images 2>>"${CURRENT_LOG:-/dev/null}" \
    | sed '/^[[:space:]]*$/d' | sort -u >"$output"
  [[ -s "$output" ]]
}

install_step_20() {
  airgap_is_active || { install_step_20_online; return; }
  local root list
  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }
  list="$(mktemp)"
  new_log "install-20-livekit-image-preflight"

  if ! airgap_livekit_image_list "$list"; then
    rm -f "$list"
    fail "Unable to resolve LiveKit Docker image list from the offline Compose configuration."
    return 1
  fi

  if ! airgap_verify_image_list_content "$list"; then
    warn "One or more LiveKit images have unreadable Docker content; reloading them from the verified Air-Gap archive."
    livekit_compose down --remove-orphans >>"$CURRENT_LOG" 2>&1 || true
    if ! run_logged "Repair bundled LiveKit Docker image content" airgap_repair_image_list_content "$root" "$list"; then
      rm -f "$list"
      fail "LiveKit Docker image content remains unreadable after offline reload. Rebuild/import the Air-Gap bundle."
      return 1
    fi
  fi

  rm -f "$list"
  install_step_20_online
}
'''
new = r'''airgap_livekit_image_list() {
  local output="$1"
  livekit_compose config --images 2>>"${CURRENT_LOG:-/dev/null}" \
    | sed '/^[[:space:]]*$/d' | sort -u >"$output"
  [[ -s "$output" ]]
}

airgap_probe_image_container_create() {
  local image="$1" cid
  if [[ -n "${CURRENT_LOG:-}" ]]; then
    cid="$("$AIRGAP_REAL_DOCKER" create --pull=never --entrypoint /bin/true "$image" 2>>"$CURRENT_LOG")" || return 1
  else
    cid="$("$AIRGAP_REAL_DOCKER" create --pull=never --entrypoint /bin/true "$image" 2>/dev/null)" || return 1
  fi
  [[ -n "$cid" ]] || return 1
  "$AIRGAP_REAL_DOCKER" rm -f "$cid" >/dev/null 2>&1 || true
}

airgap_verify_image_list_container_create() {
  local list_file="$1" image failed=0
  [[ -f "$list_file" ]] || return 1
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    if ! airgap_probe_image_container_create "$image"; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Docker container-create probe failed for image: $image" >>"$CURRENT_LOG"
      failed=1
    fi
  done <"$list_file"
  (( failed == 0 ))
}

airgap_livekit_compose_create_probe() {
  local report="$1" rc
  : >"$report"
  if livekit_compose create --no-build --pull never >"$report" 2>&1; then
    [[ -n "${CURRENT_LOG:-}" ]] && cat "$report" >>"$CURRENT_LOG"
    livekit_compose rm -sf >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
    return 0
  else
    rc=$?
    [[ -n "${CURRENT_LOG:-}" ]] && cat "$report" >>"$CURRENT_LOG"
    livekit_compose rm -sf >>"${CURRENT_LOG:-/dev/null}" 2>&1 || true
    return "$rc"
  fi
}

airgap_livekit_create_failure_is_content_store() {
  local report="$1"
  grep -Eqi 'failed to read config content|content digest sha256:[0-9a-f]+.*not found|NotFound: content digest' "$report"
}

airgap_repair_livekit_container_create() {
  local root="$1" list_file="$2" image removed=0

  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    if ! airgap_probe_image_container_create "$image"; then
      "$AIRGAP_REAL_DOCKER" image rm -f "$image" >/dev/null 2>&1 || true
      removed=1
    fi
  done <"$list_file"

  if (( removed == 0 )); then
    while IFS= read -r image; do
      [[ -n "$image" ]] || continue
      "$AIRGAP_REAL_DOCKER" image rm -f "$image" >/dev/null 2>&1 || true
    done <"$list_file"
  fi

  airgap_reload_image_archive "$root" || return 1
  airgap_verify_image_list_content "$list_file" || return 1
  airgap_verify_image_list_container_create "$list_file"
}

install_step_20() {
  airgap_is_active || { install_step_20_online; return; }
  local root list report
  root="$(airgap_current_root)" || { fail "No active air-gap bundle."; return 1; }
  list="$(mktemp)"
  report="$(mktemp)"
  new_log "install-20-livekit-image-preflight"

  if ! airgap_livekit_image_list "$list"; then
    rm -f "$list" "$report"
    fail "Unable to resolve LiveKit Docker image list from the offline Compose configuration."
    return 1
  fi

  if ! airgap_verify_image_list_content "$list"; then
    warn "One or more LiveKit images have unreadable Docker content; reloading them from the verified Air-Gap archive."
    livekit_compose down --remove-orphans >>"$CURRENT_LOG" 2>&1 || true
    if ! run_logged "Repair bundled LiveKit Docker image content" airgap_repair_image_list_content "$root" "$list"; then
      rm -f "$list" "$report"
      fail "LiveKit Docker image content remains unreadable after offline reload. Rebuild/import the Air-Gap bundle."
      return 1
    fi
  fi

  livekit_compose down --remove-orphans >>"$CURRENT_LOG" 2>&1 || true
  if ! airgap_livekit_compose_create_probe "$report"; then
    if airgap_livekit_create_failure_is_content_store "$report"; then
      warn "LiveKit container-create detected missing Docker content; refreshing the LiveKit image set from the verified Air-Gap archive."
      if ! run_logged "Repair LiveKit images after container-create failure" airgap_repair_livekit_container_create "$root" "$list"; then
        rm -f "$list" "$report"
        fail "LiveKit images still fail container-create after offline reload. Rebuild/import the Air-Gap bundle."
        return 1
      fi
      if ! airgap_livekit_compose_create_probe "$report"; then
        rm -f "$list" "$report"
        fail "LiveKit Compose container-create still fails after image repair. See the Step 20 preflight log."
        return 1
      fi
    else
      rm -f "$list" "$report"
      fail "LiveKit Compose container-create preflight failed for a non-image-content reason. See the Step 20 preflight log."
      return 1
    fi
  fi

  rm -f "$list" "$report"
  install_step_20_online
}
'''
if s.count(old) != 1:
    raise SystemExit(f'expected exactly one Step 20 block, found {s.count(old)}')
s = s.replace(old, new, 1)
P.write_text(s, encoding='utf-8')

out = P.read_text(encoding='utf-8')
for needle in (
    'airgap_livekit_compose_create_probe()',
    'Docker container-create probe failed for image',
    'Repair LiveKit images after container-create failure',
    'create --no-build --pull never',
):
    if needle not in out:
        raise SystemExit(f'missing expected patch marker: {needle}')
print('Step 20 container-create preflight patch: PASS')
