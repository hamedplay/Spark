#!/usr/bin/env bash
#
# notification-outbox-trigger.sh
# Called by VPS cron every 2 minutes.
# Triggers the notification outbox worker edge function with X-Cron-Secret header.
#
set -euo pipefail

source /etc/myapp/notification-outbox.env

if [ -z "${NOTIFICATION_OUTBOX_CRON_SECRET:-}" ]; then
  echo "ERROR: NOTIFICATION_OUTBOX_CRON_SECRET is not set" >&2
  exit 1
fi

if [ -z "${NOTIFICATION_OUTBOX_ENDPOINT:-}" ]; then
  echo "ERROR: NOTIFICATION_OUTBOX_ENDPOINT is not set" >&2
  exit 1
fi

response=$(curl --fail --silent --show-error \
  --max-time 30 \
  --request POST \
  --header "Content-Type: application/json" \
  --header "X-Cron-Secret: ${NOTIFICATION_OUTBOX_CRON_SECRET}" \
  --data '{"scheduled":true}' \
  "${NOTIFICATION_OUTBOX_ENDPOINT}" 2>&1) || {
    echo "ERROR: Request to ${NOTIFICATION_OUTBOX_ENDPOINT} failed: ${response}" >&2
    exit 1
  }

echo "notification-outbox-trigger: ${response}"
