# Air-Gap optional runtime extensions.
# Keep the existing observability readiness-noise behavior, then enable the
# offline Edge Function dependency payload used by bundle build and Step 7.

source "${SCRIPT_DIR}/lib/airgap-observability-quiet-base.sh"
source "${SCRIPT_DIR}/lib/airgap-edge-functions.sh"
