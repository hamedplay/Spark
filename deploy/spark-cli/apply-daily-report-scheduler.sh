#!/usr/bin/env bash
set -Eeuo pipefail

TIMER=/etc/systemd/system/spark-daily-report.timer
SERVICE=/etc/systemd/system/spark-daily-report.service

[[ ${EUID:-$(id -u)} -eq 0 ]] || exec sudo -E "$0" "$@"
[[ -f "$SERVICE" ]] || { echo "spark-daily-report.service is not installed" >&2; exit 1; }

cat >"$TIMER" <<'EOF'
[Unit]
Description=Spark daily management report scheduler — exact minute clock

[Timer]
# Fire on every wall-clock minute in Tehran. The Edge Function reads the
# configured send_time and sends only at/after that minute; idempotency blocks
# duplicate delivery on subsequent retry ticks.
OnCalendar=*-*-* *:*:00 Asia/Tehran
Persistent=true
AccuracySec=1s
RandomizedDelaySec=0
Unit=spark-daily-report.service

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now spark-daily-report.timer >/dev/null
systemctl restart spark-daily-report.timer
systemctl is-enabled --quiet spark-daily-report.timer
systemctl is-active --quiet spark-daily-report.timer

grep -Fq 'OnCalendar=*-*-* *:*:00 Asia/Tehran' "$TIMER"
grep -Fq 'AccuracySec=1s' "$TIMER"

echo "=== Daily report scheduler ==="
systemctl show spark-daily-report.timer \
  -p ActiveState \
  -p LastTriggerUSec \
  -p NextElapseUSecRealtime \
  --no-pager

echo "=== Host clock ==="
timedatectl status --no-pager || true
printf 'UTC now    : %s\n' "$(date -u --iso-8601=seconds)"
printf 'Tehran now : %s\n' "$(TZ=Asia/Tehran date --iso-8601=seconds)"

# Compatibility bridge for Spark Manager versions that already invoke this
# post-fast-forward hook but predate the dedicated database-repair runner.
# This makes critical database repairs take effect on the first app update.
SCRIPT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
DB_REPAIR_SCRIPT="${SCRIPT_DIR}/apply-db-repairs.sh"
if [[ -f "$DB_REPAIR_SCRIPT" ]]; then
  echo "=== Database compatibility repairs ==="
  bash "$DB_REPAIR_SCRIPT"
fi

MAINTENANCE_REPAIR_SCRIPT="${SCRIPT_DIR}/apply-maintenance-mode-repair.sh"
if [[ -f "$MAINTENANCE_REPAIR_SCRIPT" ]]; then
  echo "=== Maintenance-mode compatibility repair ==="
  bash "$MAINTENANCE_REPAIR_SCRIPT"
fi

MOBILE_IDENTITY_REPAIR_SCRIPT="${SCRIPT_DIR}/apply-mobile-identity-repair.sh"
if [[ -f "$MOBILE_IDENTITY_REPAIR_SCRIPT" ]]; then
  echo "=== Mobile identity compatibility repair ==="
  bash "$MOBILE_IDENTITY_REPAIR_SCRIPT"
fi

MFA_POLICY_REPAIR_SCRIPT="${SCRIPT_DIR}/apply-mfa-policy-repair.sh"
if [[ -f "$MFA_POLICY_REPAIR_SCRIPT" ]]; then
  echo "=== MFA policy compatibility repair ==="
  bash "$MFA_POLICY_REPAIR_SCRIPT"
fi
