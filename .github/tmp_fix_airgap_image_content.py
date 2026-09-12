from pathlib import Path

AIRGAP = Path('deploy/spark-cli/lib/airgap.sh')
RUNTIME = Path('deploy/spark-cli/lib/airgap-runtime.sh')

a = AIRGAP.read_text(encoding='utf-8')
old_verify = '''airgap_verify_images() {
  local root="$1" image expected_id actual_id failed=0
  while read -r image expected_id; do
    [[ -n "$image" && -n "$expected_id" ]] || continue
    actual_id="$("$AIRGAP_REAL_DOCKER" image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
    if [[ -z "$actual_id" ]]; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Missing Docker image: $image" >>"$CURRENT_LOG"
      failed=1
    elif [[ "$actual_id" != "$expected_id" ]]; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Docker image ID mismatch: $image expected=$expected_id actual=$actual_id" >>"$CURRENT_LOG"
      failed=1
    fi
  done <"${root}/docker/image-ids.txt"
  (( failed == 0 ))
}
'''
new_verify = '''airgap_verify_image_content() {
  local image="$1"
  "$AIRGAP_REAL_DOCKER" image inspect "$image" >/dev/null 2>&1 || return 1
  if [[ -n "${CURRENT_LOG:-}" ]]; then
    "$AIRGAP_REAL_DOCKER" image save "$image" >/dev/null 2>>"$CURRENT_LOG"
  else
    "$AIRGAP_REAL_DOCKER" image save "$image" >/dev/null 2>&1
  fi
}

airgap_verify_image_list_content() {
  local list_file="$1" image failed=0
  [[ -f "$list_file" ]] || return 1
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    if ! airgap_verify_image_content "$image"; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Unreadable Docker image content: $image" >>"$CURRENT_LOG"
      failed=1
    fi
  done <"$list_file"
  (( failed == 0 ))
}

airgap_reload_image_archive() {
  local root="$1" archive="${root}/docker/docker-images.tar.gz"
  [[ -s "$archive" ]] || return 1
  gzip -dc "$archive" | "$AIRGAP_REAL_DOCKER" load
}

airgap_repair_image_list_content() {
  local root="$1" list_file="$2" image
  airgap_verify_image_list_content "$list_file" && return 0

  [[ -n "${CURRENT_LOG:-}" ]] && echo "Docker image content is incomplete; reloading verified Air-Gap image archive." >>"$CURRENT_LOG"
  airgap_reload_image_archive "$root" || return 1
  airgap_verify_image_list_content "$list_file" && return 0

  # A stale tag can keep pointing at metadata whose config/layer blobs were lost.
  # Remove only unreadable tags, reload the verified archive, and validate again.
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    airgap_verify_image_content "$image" && continue
    "$AIRGAP_REAL_DOCKER" image rm -f "$image" >/dev/null 2>&1 || true
  done <"$list_file"

  airgap_reload_image_archive "$root" || return 1
  airgap_verify_image_list_content "$list_file"
}

airgap_verify_images() {
  local root="$1" image expected_id actual_id failed=0
  while read -r image expected_id; do
    [[ -n "$image" && -n "$expected_id" ]] || continue
    actual_id="$("$AIRGAP_REAL_DOCKER" image inspect --format '{{.Id}}' "$image" 2>/dev/null || true)"
    if [[ -z "$actual_id" ]]; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Missing Docker image: $image" >>"$CURRENT_LOG"
      failed=1
    elif [[ "$actual_id" != "$expected_id" ]]; then
      [[ -n "${CURRENT_LOG:-}" ]] && echo "Docker image ID mismatch: $image expected=$expected_id actual=$actual_id" >>"$CURRENT_LOG"
      failed=1
    fi
  done <"${root}/docker/image-ids.txt"
  (( failed == 0 ))
}
'''
if a.count(old_verify) != 1:
    raise SystemExit(f'airgap.sh: expected one airgap_verify_images block, found {a.count(old_verify)}')
a = a.replace(old_verify, new_verify, 1)
old_import = '''  run_visible "Load offline Docker images" bash -c "gzip -dc '$final/docker/docker-images.tar.gz' | '$AIRGAP_REAL_DOCKER' load" || return 1
  run_logged "Verify every bundled Docker image locally" airgap_verify_images "$final" || return 1
  ok "Air-gap bundle imported and activated: $bundle_id"
'''
new_import = '''  run_visible "Load offline Docker images" bash -c "gzip -dc '$final/docker/docker-images.tar.gz' | '$AIRGAP_REAL_DOCKER' load" || return 1
  run_logged "Verify every bundled Docker image locally" airgap_verify_images "$final" || return 1
  run_logged "Validate bundled Docker image content" airgap_repair_image_list_content "$final" "${final}/docker/images.txt" || {
    fail "Bundled Docker image content is unreadable after offline reload. Rebuild the Air-Gap bundle on a healthy Docker host."
    return 1
  }
  ok "Air-gap bundle imported and activated: $bundle_id"
'''
if a.count(old_import) != 1:
    raise SystemExit(f'airgap.sh: expected one import verification block, found {a.count(old_import)}')
a = a.replace(old_import, new_import, 1)
AIRGAP.write_text(a, encoding='utf-8')

r = RUNTIME.read_text(encoding='utf-8')
preserve_anchor = '# Air-gap installation overrides. Sourced by lib/airgap.sh.\n'
preserve = '''# Air-gap installation overrides. Sourced by lib/airgap.sh.\n\n# Preserve the standard LiveKit runtime step before Air-Gap adds content-store\n# integrity checks. The online installer remains unchanged.\neval "$(declare -f install_step_20 | sed '1s/install_step_20/install_step_20_online/')"\n'''
if r.count(preserve_anchor) != 1:
    raise SystemExit('airgap-runtime.sh: header anchor missing')
r = r.replace(preserve_anchor, preserve, 1)
insert_anchor = '''airgap_install_one_step() {
'''
step20 = '''airgap_livekit_image_list() {
  local output="$1"
  livekit_compose config --images 2>>"${CURRENT_LOG:-/dev/null}" \\
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
if r.count(insert_anchor) != 1:
    raise SystemExit(f'airgap-runtime.sh: expected one airgap_install_one_step anchor, found {r.count(insert_anchor)}')
r = r.replace(insert_anchor, step20 + insert_anchor, 1)
RUNTIME.write_text(r, encoding='utf-8')

# Guardrails for the patch itself.
a = AIRGAP.read_text(encoding='utf-8')
r = RUNTIME.read_text(encoding='utf-8')
assert 'docker" image save' not in a  # catch accidental malformed quoting
assert 'airgap_verify_image_content()' in a
assert 'airgap_repair_image_list_content()' in a
assert 'Validate bundled Docker image content' in a
assert 'install_step_20_online' in r
assert 'Repair bundled LiveKit Docker image content' in r
print('Air-Gap Docker image content integrity patch: PASS')
