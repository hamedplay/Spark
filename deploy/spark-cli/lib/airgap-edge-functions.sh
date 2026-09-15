# Spark Air-Gap Edge Function compatibility loader.
#
# Historical versions of the Air-Gap manager rewrote every Edge Function into
# a generated JavaScript bundle. That approach is intentionally retired: it
# mixed a builder Deno with the embedded Supabase Edge Runtime Deno and caused
# runtime-only interop failures in disconnected deployments.
#
# The authoritative implementation now lives in
# airgap-edge-functions-runtime-fix.sh and uses the original TypeScript source
# plus a pre-warmed, exact-version DENO_DIR. Keep this file present because old
# bootstraps and module inventories expect it, but do not override npm building,
# Step 7, or runtime behavior here.

AIRGAP_EDGE_PACK_FORMAT_VERSION="2"
AIRGAP_EDGE_CACHE_MODE="DENO_DIR"
