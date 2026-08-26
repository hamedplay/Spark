# Server 3 — Manual Edge Functions / Integration Installation

نقش Server 3:

```text
Zone: DMZ
Edge Runtime private ingress: 10.20.0.13:9000
Supabase Core upstream: 10.20.0.12:8000
Direct trusted DB: 10.20.0.12:5432
Outbound Internet: DNS/NTP + TCP 443/8443 فقط
Services: Edge Functions, Integrations, Avatar Worker, Schedulers, Private NTP
```

این فایل دو بخش دارد:

1. **Prepare Offline Media** — قبل از Server 2 اجرا می‌شود.
2. **Install Server 3 Runtime** — بعد از نصب Server 2 و دریافت `/root/server3.env`.

هیچ installer `.sh` پروژه اجرا نمی‌شود.

---

# Part A — Prepare Offline Media برای Server 2

این بخش روی Server 3 که Internet دارد انجام می‌شود.

## A1. نصب ابزارهای پایه

```bash
sudo -i
apt update
apt upgrade -y
apt install -y ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml chrony tar
```

Docker repository:

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
```

```bash
nano /etc/apt/sources.list.d/docker.list
```

محتوا، با codename سیستم خودتان:

```text
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable
```

برای ARM64 مقدار `arch` را مطابق سیستم قرار دهید.

```bash
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
docker compose version
```

---

## A2. انتخاب Versionها

برای Production از tag/commit بررسی‌شده استفاده کنید.

```bash
export SPARK_REF='main'
export SUPABASE_REF='<REVIEWED_SUPABASE_TAG_OR_COMMIT>'
```

`SUPABASE_REF=master` برای Production توصیه نمی‌شود.

---

## A3. ساخت Work Directory

```bash
rm -rf /root/spark-server2-bundle-work
mkdir -p /root/spark-server2-bundle-work/src
mkdir -p /root/spark-server2-bundle-work/bundle/bin
```

---

## A4. Snapshot پروژه Spark

```bash
cd /root/spark-server2-bundle-work/src
git clone https://github.com/hamedplay/Spark.git spark
cd spark
git checkout "$SPARK_REF"
git rev-parse HEAD
```

SHA خروجی را یادداشت کنید.

```bash
mkdir -p /root/spark-server2-bundle-work/bundle/spark
git archive HEAD | tar -x -C /root/spark-server2-bundle-work/bundle/spark
```

---

## A5. Snapshot رسمی Supabase

```bash
cd /root/spark-server2-bundle-work/src
git clone https://github.com/supabase/supabase.git supabase
cd supabase
git checkout "$SUPABASE_REF"
git rev-parse HEAD
```

SHA را یادداشت کنید.

```bash
cp -a /root/spark-server2-bundle-work/src/supabase/docker /root/spark-server2-bundle-work/bundle/supabase-docker
```

---

## A6. Pull تمام OCI Imageهای لازم

```bash
cd /root/spark-server2-bundle-work/bundle/supabase-docker
cp .env.example .env
```

لیست imageها:

```bash
docker compose config --images | sort -u | tee /root/supabase-images.txt
```

هر image را pull کنید:

```bash
xargs -r -n1 docker pull < /root/supabase-images.txt
```

دو image اضافی را هم برای deployment/runtime و key-generation آفلاین آماده کنید:

```bash
docker pull nginx:1.27-alpine
docker pull node:22-alpine
```

ذخیره همه imageها:

```bash
docker save $(cat /root/supabase-images.txt) nginx:1.27-alpine node:22-alpine \
  -o /root/spark-server2-bundle-work/bundle/docker-images.tar
```

فایل temporary env را پاک کنید:

```bash
rm -f /root/spark-server2-bundle-work/bundle/supabase-docker/.env
```

---

## A7. Download Supabase CLI برای Server 2

Architecture:

```bash
uname -m
```

برای x86_64:

```bash
export CLI_ARCH='amd64'
```

برای arm64:

```bash
export CLI_ARCH='arm64'
```

نسخه latest را resolve کنید یا ترجیحاً یک release بررسی‌شده را دستی تعیین کنید:

```bash
export SUPABASE_CLI_RELEASE=$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | jq -r '.tag_name')
echo "$SUPABASE_CLI_RELEASE"
```

```bash
mkdir -p /root/supabase-cli-download
curl -fsSL \
  "https://github.com/supabase/cli/releases/download/${SUPABASE_CLI_RELEASE}/supabase_linux_${CLI_ARCH}.tar.gz" \
  -o /root/supabase-cli-download/cli.tgz
```

```bash
tar -xzf /root/supabase-cli-download/cli.tgz -C /root/supabase-cli-download
install -m 0755 /root/supabase-cli-download/supabase /root/spark-server2-bundle-work/bundle/bin/supabase
```

---

## A8. ساخت Manifest

```bash
nano /root/spark-server2-bundle-work/bundle/manifest.env
```

محتوا را با SHAهای واقعی پر کنید:

```text
SUPABASE_UPSTREAM_COMMIT='<SUPABASE_COMMIT_SHA>'
SPARK_COMMIT='<SPARK_COMMIT_SHA>'
SUPABASE_CLI_RELEASE='<CLI_RELEASE>'
```

فایل توضیحی:

```bash
nano /root/spark-server2-bundle-work/bundle/README-OFFLINE.txt
```

```text
Generated on Internet-enabled Server 3 for isolated Server 2.
Contains reviewed Spark snapshot, pinned Supabase Docker snapshot,
required OCI images and native Supabase CLI.
Contains no production credentials.
```

---

## A9. ساخت Bundle و Checksum

```bash
cd /root/spark-server2-bundle-work/bundle
tar -czf /root/spark-server2-offline-bundle.tar.gz .
sha256sum /root/spark-server2-offline-bundle.tar.gz | tee /root/spark-server2-offline-bundle.tar.gz.sha256
chmod 600 /root/spark-server2-offline-bundle.tar.gz /root/spark-server2-offline-bundle.tar.gz.sha256
```

Validation:

```bash
sha256sum -c /root/spark-server2-offline-bundle.tar.gz.sha256
```

انتقال به Server 2 فقط از private/admin network:

```bash
scp /root/spark-server2-offline-bundle.tar.gz \
     /root/spark-server2-offline-bundle.tar.gz.sha256 \
     root@10.20.0.12:/root/
```

حالا `server-2-supabase-core.md` را اجرا کنید.

---

# Part B — Install Server 3 Runtime

بعد از Server 2 باید فایل privileged زیر به Server 3 منتقل شده باشد:

```text
/root/server3.env
```

## B1. محافظت از Handoff

```bash
sudo -i
chmod 600 /root/server3.env
cat /root/server3.env
```

باید شامل این نوع مقادیر باشد:

```text
SUPABASE_UPSTREAM_COMMIT
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
JWT_SECRET
POSTGRES_PASSWORD
SEND_SMS_HOOK_SECRET
```

این فایل نباید روی Server 1 یا Git قرار گیرد.

---

## B2. نصب packageها و Docker

اگر Part A همین Server 3 انجام شده، این ابزارها از قبل نصب هستند. در غیر این صورت همان مراحل Docker در Part A را انجام دهید.

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml chrony tar
systemctl enable --now docker
```

---

## B3. Private NTP برای Server 2

```bash
nano /etc/chrony/chrony.conf
```

محتوا:

```text
pool pool.ntp.org iburst
allow 10.20.0.12/32
makestep 1.0 3
rtcsync
driftfile /var/lib/chrony/chrony.drift
logdir /var/log/chrony
```

```bash
systemctl restart chrony
chronyc tracking
```

Server 2 باید UDP/123 این سرور را ببیند.

---

## B4. دریافت Spark و همان Supabase Commit

```bash
rm -rf /opt/spark
cd /opt
git clone https://github.com/hamedplay/Spark.git spark
cd /opt/spark
git checkout main
git pull --ff-only origin main
```

SHA `SUPABASE_UPSTREAM_COMMIT` را از `/root/server3.env` بردارید.

```bash
rm -rf /opt/supabase-source
cd /opt
git clone https://github.com/supabase/supabase.git supabase-source
cd /opt/supabase-source
git checkout <SUPABASE_UPSTREAM_COMMIT>
```

این commit باید دقیقاً همان commit استفاده‌شده روی Server 2 باشد.

---

## B5. پیدا کردن Edge Runtime Image

```bash
python3 -c 'import yaml; print(yaml.safe_load(open("/opt/supabase-source/docker/docker-compose.yml"))["services"]["functions"]["image"])'
```

خروجی را به عنوان `<EDGE_RUNTIME_IMAGE>` در compose پایین استفاده کنید.

---

## B6. آماده کردن Functions

```bash
mkdir -p /opt/spark-edge/functions
rsync -a --delete /opt/spark/supabase/functions/ /opt/spark-edge/functions/
```

Router رسمی self-hosted Supabase را restore کنید:

```bash
rm -rf /opt/spark-edge/functions/main
cp -a /opt/supabase-source/docker/volumes/functions/main /opt/spark-edge/functions/main
```

این مرحله مهم است؛ `main` رسمی نباید با sync پروژه حذف شود.

---

## B7. ساخت Function Secrets

```bash
mkdir -p /etc/spark
chmod 700 /etc/spark
```

Secretهای scheduler/runtime را fresh بسازید:

```bash
openssl rand -hex 32   # DAILY_REPORT_CRON_SECRET
openssl rand -hex 32   # NOTIFICATION_OUTBOX_CRON_SECRET
openssl rand -hex 32   # MINUTES_REMINDER_CRON_SECRET
openssl rand -hex 32   # DECISION_DUE_CRON_SECRET
openssl rand -hex 32   # PHONE_RATE_LIMIT_PEPPER
openssl rand -hex 32   # PHONE_PASSWORD_RESET_SECRET
```

Postgres password URL encoding:

```bash
python3 -c 'import urllib.parse; print(urllib.parse.quote(input("POSTGRES_PASSWORD: "),safe=""))'
```

فایل:

```bash
nano /etc/spark/functions.env
```

محتوا:

```text
JWT_SECRET=<FROM_SERVER3_ENV>
SUPABASE_URL=http://api-router:8080
SUPABASE_PUBLIC_URL=https://api.shahrmeeting.ir
SUPABASE_ANON_KEY=<FROM_SERVER3_ENV>
SUPABASE_SERVICE_ROLE_KEY=<FROM_SERVER3_ENV>
SUPABASE_DB_URL=postgresql://postgres:<URL_ENCODED_POSTGRES_PASSWORD>@10.20.0.12:5432/postgres
VERIFY_JWT=false
SEND_SMS_HOOK_SECRET=<FROM_SERVER3_ENV>
PHONE_RATE_LIMIT_PEPPER=<FRESH_HEX>
PHONE_PASSWORD_RESET_SECRET=<FRESH_HEX>
PHONE_LOGIN_ALLOWED_ORIGINS=https://shahrmeeting.ir,https://www.shahrmeeting.ir
ALLOWED_ORIGINS=https://shahrmeeting.ir,https://www.shahrmeeting.ir
DAILY_REPORT_CRON_SECRET=<FRESH_HEX>
NOTIFICATION_OUTBOX_CRON_SECRET=<FRESH_HEX>
MINUTES_REMINDER_CRON_SECRET=<FRESH_HEX>
DECISION_DUE_CRON_SECRET=<FRESH_HEX>
```

```bash
chmod 600 /etc/spark/functions.env
```

Provider-specific secrets:

```bash
nano /etc/spark/functions-extra.env
chmod 600 /etc/spark/functions-extra.env
```

فقط variableهایی را وارد کنید که Function فعال واقعاً نیاز دارد؛ مثل credentials مربوط به SMS/Rahyab/Bale/Telegram. نام variable را حدس نزنید.

---

## B8. Avatar Worker Environment

```bash
nano /etc/spark/avatar-worker.env
```

```text
SUPABASE_URL=http://api-router:8080
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
AVATAR_WORKER_ID=avatar-worker-s3
```

```bash
chmod 600 /etc/spark/avatar-worker.env
```

---

## B9. Internal API Router

```bash
mkdir -p /opt/spark-edge
nano /opt/spark-edge/api-router.conf
```

```nginx
server {
    listen 8080;
    client_max_body_size 50m;

    location ^~ /functions/v1/ {
        proxy_pass http://functions:9000/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://10.20.0.12:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto http;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

این router باعث می‌شود Functionها برای Supabase API یا Function دیگر نیاز به public hairpin نداشته باشند.

---

## B10. Docker Compose Edge

```bash
nano /opt/spark-edge/docker-compose.yml
```

محتوا، `<EDGE_RUNTIME_IMAGE>` را با مقدار مرحله B5 جایگزین کنید:

```yaml
services:
  functions:
    image: <EDGE_RUNTIME_IMAGE>
    restart: unless-stopped
    env_file:
      - /etc/spark/functions.env
      - /etc/spark/functions-extra.env
    command:
      - start
      - --main-service
      - /home/deno/functions/main
    volumes:
      - /opt/spark-edge/functions:/home/deno/functions:ro
    ports:
      - "10.20.0.13:9000:9000"

  api-router:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on:
      - functions
    volumes:
      - /opt/spark-edge/api-router.conf:/etc/nginx/conf.d/default.conf:ro

  avatar-worker:
    build:
      context: /opt/spark/worker
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - /etc/spark/avatar-worker.env
    depends_on:
      - api-router
    mem_limit: 512m
    cpus: 0.5
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

Validate:

```bash
cd /opt/spark-edge
docker compose config
```

Start:

```bash
docker compose pull functions api-router
docker compose build avatar-worker
docker compose up -d
sleep 8
docker compose ps
```

---

# B11. Schedulerهای systemd بدون helper shell script

هر service مستقیماً `curl` را اجرا می‌کند.

## Daily Report

```bash
nano /etc/systemd/system/spark-daily-report.service
```

```ini
[Unit]
Description=Spark scheduler - send-daily-meetings
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/spark/functions.env
ExecStart=/usr/bin/curl --fail --silent --show-error --connect-timeout 5 --max-time 120 -X POST http://127.0.0.1:9000/send-daily-meetings -H content-type:application/json -H x-cron-secret:${DAILY_REPORT_CRON_SECRET} --data={"scheduled":true}
```

```bash
nano /etc/systemd/system/spark-daily-report.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true
AccuracySec=15s

[Install]
WantedBy=timers.target
```

## Minutes Reminder

```bash
nano /etc/systemd/system/spark-minutes-reminder.service
```

```ini
[Unit]
Description=Spark scheduler - process-minutes-reminders
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/spark/functions.env
ExecStart=/usr/bin/curl --fail --silent --show-error --connect-timeout 5 --max-time 120 -X POST http://127.0.0.1:9000/process-minutes-reminders -H content-type:application/json -H x-cron-secret:${MINUTES_REMINDER_CRON_SECRET} --data={}
```

```bash
nano /etc/systemd/system/spark-minutes-reminder.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true
AccuracySec=15s

[Install]
WantedBy=timers.target
```

## Decision Due/Overdue

```bash
nano /etc/systemd/system/spark-decision-due.service
```

```ini
[Unit]
Description=Spark scheduler - process-decision-due-overdue
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/spark/functions.env
ExecStart=/usr/bin/curl --fail --silent --show-error --connect-timeout 5 --max-time 120 -X POST http://127.0.0.1:9000/process-decision-due-overdue -H content-type:application/json -H x-cron-secret:${DECISION_DUE_CRON_SECRET} --data={}
```

```bash
nano /etc/systemd/system/spark-decision-due.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true
AccuracySec=15s

[Install]
WantedBy=timers.target
```

## Notification Outbox

```bash
nano /etc/systemd/system/spark-notification-outbox.service
```

```ini
[Unit]
Description=Spark scheduler - process-notification-outbox
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/etc/spark/functions.env
ExecStart=/usr/bin/curl --fail --silent --show-error --connect-timeout 5 --max-time 120 -X POST http://127.0.0.1:9000/process-notification-outbox -H content-type:application/json -H x-cron-secret:${NOTIFICATION_OUTBOX_CRON_SECRET} --data={}
```

```bash
nano /etc/systemd/system/spark-notification-outbox.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true
AccuracySec=15s

[Install]
WantedBy=timers.target
```

فعال‌سازی:

```bash
systemctl daemon-reload
systemctl enable --now spark-daily-report.timer
systemctl enable --now spark-minutes-reminder.timer
systemctl enable --now spark-decision-due.timer
systemctl enable --now spark-notification-outbox.timer
systemctl list-timers 'spark-*' --no-pager
```

---

# B12. Host Firewall Server 3

```bash
ufw --force reset
ufw default deny incoming
ufw default deny outgoing
ufw allow from <ADMIN_CIDR> to any port 22 proto tcp
ufw allow from 10.20.0.11 to 10.20.0.13 port 9000 proto tcp
ufw allow from 10.20.0.12 to 10.20.0.13 port 9000 proto tcp
ufw allow from 10.20.0.12 to 10.20.0.13 port 123 proto udp
ufw allow out to 10.20.0.0/24
ufw allow out 53/udp
ufw allow out 53/tcp
ufw allow out 123/udp
ufw allow out 443/tcp
ufw allow out 8443/tcp
ufw --force enable
```

---

# B13. محدود کردن Docker Egress

```bash
iptables -N SPARK_EDGE_EGRESS 2>/dev/null || true
iptables -F SPARK_EDGE_EGRESS
iptables -A SPARK_EDGE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -d 10.20.0.0/24 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p udp --dport 53 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 53 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p udp --dport 123 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 443 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 8443 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -s 172.16.0.0/12 -j REJECT
iptables -A SPARK_EDGE_EGRESS -j RETURN
iptables -C DOCKER-USER -j SPARK_EDGE_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j SPARK_EDGE_EGRESS
```

Persistence بدون shell script:

```bash
nano /etc/systemd/system/spark-edge-firewall.service
```

```ini
[Unit]
Description=Spark Server 3 Docker egress boundary
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=-/usr/sbin/iptables -N SPARK_EDGE_EGRESS
ExecStart=/usr/sbin/iptables -F SPARK_EDGE_EGRESS
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -d 10.20.0.0/24 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -p udp --dport 53 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -p tcp --dport 53 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -p udp --dport 123 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -p tcp --dport 443 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -p tcp --dport 8443 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -s 172.16.0.0/12 -j REJECT
ExecStart=/usr/sbin/iptables -A SPARK_EDGE_EGRESS -j RETURN
ExecStart=-/usr/sbin/iptables -D DOCKER-USER -j SPARK_EDGE_EGRESS
ExecStart=/usr/sbin/iptables -I DOCKER-USER 1 -j SPARK_EDGE_EGRESS
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now spark-edge-firewall.service
```

---

# B14. Validation

Server 2 API:

```bash
curl -fsS http://10.20.0.12:8000/auth/v1/health
```

DB:

```bash
timeout 3 bash -c '</dev/tcp/10.20.0.12/5432'
```

Edge Runtime:

```bash
curl -i http://127.0.0.1:9000/password-login
```

Containerها:

```bash
docker compose -f /opt/spark-edge/docker-compose.yml ps
```

Timers:

```bash
systemctl list-timers 'spark-*' --no-pager
journalctl -u spark-notification-outbox.service -n 50 --no-pager
```

Firewall:

```bash
ufw status verbose
iptables -S DOCKER-USER
systemctl status spark-edge-firewall.service --no-pager
```

NTP:

```bash
chronyc tracking
```

---

# B15. حذف Handoff

بعد از انتقال تمام مقادیر به `/etc/spark/*.env`:

```bash
shred -u /root/server3.env
```

---

# B16. Update دستی Functions و Worker

```bash
cd /opt/spark
git fetch origin
git checkout main
git pull --ff-only origin main
```

```bash
rsync -a --delete /opt/spark/supabase/functions/ /opt/spark-edge/functions/
rm -rf /opt/spark-edge/functions/main
cp -a /opt/supabase-source/docker/volumes/functions/main /opt/spark-edge/functions/main
```

```bash
cd /opt/spark-edge
docker compose build avatar-worker
docker compose up -d --force-recreate functions avatar-worker
```

Validation را مجدداً انجام دهید.
