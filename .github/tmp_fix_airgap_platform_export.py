from pathlib import Path

P = Path('deploy/spark-cli/lib/airgap-build.sh')
s = P.read_text(encoding='utf-8')

anchor = r'''airgap_copy_certificate_pack() {
'''
helper = r'''airgap_require_platform_save_support() {
  docker image save --help 2>/dev/null | grep -q -- '--platform' || {
    fail "Air-Gap bundle build requires Docker image save --platform support (API 1.48+). Upgrade Docker on the connected builder host."
    return 1
  }
}

airgap_export_linux_amd64_images() {
  local list_file="$1" archive="$2" image platform
  local -a images=()
  mapfile -t images < <(sed '/^[[:space:]]*$/d' "$list_file")
  ((${#images[@]} > 0)) || { fail "Docker image manifest is empty."; return 1; }

  # Pulls are pinned to linux/amd64, so exports must use the same platform.
  # Verify every image independently before building the combined archive; this
  # catches missing config/layer content before an invalid Air-Gap bundle exists.
  for image in "${images[@]}"; do
    platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)"
    [[ "$platform" == "linux/amd64" ]] || {
      fail "Docker image ${image} is not the required linux/amd64 variant (reported: ${platform:-unknown})."
      return 1
    }
    docker image save --platform=linux/amd64 "$image" >/dev/null || {
      fail "Docker image ${image} cannot be exported as linux/amd64. Re-pull it on a healthy Docker host before building the Air-Gap bundle."
      return 1
    }
  done

  rm -f "$archive"
  docker image save --platform=linux/amd64 "${images[@]}" | gzip -1 >"$archive" || return 1
  [[ -s "$archive" ]] || { fail "Docker image archive was not produced."; return 1; }
  gzip -t "$archive" || { fail "Docker image archive gzip integrity validation failed."; return 1; }
}

'''
if anchor not in s:
    raise SystemExit('helper insertion anchor missing')
s = s.replace(anchor, helper + anchor, 1)

old_check = '''  docker info >/dev/null 2>&1 || { fail "Docker daemon is required on the connected bundle-builder host."; return 1; }\n'''
new_check = old_check + '''  airgap_require_platform_save_support || return 1\n'''
if s.count(old_check) != 1:
    raise SystemExit(f'docker info check count={s.count(old_check)}')
s = s.replace(old_check, new_check, 1)

old_save = r'''  info "Saving Docker image set. This can take several minutes."
  # The list is generated from trusted Compose image fields and contains one image per line.
  # shellcheck disable=SC2046
  docker save $(cat "${bundle}/docker/images.txt") | gzip -1 >"${bundle}/docker/docker-images.tar.gz" || return 1
'''
new_save = r'''  info "Validating and saving the linux/amd64 Docker image set. This can take several minutes."
  run_visible "Validate and export linux/amd64 Docker images" \
    airgap_export_linux_amd64_images "${bundle}/docker/images.txt" "${bundle}/docker/docker-images.tar.gz" || return 1
'''
if s.count(old_save) != 1:
    raise SystemExit(f'legacy docker save block count={s.count(old_save)}')
s = s.replace(old_save, new_save, 1)

P.write_text(s, encoding='utf-8')
out = P.read_text(encoding='utf-8')
for needle in (
    'airgap_require_platform_save_support()',
    'airgap_export_linux_amd64_images()',
    'docker image save --platform=linux/amd64 "$image"',
    'docker image save --platform=linux/amd64 "${images[@]}"',
    'Validate and export linux/amd64 Docker images',
):
    if needle not in out:
        raise SystemExit(f'missing patch marker: {needle}')
print('Air-Gap platform-aware Docker export patch: PASS')
