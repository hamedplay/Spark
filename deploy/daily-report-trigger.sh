#!/usr/bin/env bash
#
# daily-report-trigger.sh
# Called by VPS cron or systemd timer every 5 minutes.
# Triggers the daily report edge function with X-Cron-Secret header.
#
set -euo pipefail

# Load environment variables (DAILY_REPORT_CRON_SECRET, DAILY_REPORT_ENDPOINT)
source /etc/myapp/daily-report.env

# Validate required env vars
if [ -z "${DAILY_REPORT_CRON_SECRET:-}" ]; then
  echo "ERROR: DAILY_REPORT_CRON_SECRET is not set" >&2
  exit 1
fi

if [ -z "${DAILY_REPORT_ENDPOINT:-}" ]; then
  echo "ERROR: DAILY_REPORT_ENDPOINT is not set" >&2
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
  --header "X-Cron-Secret: ${DAILY_REPORT_CRON_SECRET}" \
  --data '{"scheduled":true}' \
  "${DAILY_REPORT_ENDPOINT}" 2>&1) || {
    echo "ERROR: Request to ${DAILY_REPORT_ENDPOINT} failed: ${response}" >&2
    exit 1
  }

# Log the response for debugging (journald captures stdout/stderr)
echo "daily-report-trigger: ${response}"
