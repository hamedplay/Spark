"""Real cache file transfers with a deterministic Docker lifecycle boundary."""
from pathlib import Path
import shutil
import unittest
import test_airgap_image_identity as identity

SETUP = r'''
root="$WORK/bundle"
cache="$WORK/cache"
mkdir -p "$root/metadata" "$root/deno-cache" "$cache" "$SUPABASE_ROOT/volumes/functions"
printf 'original' >"$root/deno-cache/dependency"
ln -s dependency "$root/deno-cache/link"
printf 'stale' >"$cache/old-file"
printf 'EDGE_RUNTIME_IMAGE=test-image\nEDGE_RUNTIME_IMAGE_ID=test-id\nTARGET_DENO_VERSION=2.1.4\nDENO_CACHE_FILES=1\n' >"$root/metadata/edge-runtime.env"
printf 'running' >"$WORK/state-running"
docker() {
  case "$1" in
    inspect)
      case "$*" in
        *'.Config.Image'*) printf 'test-image' ;;
        *'.Image'*) printf 'test-id' ;;
        *'/home/deno/functions'*) printf '%s' "$SUPABASE_ROOT/volumes/functions" ;;
        *'.Type "volume"'*) printf 'test-cache' ;;
        *'.Type'*) printf 'volume' ;;
        *'.Destination}}'*) printf '/root/.cache/deno' ;;
        *) return 2 ;;
      esac ;;
    volume) printf '%s' "$cache" ;;
    exec) printf 'deno 2.1.4\n' ;;
    compose)
      case "${@: -2:1}" in
        stop) printf 'stopped' >"$WORK/state-running" ;;
        start)
          [[ "${FAIL_START:-0}" != 1 ]] || return 9
          [[ "$(cat "$WORK/state-running")" == stopped ]]
          printf 'start\n' >>"$WORK/starts"
          if [[ "${ADD_ON_START:-0}" == 1 ]]; then printf 'runtime' >"$cache/runtime-index"; fi
          printf 'running' >"$WORK/state-running" ;;
        *) return 2 ;;
      esac ;;
    *) return 2 ;;
  esac
}
rsync() {
  [[ "$(cat "$WORK/state-running")" == stopped ]] || return 8
  if [[ "$1" == -a && "${FAIL_COPY:-0}" == 1 ]]; then return 9; fi
  if [[ "$1" == -rlcni && "${FAIL_VERIFY:-0}" == 1 ]]; then return 9; fi
  command rsync "$@" || return $?
  if [[ "$1" == -a && "${CORRUPT_COPY:-0}" == 1 ]]; then
    # Same length/count/mtime: only content verification can catch this.
    printf 'tampered' >"$cache/dependency"
    touch -r "$root/deno-cache/dependency" "$cache/dependency"
  fi
}
'''


@unittest.skipUnless(shutil.which('rsync'), 'rsync required')
class CacheActivationTests(unittest.TestCase):
    run_shell = identity.AirgapIdentityTests.run_shell

    def test_startup_extra_file_does_not_invalidate_verified_snapshot(self):
        self.run_shell(SETUP + r'''
ADD_ON_START=1
_airgap_edge_seed_live_cache "$root"
[[ -f "$cache/runtime-index" && ! -e "$cache/old-file" ]]
[[ "$(find "$cache" -type f | wc -l)" == 2 ]]
[[ "$(wc -l <"$WORK/starts")" == 1 ]]
''')

    def test_unchanged_cache_starts_normally(self):
        self.run_shell(SETUP + r'''
_airgap_edge_seed_live_cache "$root"
[[ "$(cat "$WORK/state-running")" == running ]]
[[ "$(cat "$cache/dependency")" == original ]]
''')

    def test_count_mismatch_does_not_start_worker(self):
        self.run_shell(SETUP + r'''
sed -i 's/DENO_CACHE_FILES=1/DENO_CACHE_FILES=2/' "$root/metadata/edge-runtime.env"
if _airgap_edge_seed_live_cache "$root"; then exit 1; fi
[[ ! -e "$WORK/starts" && "$(cat "$WORK/state-running")" == stopped ]]
''')

    def test_same_count_content_corruption_does_not_start_worker(self):
        self.run_shell(SETUP + r'''
CORRUPT_COPY=1
if _airgap_edge_seed_live_cache "$root"; then exit 1; fi
[[ ! -e "$WORK/starts" && "$(cat "$WORK/state-running")" == stopped ]]
''')

    def test_copy_failure_remains_stopped_and_retry_succeeds(self):
        self.run_shell(SETUP + r'''
FAIL_COPY=1
if _airgap_edge_seed_live_cache "$root"; then exit 1; fi
[[ ! -e "$WORK/starts" && "$(cat "$WORK/state-running")" == stopped ]]
FAIL_COPY=0
_airgap_edge_seed_live_cache "$root"
[[ "$(cat "$WORK/state-running")" == running ]]
''')

    def test_verification_failure_does_not_start_worker(self):
        self.run_shell(SETUP + r'''
FAIL_VERIFY=1
if _airgap_edge_seed_live_cache "$root"; then exit 1; fi
[[ ! -e "$WORK/starts" && "$(cat "$WORK/state-running")" == stopped ]]
''')

    def test_start_failure_is_propagated(self):
        self.run_shell(SETUP + r'''
FAIL_START=1
if _airgap_edge_seed_live_cache "$root"; then exit 1; fi
[[ "$(cat "$WORK/state-running")" == stopped ]]
''')


if __name__ == '__main__':
    unittest.main()
