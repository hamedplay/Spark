# Scheduler Installation Guide

This document describes how to install and verify the three scheduler components that trigger the notification, reminder, and due/overdue edge functions.

> **Important:** These files are ready for installation but are NOT automatically installed on any VPS. Manual setup is required on the production server.

## Prerequisites

- A Linux server (VPS) with `curl` installed
- The Supabase project URL (e.g. `https://your-project.supabase.co`)
- Three cron secrets configured as edge function environment variables:
  - `MINUTES_REMINDER_CRON_SECRET`
  - `NOTIFICATION_OUTBOX_CRON_SECRET`
  - `DECISION_DUE_CRON_SECRET`

---

## 1. Minutes Reminder Scheduler (every 5 minutes)

Triggers `process-minutes-reminders` to claim due reminders and queue them in the outbox.

### Install via systemd timer (recommended)

```bash
sudo mkdir -p /etc/myapp
sudo cp deploy/minutes-reminder-trigger.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/minutes-reminder-trigger.sh
sudo cp deploy/minutes-reminder.env.example /etc/myapp/minutes-reminder.env
# Edit /etc/myapp/minutes-reminder.env and set the real secret and endpoint
sudo cp deploy/minutes-reminder-trigger.service /etc/systemd/system/
sudo cp deploy/minutes-reminder-trigger.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now minutes-reminder-trigger.timer
```

### Alternative: install via cron

```bash
sudo cp deploy/minutes-reminder-trigger.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/minutes-reminder-trigger.sh
sudo cp deploy/minutes-reminder.env.example /etc/myapp/minutes-reminder.env
# Edit /etc/myapp/minutes-reminder.env
sudo cp deploy/minutes-reminder.cron /etc/cron.d/minutes-reminder
```

### Verify

```bash
systemctl status minutes-reminder-trigger.timer
systemctl list-timers --all | grep minutes-reminder
journalctl -u minutes-reminder-trigger.service --since today
```

### Health check

```bash
curl --request POST \
  --header "Content-Type: application/json" \
  --header "X-Cron-Secret: <SECRET>" \
  --data '{"scheduled":true}' \
  "https://your-project.supabase.co/functions/v1/process-minutes-reminders"
```

Expected response (no pending reminders):

```json
{
  "processed": 0
}
```

Or when reminders are processed:

```json
{
  "processed": 1,
  "queued": 1,
  "duplicates": 0,
  "failed": 0
}
```

---

## 2. Notification Outbox Scheduler (every 2 minutes)

Triggers `process-notification-outbox` to claim outbox rows, insert in-app notifications, and dispatch SMS.

### Install via cron

```bash
sudo cp deploy/notification-outbox-trigger.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/notification-outbox-trigger.sh
sudo cp deploy/notification-outbox.env.example /etc/myapp/notification-outbox.env
# Edit /etc/myapp/notification-outbox.env
sudo cp deploy/notification-outbox.cron /etc/cron.d/notification-outbox
```

### Verify

```bash
cat /etc/cron.d/notification-outbox
grep notification-outbox /var/log/syslog
# Or on systems with journald-based cron logging:
journalctl -u cron | grep notification-outbox
```

### Health check

```bash
curl --request POST \
  --header "Content-Type: application/json" \
  --header "X-Cron-Secret: <SECRET>" \
  --data '{"scheduled":true}' \
  "https://your-project.supabase.co/functions/v1/process-notification-outbox"
```

Expected response (empty queue):

```json
{
  "processed": 0
}
```

Or when rows are processed:

```json
{
  "processed": 3,
  "notifications": 3,
  "sms_sent": 0,
  "failed": 0
}
```

---

## 3. Decision Due/Overdue Scheduler (daily after midnight Tehran time)

Triggers `process-decision-due-overdue` to emit `decision_due_soon` and `decision_overdue` events.

### Install via cron

```bash
sudo cp deploy/decision-due-overdue-trigger.sh /usr/local/bin/
sudo chmod +x /usr/local/bin/decision-due-overdue-trigger.sh
sudo cp deploy/decision-due-overdue.env.example /etc/myapp/decision-due-overdue.env
# Edit /etc/myapp/decision-due-overdue.env
sudo cp deploy/decision-due-overdue.cron /etc/cron.d/decision-due-overdue
```

### Verify

```bash
cat /etc/cron.d/decision-due-overdue
grep decision-due-overdue /var/log/syslog
# Or:
journalctl -u cron | grep decision-due-overdue
```

### Health check

```bash
curl --request POST \
  --header "Content-Type: application/json" \
  --header "X-Cron-Secret: <SECRET>" \
  --data '{"scheduled":true}' \
  "https://your-project.supabase.co/functions/v1/process-decision-due-overdue"
```

Expected response:

```json
{
  "ok": true
}
```

---

## Security notes

- All scripts use `set -euo pipefail` for robust error handling.
- Each script validates that the secret and endpoint are non-empty before making the request.
- The `X-Cron-Secret` header is sent but never printed in logs.
- Each script has a 30-second curl timeout.
- Scripts exit with non-zero on failure, so cron/systemd will log the error.
- The `.env.example` files contain only placeholders. Real secrets must be set on the server and as edge function environment variables.
- No secrets are committed to the repository.
