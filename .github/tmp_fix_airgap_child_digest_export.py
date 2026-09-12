from pathlib import Path

P = Path('deploy/spark-cli/lib/airgap-build.sh')
s = P.read_text(encoding='utf-8')

old = r'''airgap_require_platform_save_support() {
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
new = r'''airgap_linux_amd64_registry_digest() {
  local image="$1" raw digest
  raw="$(docker buildx imagetools inspect --raw "$image")" || return 1
  digest="$(python3 -c '
import json, sys
obj = json.load(sys.stdin)
items = obj.get("manifests") or []
for item in items:
    p = item.get("platform") or {}
    if p.get("os") == "linux" and p.get("architecture") == "amd64" and p.get("variant") in (None, ""):
        d = item.get("digest")
        if d:
            print(d)
            raise SystemExit(0)
raise SystemExit(1)
' <<<"$raw" 2>/dev/null || true)"
  if [[ -n "$digest" ]]; then
    printf '%s\n' "$digest"
    return 0
  fi

  # Single-platform manifests have no child list. Use the registry digest and
  # validate os/arch after pulling it by digest.
  docker buildx imagetools inspect "$image" \
    | sed -n 's/^Digest:[[:space:]]*//p' | head -n1
}

airgap_digest_reference() {
  local image="$1" digest="$2"
  python3 - "$image" "$digest" <<'PY'
import sys
ref, digest = sys.argv[1], sys.argv[2]
ref = ref.split('@', 1)[0]
slash = ref.rfind('/')
colon = ref.rfind(':')
if colon > slash:
    ref = ref[:colon]
print(f"{ref}@{digest}")
PY
}

airgap_prepare_linux_amd64_image() {
  local image="$1" digest digest_ref image_id platform cid
  digest="$(airgap_linux_amd64_registry_digest "$image")" || {
    fail "Unable to resolve the linux/amd64 registry manifest for ${image}."
    return 1
  }
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || {
    fail "Registry returned an invalid linux/amd64 digest for ${image}: ${digest:-missing}"
    return 1
  }
  digest_ref="$(airgap_digest_reference "$image" "$digest")" || return 1

  # Docker's containerd image store can report a platform as pulled while
  # docker save --platform cannot export it. Pull the exact child manifest by
  # digest and retag that single-platform image instead of relying on index
  # platform selection during export.
  docker image rm -f "$image" >/dev/null 2>&1 || true
  docker pull "$digest_ref" || return 1
  image_id="$(docker image inspect --format '{{.Id}}' "$digest_ref" 2>/dev/null || true)"
  [[ -n "$image_id" ]] || { fail "Pulled linux/amd64 image has no local image ID: ${image}"; return 1; }
  platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image_id" 2>/dev/null || true)"
  [[ "$platform" == "linux/amd64" ]] || {
    fail "Resolved image ${image} is not linux/amd64 after digest pull (reported: ${platform:-unknown})."
    return 1
  }
  docker tag "$image_id" "$image" || return 1

  # Exercise both export and daemon container creation before bundle assembly.
  docker image save "$image" >/dev/null || {
    fail "Docker image ${image} is not exportable after exact amd64 digest pull."
    return 1
  }
  cid="$(docker create --pull=never --entrypoint /bin/true "$image" 2>/dev/null)" || {
    fail "Docker image ${image} cannot create a container after exact amd64 digest pull."
    return 1
  }
  docker rm -f "$cid" >/dev/null 2>&1 || true
}

airgap_export_linux_amd64_images() {
  local list_file="$1" archive="$2" image platform
  local -a images=()
  mapfile -t images < <(sed '/^[[:space:]]*$/d' "$list_file")
  ((${#images[@]} > 0)) || { fail "Docker image manifest is empty."; return 1; }

  # Every external tag has already been normalized to an exact linux/amd64
  # child manifest. The locally-built Avatar image is validated here as well.
  for image in "${images[@]}"; do
    platform="$(docker image inspect --format '{{.Os}}/{{.Architecture}}' "$image" 2>/dev/null || true)"
    [[ "$platform" == "linux/amd64" ]] || {
      fail "Docker image ${image} is not the required linux/amd64 variant (reported: ${platform:-unknown})."
      return 1
    }
    docker image save "$image" >/dev/null || {
      fail "Docker image ${image} cannot be exported."
      return 1
    }
  done

  rm -f "$archive"
  docker image save "${images[@]}" | gzip -1 >"$archive" || return 1
  [[ -s "$archive" ]] || { fail "Docker image archive was not produced."; return 1; }
  gzip -t "$archive" || { fail "Docker image archive gzip integrity validation failed."; return 1; }
}
'''
if s.count(old) != 1:
    raise SystemExit(f'old platform-export helper block count={s.count(old)}')
s = s.replace(old, new, 1)

old_check = '''  airgap_require_platform_save_support || return 1\n'''
if s.count(old_check) != 1:
    raise SystemExit(f'platform-save support check count={s.count(old_check)}')
s = s.replace(old_check, '', 1)

old_pull = r'''  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    [[ "$image" == "$avatar_image" ]] && continue
    run_visible "Pull image ${image}" docker pull --platform linux/amd64 "$image" || return 1
  done <"${bundle}/docker/images.txt"
'''
new_pull = r'''  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    [[ "$image" == "$avatar_image" ]] && continue
    run_visible "Resolve and pull exact linux/amd64 image ${image}" \
      airgap_prepare_linux_amd64_image "$image" || return 1
  done <"${bundle}/docker/images.txt"
'''
if s.count(old_pull) != 1:
    raise SystemExit(f'legacy platform pull loop count={s.count(old_pull)}')
s = s.replace(old_pull, new_pull, 1)

P.write_text(s, encoding='utf-8')
out = P.read_text(encoding='utf-8')
for needle in (
    'airgap_linux_amd64_registry_digest()',
    'airgap_prepare_linux_amd64_image()',
    'docker pull "$digest_ref"',
    'docker image save "$image"',
    'Resolve and pull exact linux/amd64 image',
):
    if needle not in out:
        raise SystemExit(f'missing patch marker: {needle}')
if 'airgap_require_platform_save_support' in out or 'docker image save --platform=linux/amd64' in out:
    raise SystemExit('legacy save --platform dependency remains')
print('Air-Gap exact child-digest export patch: PASS')
