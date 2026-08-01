#!/usr/bin/env bash
#
# decision-due-overdue-trigger.sh
# Called by VPS cron daily after midnight Tehran time.
# Triggers the decision due/overdue processor edge function.
#
set -euo pipefail

source /etc/myapp/decision-due-overdue.env

if [ -z "${DECISION_DUE_CRON_SECRET:-}" ]; then
  echo "ERROR: DECISION_DUE_CRON_SECRET is not set" >&2
  exit 1
fi

if [ -z "${DECISION_DUE_ENDPOINT:-}" ]; then
  echo "ERROR: DECISION_DUE_ENDPOINT is not set" >&2
  exit 1
fi

response=$(curl --fail --silent --show-error \
  --max-time 30 \
  --request POST \
  --header "Content-Type: application/json" \
  --header "X-Cron-Secret: ${DECISION_DUE_CRON_SECRET}" \
  --data '{"scheduled":true}' \
  "${DECISION_DUE_ENDPOINT}" 2>&1) || {
    echo "ERROR: Request to ${DECISION_DUE_ENDPOINT} failed: ${response}" >&2
    exit 1
  }

echo "decision-due-overdue-trigger: ${response}"
