"""Run with python3 -m unittest discover -s deploy/spark-cli/tests -v.

Exercise the real module load order and full builder with fake Docker/network
boundaries. No daemon, network, root access, npm install, or bank server needed.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


CLI = Path(__file__).resolve().parents[1]
ENTRYPOINT = (CLI / "spark-airgap").read_text()
LOAD_MODULES = ENTRYPOINT[ENTRYPOINT.index("for module in "):ENTRYPOINT.index("spark_airgap_supabase_clone()")]

SETUP = r'''
set -Eeuo pipefail
IFS=$'\n\t'
CONFIG_DIR="$WORK/config"
STATE_DIR="$WORK/state"
AIRGAP_HOME="$WORK/airgap"
MANAGER_CONF="$CONFIG_DIR/manager.conf"
SUPABASE_ROOT="$WORK/runtime"
SPARK_ROOT="$WORK/spark"
SUPABASE_SOURCE="$WORK/supabase"
CURRENT_LOG="$WORK/test.log"
mkdir -p "$CONFIG_DIR" "$STATE_DIR"
'''

FIXTURES = r'''
fail() { printf '%s\n' "$*" >&2; }
info() { :; }; ok() { :; }; warn() { :; }; title() { :; }; new_log() { :; }
run_visible() { shift; "$@"; }
run_logged() { shift; "$@"; }
EDGE_IMAGE=supabase/edge-runtime:v1.76.2
EDGE_ID="sha256:$(printf 'a%.0s' {1..64})"
OLD_ID="sha256:$(printf 'b%.0s' {1..64})"
OTHER_ID="sha256:$(printf 'c%.0s' {1..64})"
CHILD="sha256:$(printf 'd%.0s' {1..64})"
export EDGE_IMAGE EDGE_ID OLD_ID OTHER_ID CHILD
printf '%s\n' "$OLD_ID" >"$WORK/edge-id"
docker() {
  printf '%s\n' "$*" >>"$WORK/docker-calls"
  case "$1" in
    info|build|rm) return 0 ;;
    load) cat >/dev/null; [[ "${FAIL_LOAD:-0}" == 0 ]] || return 9; printf '%s\n' "$EDGE_ID" >"$WORK/edge-id" ;;
    buildx)
      [[ "${4:-}" == --raw ]] || return 1
      printf '{"manifests":[{"digest":"%s","platform":{"os":"linux","architecture":"amd64"}}]}\n' "$CHILD" ;;
    pull)
      # A plain tag pull exposes the old/index identity. Digest normalization
      # exposes the child identity. Resolving Edge twice is forbidden by tests.
      if [[ "$*" == *"supabase/edge-runtime@"* ]]; then
        printf 'digest\n' >>"$WORK/edge-pulls"
      elif [[ "$*" == *"$EDGE_IMAGE"* ]]; then
        printf '%s\n' "$OLD_ID" >"$WORK/edge-id"
        printf 'tag\n' >>"$WORK/edge-pulls"
      fi ;;
    tag)
      if [[ "$3" == "$EDGE_IMAGE" ]]; then printf '%s\n' "$2" >"$WORK/edge-id"; fi ;;
    create) printf 'test-container\n' ;;
    run)
      if [[ "$*" == *'/payload/apt:ro'* ]]; then
        [[ "$*" == *'none'* && "$*" == *'--pull=never'* ]] || return 8
        cat >"$WORK/offline-proof-script"
        [[ "${FAIL_PROOF:-0}" == 0 ]] || return 9
      else printf 'deno 2.1.4\n'; fi ;;
    image)
      case "$2" in
        rm) return 0 ;;
        save) tar -C "$WORK/docker-fixture" -cf - manifest.json ;;
        inspect)
          if [[ "$4" == '{{.Os}}/{{.Architecture}}' ]]; then
            printf '%s\n' "${TEST_PLATFORM:-linux/amd64}"
          elif [[ "$5" == "$EDGE_IMAGE" ]]; then
            cat "$WORK/edge-id"
          elif [[ "$5" == supabase/edge-runtime@* ]]; then
            printf '%s\n' "$EDGE_ID"
          else printf '%s\n' "$OTHER_ID"; fi ;;
        *) return 2 ;;
      esac ;;
    *) return 2 ;;
  esac
}
AIRGAP_REAL_DOCKER=docker
make_repos() {
  mkdir -p "$WORK/docker-fixture"
  printf '[]\n' >"$WORK/docker-fixture/manifest.json"
  mkdir -p "$SPARK_ROOT/supabase/functions/hello" "$SPARK_ROOT/deploy/spark-cli/edge-main"
  cp "$SCRIPT_DIR/edge-main/index.ts" "$SPARK_ROOT/deploy/spark-cli/edge-main/index.ts"
  cp "$SCRIPT_DIR/bootstrap-airgap-bundle.sh" "$SPARK_ROOT/deploy/spark-cli/"
  printf 'Deno.serve(() => new Response("ok"));\n' >"$SPARK_ROOT/supabase/functions/hello/index.ts"
  mkdir -p "$SUPABASE_SOURCE/docker/volumes/functions"
  printf 'services:\n  functions:\n    image: %s\n' "$EDGE_IMAGE" >"$SUPABASE_SOURCE/docker/docker-compose.yml"
  printf '{"imports":{}}\n' >"$SUPABASE_SOURCE/docker/volumes/functions/deno.jsonc"
  for repo in "$SPARK_ROOT" "$SUPABASE_SOURCE"; do
    command git init -q -b main "$repo"
    command git -C "$repo" add .
    command git -C "$repo" -c user.name=Test -c user.email=test@example.invalid commit -qm fixture
  done
  command git -C "$SUPABASE_SOURCE" remote add origin https://github.com/supabase/supabase.git
  command git -C "$SUPABASE_SOURCE" tag self-hosted/v0.8.1
}
_airgap_edge_cache_dependencies() { printf 'cached\n' >"$2/cache"; }
airgap_build_apt_payload() {
  mkdir -p "$WORK/deb-fixture/DEBIAN"
  printf 'Package: fixture\nVersion: 1\nArchitecture: amd64\nMaintainer: Test <test@example.invalid>\nDescription: fixture\n' >"$WORK/deb-fixture/DEBIAN/control"
  dpkg-deb --build "$WORK/deb-fixture" "$1/example.deb" >/dev/null
  printf 'fixture\n' >"$1/requested-packages.txt"
}
airgap_build_npm_payload_without_edge_v2() {
  mkdir -p "$WORK/npm-fixture/package/bin" "$WORK/npm-fixture/node_modules/typescript/bin" "$WORK/npm-fixture/node_modules/vite/bin"
  touch "$WORK/npm-fixture/package/bin/npm-cli.js" "$WORK/npm-fixture/package/package.json"
  touch "$WORK/npm-fixture/node_modules/typescript/bin/tsc" "$WORK/npm-fixture/node_modules/vite/bin/vite.js"
  tar -C "$WORK/npm-fixture" -czf "$1/npm-test.tgz" package
  tar -C "$WORK/npm-fixture" -czf "$1/frontend-node-modules.tar.gz" node_modules
}
airgap_collect_compose_images() { printf '%s\n' "$EDGE_IMAGE" other/image:v1 >"$2"; }
airgap_prompt_default() {
  case "$1" in
    target_release) printf -v "$1" '%s' "${TARGET_RELEASE:-26.04}" ;;
    output_root) printf -v "$1" '%s' "$WORK/output" ;;
    *) return 1 ;;
  esac
}
git() {
  if [[ "$1" == clone && "$*" == *'https://github.com/supabase/supabase.git'* ]]; then
    command git clone --branch self-hosted/v0.8.1 --single-branch "$SUPABASE_SOURCE" "${@: -1}"
  else command git "$@"; fi
}
'''


class AirgapIdentityTests(unittest.TestCase):
    def run_shell(self, body):
        with tempfile.TemporaryDirectory(prefix="spark-airgap-test-") as work:
            result = subprocess.run(
                ["bash", "-c", SETUP + LOAD_MODULES + FIXTURES + body],
                env={**os.environ, "WORK": work, "SCRIPT_DIR": str(CLI)},
                text=True, capture_output=True, timeout=40,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_full_build_validate_extract_and_import_identity(self):
        for release in ("24.04", "26.04"):
            with self.subTest(release=release):
                self.run_shell("TARGET_RELEASE=" + release + r'''
make_repos
airgap_build_bundle <<<' '
[[ "$(cat "$WORK/edge-pulls")" == digest ]]
mkdir "$WORK/extracted"
archive=("$WORK/output/"*.tar.gz)
(cd "$WORK/output" && sha256sum -c ./*.sha256)
root="$(airgap_extract_bundle_archive "${archive[0]}" "$WORK/extracted")"
airgap_validate_bundle_dir "$root"
[[ "$(airgap_meta_from "$root" UBUNTU_VERSION)" == "$TARGET_RELEASE" ]]
[[ "$(_airgap_edge_meta_from "$root/metadata/edge-runtime.env" EDGE_RUNTIME_IMAGE_ID)" == "$EDGE_ID" ]]
airgap_verify_images "$root"
# Run the real Import chain (including load, local image verification, content
# checks, copy, and activation). Only host compatibility and Docker are fake.
airgap_validate_target_compatibility() { :; }
export -f docker
printf '#!/usr/bin/env bash\ndocker "$@"\n' >"$WORK/docker"
chmod +x "$WORK/docker"
AIRGAP_REAL_DOCKER="$WORK/docker"
airgap_import_bundle "$root"
[[ -L "$AIRGAP_CURRENT_LINK" ]]
airgap_verify_images "$(airgap_current_root)"
# Corrupt loaded runtime: import verification MUST reject it under CLI IFS.
printf '%s\n' "$OLD_ID" >"$WORK/edge-id"
if airgap_verify_images "$root"; then exit 10; fi
# Corrupt the recorded identity and regenerate checksums: semantic validation
# must still reject it, so this is not merely a checksum test.
sed -i "s/$EDGE_ID/$OLD_ID/" "$root/docker/image-ids.txt"
(cd "$root" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
if airgap_validate_bundle_dir "$root"; then exit 11; fi
''')

    def test_prepared_image_drift_is_rejected_without_repull(self):
        self.run_shell(r'''
root="$WORK/bundle"
mkdir -p "$root/metadata"
printf 'EDGE_RUNTIME_IMAGE=%s\nEDGE_RUNTIME_IMAGE_ID=%s\n' "$EDGE_IMAGE" "$EDGE_ID" >"$root/metadata/edge-runtime.env"
if airgap_prepare_bundle_image "$EDGE_IMAGE" "$root"; then exit 12; fi
[[ ! -f "$WORK/edge-pulls" ]]
printf '%s\n' "$EDGE_ID" >"$WORK/edge-id"
airgap_prepare_bundle_image "$EDGE_IMAGE" "$root"
TEST_PLATFORM=linux/arm64
if airgap_prepare_bundle_image "$EDGE_IMAGE" "$root"; then exit 13; fi
[[ ! -f "$WORK/edge-pulls" ]]
''')

    def test_import_manifest_errors_and_whitespace(self):
        self.run_shell(r'''
root="$WORK/bundle"
mkdir -p "$root/docker"
printf 'other/image:v1\n' >"$root/docker/images.txt"
if airgap_verify_images "$root"; then exit 14; fi
for entry in '' ' ' 'other/image:v1' 'other/image:v1 invalid' "other/image:v1 $OTHER_ID extra"; do
  printf '%s\n' "$entry" >"$root/docker/image-ids.txt"
  if airgap_verify_images "$root"; then exit 15; fi
done
printf 'other/image:v1 %s\n' "$OTHER_ID" >"$root/docker/image-ids.txt"
airgap_verify_images "$root"
printf 'other/image:v1\t%s' "$OTHER_ID" >"$root/docker/image-ids.txt"
airgap_verify_images "$root"
''')


if __name__ == "__main__":
    unittest.main()
