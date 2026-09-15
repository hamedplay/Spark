# Air-Gap optional runtime extensions.
# Keep observability readiness-noise behavior, then load the format-v2 Edge
# Runtime source/cache implementation and its final mount/cache hardening.

source "${SCRIPT_DIR}/lib/airgap-observability-quiet-base.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-functions.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-functions-runtime-fix.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-final.sh"
