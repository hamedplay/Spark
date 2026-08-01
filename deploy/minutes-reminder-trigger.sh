#!/usr/bin/env bash
#
# minutes-reminder-trigger.sh
# Called by VPS cron every 5 minutes.
# Triggers the minutes decision reminder edge function with X-Cron-Secret header.
#
set -euo pipefail

# Load environment variables (MINUTES_REMINDER_CRON_SECRET, MINUTES_REMINDER_ENDPOINT)
source /etc/myapp/minutes-reminder.env

# Validate required env vars
if [ -z "${MINUTES_REMINDER_CRON_SECRET:-}" ]; then
  echo "ERROR: MINUTES_REMINDER_CRON_SECRET is not set" >&2
  exit 1
fi

if [ -z "${MINUTES_REMINDER_ENDPOINT:-}" ]; then
  echo "ERROR: MINUTES_REMINDER_ENDPOINT is not set" >&2
  exit 1
fi

# Make the HTTP request
# --fail: exit with non-zero on HTTP errors
# --silent --show-error: suppress progress but show errors
# --max-time 30: timeout after 30 seconds
response=$(curl --fail --silent --show-error \
  --max-time 30 \
  --request POST \
  --header "Content-Type: application/json" \
  --header "X-Cron-Secret: ${MINUTES_REMINDER_CRON_SECRET}" \
  --data '{"scheduled":true}' \
  "${MINUTES_REMINDER_ENDPOINT}" 2>&1) || {
    echo "ERROR: Request to ${MINUTES_REMINDER_ENDPOINT} failed: ${response}" >&2
    exit 1
  }

# Log the response for debugging (journald captures stdout/stderr)
echo "minutes-reminder-trigger: ${response}"
