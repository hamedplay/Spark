#!/usr/bin/env bash
# setup-webhook.sh — Register the Bale webhook, clear pending queue, verify.
# Usage: BOT_TOKEN=<token> bash scripts/setup-webhook.sh
#        or edit the variables below and run directly.

set -euo pipefail

# ─── Configuration ─────────────────────────────────────────────────────────────
BOT_TOKEN="${BOT_TOKEN:-}"
FUNCTION_URL="${FUNCTION_URL:-https://api.shahrmeeting.ir/functions/v1/bale-webhook}"
# ───────────────────────────────────────────────────────────────────────────────

if [[ -z "$BOT_TOKEN" ]]; then
  echo "ERROR: BOT_TOKEN is required."
  echo "Usage: BOT_TOKEN=<your_bale_token> bash scripts/setup-webhook.sh"
  exit 1
fi

BALE_API="https://tapi.bale.ai/bot${BOT_TOKEN}"

echo "=== [1/3] Deleting existing webhook and dropping pending queue ==="
curl -fsSL "${BALE_API}/deleteWebhook?drop_pending_updates=true" | python3 -m json.tool 2>/dev/null || true

echo ""
echo "=== [2/3] Setting webhook ==="
curl -fsSL -X POST "${BALE_API}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\": \"${FUNCTION_URL}\"}" | python3 -m json.tool 2>/dev/null || true

echo ""
echo "=== [3/3] Verifying webhook info ==="
curl -fsSL "${BALE_API}/getWebhookInfo" | python3 -m json.tool 2>/dev/null || true

echo ""
echo "Done. Check 'url' field above matches your FUNCTION_URL and 'pending_update_count' is 0."
