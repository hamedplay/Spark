# Daily Report VPS Deployment Guide

This guide covers setting up the daily report scheduler on a VPS using either
cron or systemd timers. The scheduler is independent of Supabase Cron and can
run from any server.

## Architecture

```
VPS (cron or systemd timer)
  → daily-report-trigger.sh (every 5 minutes)
    → POST /functions/v1/send-daily-meetings
       Header: X-Cron-Secret: <secret>
       Body: {"scheduled": true}
         → Edge Function checks Asia/Tehran time
         → Checks send_time, send_days, grace period
         → Checks idempotency (daily_report_runs)
         → Resolves recipients (only selected users + groups)
         → Sends via notification, SMS, Bale
         → Returns diagnostic JSON
```

All timezone logic is inside the Edge Function using `Intl.DateTimeFormat`
with `timeZone: "Asia/Tehran"`. The VPS timezone does NOT matter — the
scheduler works correctly even if the VPS is set to UTC.

## 1. Prerequisites

### 1.1. NTP and clock synchronization

The VPS system clock must be synchronized. Check with:

```bash
timedatectl status
```

Expected output:
```
System clock synchronized: yes
NTP service: active
```

If not synchronized:

```bash
sudo timedatectl set-ntp true
```

### 1.2. VPS timezone (optional)

The VPS timezone does NOT affect the scheduler logic. The Edge Function
always uses `Asia/Tehran` regardless of server timezone. However, setting
the VPS to Tehran timezone makes logs easier to read:

```bash
sudo timedatectl set-timezone Asia/Tehran
```

If you prefer to keep the VPS on UTC, the scheduler will still work correctly.

## 2. Install the trigger script

```bash
sudo mkdir -p /etc/myapp
sudo cp deploy/daily-report-trigger.sh /usr/local/bin/daily-report-trigger.sh
sudo chmod +x /usr/local/bin/daily-report-trigger.sh
```

## 3. Configure the secret

Generate a strong secret:

```bash
openssl rand -hex 32
```

Create the environment file:

```bash
sudo cp deploy/daily-report.env.example /etc/myapp/daily-report.env
sudo nano /etc/myapp/daily-report.env
```

Set the generated secret:

```
DAILY_REPORT_CRON_SECRET="your-generated-secret-here"
DAILY_REPORT_ENDPOINT="https://zjmozuivykubdqnizhob.supabase.co/functions/v1/send-daily-meetings"
```

Secure the file:

```bash
sudo chmod 600 /etc/myapp/daily-report.env
sudo chown root:root /etc/myapp/daily-report.env
```

IMPORTANT: The same secret must be set as the `DAILY_REPORT_CRON_SECRET`
environment variable on the Supabase Edge Function. Set it in the Supabase
dashboard under Edge Function secrets.

## 4. Choose a scheduler

### Option A: systemd timer (recommended)

```bash
sudo cp deploy/daily-report-trigger.service /etc/systemd/system/
sudo cp deploy/daily-report-trigger.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now daily-report-trigger.timer
```

Verify:

```bash
systemctl status daily-report-trigger.timer
systemctl list-timers daily-report-trigger.timer
```

View logs:

```bash
journalctl -u daily-report-trigger.service -f
```

### Option B: cron

```bash
sudo cp deploy/daily-report.cron /etc/cron.d/daily-report
sudo chmod 644 /etc/cron.d/daily-report
```

View logs:

```bash
grep daily-report /var/log/syslog
# or
journalctl -t CRON -f
```

## 5. Manual test

Test the trigger script manually:

```bash
sudo /usr/local/bin/daily-report-trigger.sh
```

Expected output:
```json
{"ok":false,"trigger_type":"scheduled","timezone":"Asia/Tehran","tehran_date":"2026-07-12","tehran_time":"11:35","configured_time":"06:00","within_send_window":false,"within_grace_period":false,"already_processed":false,"reason":"skipped_not_time"}
```

## 6. Dry-run test

Test with dry_run to see what would be sent without actually sending:

```bash
curl -s -X POST \
  "https://zjmozuivykubdqnizhob.supabase.co/functions/v1/send-daily-meetings" \
  -H "X-Cron-Secret: ${DAILY_REPORT_CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"dry_run": true}' | jq .
```

## 7. Force send (admin)

To send immediately regardless of time/day:

```bash
curl -s -X POST \
  "https://zjmozuivykubdqnizhob.supabase.co/functions/v1/send-daily-meetings" \
  -H "Authorization: Bearer <admin-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{"force": true}' | jq .
```

## 8. Log inspection

### systemd

```bash
# Follow logs
journalctl -u daily-report-trigger.service -f

# Last 100 lines
journalctl -u daily-report-trigger.service -n 100

# Today's logs
journalctl -u daily-report-trigger.service --since today
```

### cron

```bash
grep daily-report /var/log/syslog
```

### Edge Function logs

Check Supabase dashboard → Functions → send-daily-meetings → Logs.

## 9. Rollback

### Disable scheduler

systemd:
```bash
sudo systemctl disable --now daily-report-trigger.timer
```

cron:
```bash
sudo rm /etc/cron.d/daily-report
```

### Remove files

```bash
sudo rm /usr/local/bin/daily-report-trigger.sh
sudo rm /etc/systemd/system/daily-report-trigger.{service,timer}
sudo rm /etc/myapp/daily-report.env
sudo systemctl daemon-reload
```

## 10. Scheduler recommendation

**systemd timer** is the recommended scheduler for VPS deployment.

Advantages over cron:
- Better logging via journald
- Restart handling with `Persistent=true`
- Status inspection with `systemctl status`
- Dependency on `network-online.target`
- No overlap (systemd prevents starting a new run if the previous one is still running)

## 11. Grace period behavior

The Edge Function has a 15-minute grace period:

- If the VPS is down at `send_time` and comes back within 15 minutes,
  the scheduled run will execute.
- If the VPS comes back after 15 minutes, the run is marked as `missed`
  and no late send is performed.
- The grace period is checked using Tehran time, not VPS time.

## 12. Idempotency

- Scheduled runs: only one per day per config (unique constraint on
  `run_key = {config_id}:{tehran_date}:scheduled`)
- Manual runs: each gets a unique UUID in `run_key`, so multiple manual
  sends per day are allowed
- Concurrent requests: the unique constraint on `run_key` ensures only
  one request wins; others get `already_processed`
