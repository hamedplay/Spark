# Single Host — Manual Installation

این راهنما تمام اجزای Spark را روی **یک VPS** نصب می‌کند، بدون اجرای installer bash script.

Topology:

```text
Internet
   |
Nginx :80/:443
   |-- shahrmeeting.ir -> React/Vite SPA
   |-- api.shahrmeeting.ir -> local Supabase Kong :8000
   `-- ACME challenge

Docker
   |-- PostgreSQL (Docker-private; NOT public)
   |-- Auth / PostgREST / Realtime / Storage
   |-- Kong :127.0.0.1:8000
   |-- Supavisor :127.0.0.1:5433/6543
   |-- Edge Runtime
   `-- Avatar Worker

Host
   |-- systemd schedulers -> 127.0.0.1:8000/functions/v1/*
   `-- coturn :3478/:5349 + UDP relay
```

Public contract با معماری چهارسروری یکسان است:

```text
https://shahrmeeting.ir
https://api.shahrmeeting.ir
https://api.shahrmeeting.ir/functions/v1/<function>
turn:turn.shahrmeeting.ir:3478
turns:turn.shahrmeeting.ir:5349
```

---

# 1. DNS

همه recordها به Public IP همین VPS اشاره کنند:

```text
shahrmeeting.ir       -> VPS Public IP
www.shahrmeeting.ir   -> VPS Public IP
api.shahrmeeting.ir   -> VPS Public IP
turn.shahrmeeting.ir  -> VPS Public IP
```

---

# 2. مقادیر نمونه

```text
APP_DOMAIN       = shahrmeeting.ir
WWW_DOMAIN       = www.shahrmeeting.ir
API_DOMAIN       = api.shahrmeeting.ir
TURN_DOMAIN      = turn.shahrmeeting.ir
TURN_PUBLIC_IP   = <VPS_PUBLIC_IP>
TURN_PRIVATE_IP  = <VPS_PRIVATE_IP_OR_PUBLIC_IP>
ADMIN_CIDR       = <ADMIN_CIDR>
LE_EMAIL         = ops@example.com
TURN_MIN_PORT    = 49160
TURN_MAX_PORT    = 49200
```

---

# 3. نصب packageهای پایه

```bash
sudo -i
apt update
apt upgrade -y
apt install -y ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml nginx certbot coturn
```

## Docker

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
. /etc/os-release
```

```bash
nano /etc/apt/sources.list.d/docker.list
```

Ubuntu 24.04 x86_64:

```text
deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable
```

## Node 24

```bash
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod a+r /etc/apt/keyrings/nodesource.gpg
```

```bash
nano /etc/apt/sources.list.d/nodesource.list
```

```text
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main
```

نصب:

```bash
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs
npm install -g npm@^11.6.2
systemctl enable --now docker nginx
```

بررسی:

```bash
docker compose version
node --version
npm --version
```

Node پروژه باید `>=24.18.1 <25` باشد.

---

# 4. دریافت Spark

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/hamedplay/Spark.git spark
cd /opt/spark
git checkout main
git pull --ff-only origin main
```

---

# 5. دریافت Supabase pin شده

برای Production یک tag/commit بررسی‌شده انتخاب کنید:

```bash
export SUPABASE_REF='<REVIEWED_SUPABASE_TAG_OR_COMMIT>'
```

```bash
cd /opt
git clone https://github.com/supabase/supabase.git supabase-source
cd /opt/supabase-source
git checkout "$SUPABASE_REF"
git rev-parse HEAD
```

SHA را ثبت کنید.

```bash
rm -rf /opt/spark-supabase
mkdir -p /opt/spark-supabase
cp -a /opt/supabase-source/docker/. /opt/spark-supabase/
```

```bash
cd /opt/spark-supabase
cp .env.example .env
chmod 600 .env
```

---

# 6. تولید Secretهای Supabase بدون generate-keys.sh

Secretها را یکی‌یکی تولید و امن ذخیره کنید:

```bash
openssl rand -hex 16        # POSTGRES_PASSWORD
openssl rand -base64 30     # JWT_SECRET
openssl rand -base64 48     # SECRET_KEY_BASE
openssl rand -hex 8         # REALTIME_DB_ENC_KEY
openssl rand -hex 16        # VAULT_ENC_KEY
openssl rand -base64 24     # PG_META_CRYPTO_KEY
openssl rand -base64 24     # LOGFLARE_PUBLIC_ACCESS_TOKEN
openssl rand -base64 24     # LOGFLARE_PRIVATE_ACCESS_TOKEN
openssl rand -hex 16        # S3_PROTOCOL_ACCESS_KEY_ID
openssl rand -hex 32        # S3_PROTOCOL_ACCESS_KEY_SECRET
openssl rand -hex 16        # MINIO_ROOT_PASSWORD
openssl rand -hex 16        # DASHBOARD_PASSWORD
```

JWT secret را موقتاً در session قرار دهید:

```bash
export JWT_SECRET='<JWT_SECRET>'
```

ANON key:

```bash
python3 -c 'import os,time,json,base64,hmac,hashlib; e=lambda b:base64.urlsafe_b64encode(b).rstrip(b"=").decode(); h=e(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode()); now=int(time.time()); p=e(json.dumps({"role":"anon","iss":"supabase","iat":now,"exp":now+5*365*24*3600},separators=(",",":")).encode()); s=e(hmac.new(os.environ["JWT_SECRET"].encode(),f"{h}.{p}".encode(),hashlib.sha256).digest()); print(f"{h}.{p}.{s}")'
```

SERVICE_ROLE key:

```bash
python3 -c 'import os,time,json,base64,hmac,hashlib; e=lambda b:base64.urlsafe_b64encode(b).rstrip(b"=").decode(); h=e(json.dumps({"alg":"HS256","typ":"JWT"},separators=(",",":")).encode()); now=int(time.time()); p=e(json.dumps({"role":"service_role","iss":"supabase","iat":now,"exp":now+5*365*24*3600},separators=(",",":")).encode()); s=e(hmac.new(os.environ["JWT_SECRET"].encode(),f"{h}.{p}".encode(),hashlib.sha256).digest()); print(f"{h}.{p}.{s}")'
```

---

# 7. تکمیل `.env` Supabase

```bash
nano /opt/spark-supabase/.env
```

مقادیر default ناامن را با مقادیر fresh جایگزین کنید:

```text
POSTGRES_PASSWORD=<FRESH>
JWT_SECRET=<FRESH>
ANON_KEY=<GENERATED_ANON_JWT>
SERVICE_ROLE_KEY=<GENERATED_SERVICE_ROLE_JWT>
DASHBOARD_PASSWORD=<FRESH>
SECRET_KEY_BASE=<FRESH>
REALTIME_DB_ENC_KEY=<FRESH>
VAULT_ENC_KEY=<FRESH>
PG_META_CRYPTO_KEY=<FRESH>
LOGFLARE_PUBLIC_ACCESS_TOKEN=<FRESH>
LOGFLARE_PRIVATE_ACCESS_TOKEN=<FRESH>
S3_PROTOCOL_ACCESS_KEY_ID=<FRESH>
S3_PROTOCOL_ACCESS_KEY_SECRET=<FRESH>
MINIO_ROOT_PASSWORD=<FRESH>

SUPABASE_PUBLIC_URL=https://api.shahrmeeting.ir
API_EXTERNAL_URL=https://api.shahrmeeting.ir/auth/v1
SITE_URL=https://shahrmeeting.ir
ADDITIONAL_REDIRECT_URLS=https://shahrmeeting.ir/*,https://www.shahrmeeting.ir/*
FUNCTIONS_VERIFY_JWT=false
PHONE_LOGIN_ALLOWED_ORIGINS=https://shahrmeeting.ir,https://www.shahrmeeting.ir
```

Secretهای Spark:

```bash
openssl rand -base64 32   # SEND_SMS_HOOK_SECRET body
openssl rand -hex 32      # PHONE_RATE_LIMIT_PEPPER
openssl rand -hex 32      # PHONE_PASSWORD_RESET_SECRET
openssl rand -hex 32      # DAILY_REPORT_CRON_SECRET
openssl rand -hex 32      # NOTIFICATION_OUTBOX_CRON_SECRET
openssl rand -hex 32      # MINUTES_REMINDER_CRON_SECRET
openssl rand -hex 32      # DECISION_DUE_CRON_SECRET
```

در `.env` اضافه کنید:

```text
SEND_SMS_HOOK_SECRET=v1,whsec_<RANDOM_BASE64>
PHONE_RATE_LIMIT_PEPPER=<RANDOM_HEX>
PHONE_PASSWORD_RESET_SECRET=<RANDOM_HEX>
DAILY_REPORT_CRON_SECRET=<RANDOM_HEX>
NOTIFICATION_OUTBOX_CRON_SECRET=<RANDOM_HEX>
MINUTES_REMINDER_CRON_SECRET=<RANDOM_HEX>
DECISION_DUE_CRON_SECRET=<RANDOM_HEX>
```

اگر Supabase commit انتخابی از auth keyهای جدید `JWT_KEYS/JWT_JWKS` استفاده می‌کند، آن‌ها را بر اساس همان commit تولید و خطوط compose مربوط به `GOTRUE_JWT_KEYS`, `API_JWT_JWKS`, `JWT_JWKS`, `SUPABASE_JWKS` را فعال کنید. از دستور version دیگری استفاده نکنید.

---

# 8. Sync تمام Edge Functions و حفظ Main Router رسمی

```bash
rsync -a --delete /opt/spark/supabase/functions/ /opt/spark-supabase/volumes/functions/
rm -rf /opt/spark-supabase/volumes/functions/main
cp -a /opt/supabase-source/docker/volumes/functions/main /opt/spark-supabase/volumes/functions/main
```

---

# 9. Provider / Worker Environment

```bash
mkdir -p /etc/spark
chmod 700 /etc/spark
```

Service role را از `.env` بردارید:

```bash
grep '^SERVICE_ROLE_KEY=' /opt/spark-supabase/.env
```

```bash
nano /etc/spark/avatar-worker.env
```

```text
SUPABASE_URL=http://kong:8000
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
AVATAR_WORKER_ID=avatar-worker-single
```

```bash
chmod 600 /etc/spark/avatar-worker.env
```

Provider secrets:

```bash
nano /etc/spark/functions-extra.env
chmod 600 /etc/spark/functions-extra.env
```

فقط secretهایی که Functionهای فعال واقعاً نیاز دارند وارد کنید.

---

# 10. ویرایش دستی Docker Compose

Backup:

```bash
cp /opt/spark-supabase/docker-compose.yml /opt/spark-supabase/docker-compose.yml.before-spark
nano /opt/spark-supabase/docker-compose.yml
```

تغییرات:

## Kong فقط Loopback

در `kong`:

```yaml
ports:
  - "127.0.0.1:8000:8000/tcp"
```

## PostgreSQL public نشود

در service `db` هر host `ports:` mapping را حذف کنید.

## Supavisor فقط Loopback

```yaml
ports:
  - "127.0.0.1:5433:5432/tcp"
  - "127.0.0.1:6543:6543/tcp"
```

## Auth SMS Hook

در environment مربوط به `auth`:

```yaml
GOTRUE_HOOK_SEND_SMS_ENABLED: "true"
GOTRUE_HOOK_SEND_SMS_URI: "http://functions:9000/auth-send-sms-hook"
GOTRUE_HOOK_SEND_SMS_SECRETS: "${SEND_SMS_HOOK_SECRET}"
```

## Function extra env

در service `functions` مطمئن شوید:

```yaml
env_file:
  - /etc/spark/functions-extra.env
```

اگر env_file قبلی وجود دارد، آن را حذف نکنید؛ این مورد را به لیست اضافه کنید.

در environment همان service این متغیرها را map کنید:

```yaml
SEND_SMS_HOOK_SECRET: "${SEND_SMS_HOOK_SECRET}"
PHONE_RATE_LIMIT_PEPPER: "${PHONE_RATE_LIMIT_PEPPER}"
PHONE_PASSWORD_RESET_SECRET: "${PHONE_PASSWORD_RESET_SECRET}"
PHONE_LOGIN_ALLOWED_ORIGINS: "${PHONE_LOGIN_ALLOWED_ORIGINS}"
DAILY_REPORT_CRON_SECRET: "${DAILY_REPORT_CRON_SECRET}"
NOTIFICATION_OUTBOX_CRON_SECRET: "${NOTIFICATION_OUTBOX_CRON_SECRET}"
MINUTES_REMINDER_CRON_SECRET: "${MINUTES_REMINDER_CRON_SECRET}"
DECISION_DUE_CRON_SECRET: "${DECISION_DUE_CRON_SECRET}"
```

## Avatar Worker service

به `services:` اضافه کنید:

```yaml
  avatar-worker:
    build:
      context: /opt/spark/worker
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file:
      - /etc/spark/avatar-worker.env
    depends_on:
      kong:
        condition: service_healthy
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

اگر compose snapshot نام gateway یا dependency متفاوتی داشت، همان snapshot را review کنید و نام service را حدس نزنید.

---

# 11. Validate و Start Supabase

```bash
cd /opt/spark-supabase
docker compose config
```

```bash
docker compose pull
docker compose build avatar-worker
docker compose up -d
sleep 12
docker compose ps
```

Health:

```bash
curl -fsS http://127.0.0.1:8000/auth/v1/health
```

---

# 12. اعمال Migrationهای Spark

Postgres password:

```bash
grep '^POSTGRES_PASSWORD=' /opt/spark-supabase/.env
```

URL encode:

```bash
python3 -c 'import urllib.parse; print(urllib.parse.quote(input("POSTGRES_PASSWORD: "),safe=""))'
```

Dry-run:

```bash
cd /opt/spark
npx --yes supabase@latest db push \
  --db-url 'postgresql://postgres:<ENCODED_PASSWORD>@127.0.0.1:5433/postgres' \
  --dry-run
```

پس از review:

```bash
npx --yes supabase@latest db push \
  --db-url 'postgresql://postgres:<ENCODED_PASSWORD>@127.0.0.1:5433/postgres' \
  --include-all
```

---

# 13. Build Frontend

Anon key:

```bash
grep '^ANON_KEY=' /opt/spark-supabase/.env
```

```bash
nano /opt/spark/.env.production
```

```text
VITE_SUPABASE_URL=https://api.shahrmeeting.ir
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
```

```bash
chmod 600 /opt/spark/.env.production
cd /opt/spark
npm ci
npm run build
```

Deploy:

```bash
mkdir -p /var/www/spark /var/www/acme
rsync -a --delete /opt/spark/dist/ /var/www/spark/
chown -R www-data:www-data /var/www/spark /var/www/acme
```

---

# 14. Bootstrap Nginx برای Certificate

```bash
nano /etc/nginx/sites-available/spark-bootstrap
```

```nginx
server {
    listen 80;
    server_name shahrmeeting.ir www.shahrmeeting.ir api.shahrmeeting.ir turn.shahrmeeting.ir;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 404;
    }
}
```

```bash
ln -sfn /etc/nginx/sites-available/spark-bootstrap /etc/nginx/sites-enabled/spark-bootstrap
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

---

# 15. دریافت Certificateها

```bash
certbot certonly --webroot -w /var/www/acme \
  -d shahrmeeting.ir -d www.shahrmeeting.ir \
  --email ops@example.com --agree-tos --non-interactive
```

```bash
certbot certonly --webroot -w /var/www/acme \
  -d api.shahrmeeting.ir \
  --email ops@example.com --agree-tos --non-interactive
```

```bash
certbot certonly --webroot -w /var/www/acme \
  -d turn.shahrmeeting.ir \
  --email ops@example.com --agree-tos --non-interactive
```

---

# 16. Nginx Production

```bash
nano /etc/nginx/sites-available/spark
```

```nginx
map $http_upgrade $spark_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name shahrmeeting.ir www.shahrmeeting.ir api.shahrmeeting.ir turn.shahrmeeting.ir;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        if ($host = turn.shahrmeeting.ir) { return 404; }
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name shahrmeeting.ir www.shahrmeeting.ir;

    ssl_certificate /etc/letsencrypt/live/shahrmeeting.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/shahrmeeting.ir/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    root /var/www/spark;
    index index.html;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location /assets/ {
        try_files $uri =404;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control no-store;
    }
}

server {
    listen 443 ssl http2;
    server_name api.shahrmeeting.ir;

    ssl_certificate /etc/letsencrypt/live/api.shahrmeeting.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.shahrmeeting.ir/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 50m;

    location ^~ /realtime/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $spark_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    location ^~ /functions/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location ^~ /auth/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /rest/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /storage/v1/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ^~ /graphql/v1 {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        return 404;
    }
}
```

فعال‌سازی:

```bash
ln -sfn /etc/nginx/sites-available/spark /etc/nginx/sites-enabled/spark
rm -f /etc/nginx/sites-enabled/spark-bootstrap
nginx -t
systemctl reload nginx
```

---

# 17. Schedulerهای Local بدون helper script

هر service مستقیماً local Kong را صدا می‌زند.

## Daily Report

```bash
nano /etc/systemd/system/spark-daily-report.service
```

```ini
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/send-daily-meetings -H content-type:application/json -H x-cron-secret:${DAILY_REPORT_CRON_SECRET} --data={"scheduled":true}
```

```bash
nano /etc/systemd/system/spark-daily-report.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

## Minutes Reminder

```bash
nano /etc/systemd/system/spark-minutes-reminder.service
```

```ini
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/process-minutes-reminders -H content-type:application/json -H x-cron-secret:${MINUTES_REMINDER_CRON_SECRET} --data={}
```

```bash
nano /etc/systemd/system/spark-minutes-reminder.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
```

## Decision Due

```bash
nano /etc/systemd/system/spark-decision-due.service
```

```ini
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/process-decision-due-overdue -H content-type:application/json -H x-cron-secret:${DECISION_DUE_CRON_SECRET} --data={}
```

```bash
nano /etc/systemd/system/spark-decision-due.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
```

## Notification Outbox

```bash
nano /etc/systemd/system/spark-notification-outbox.service
```

```ini
[Unit]
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
EnvironmentFile=/opt/spark-supabase/.env
ExecStart=/usr/bin/curl --fail --silent --show-error -X POST http://127.0.0.1:8000/functions/v1/process-notification-outbox -H content-type:application/json -H x-cron-secret:${NOTIFICATION_OUTBOX_CRON_SECRET} --data={}
```

```bash
nano /etc/systemd/system/spark-notification-outbox.timer
```

```ini
[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true

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

# 18. TURN روی همان VPS

Certificate را برای coturn در محل امن کپی کنید:

```bash
mkdir -p /etc/coturn/certs
chown turnserver:turnserver /etc/coturn/certs
chmod 750 /etc/coturn/certs
```

```bash
install -m 0640 -o turnserver -g turnserver \
  /etc/letsencrypt/live/turn.shahrmeeting.ir/fullchain.pem \
  /etc/coturn/certs/fullchain.pem
```

```bash
install -m 0640 -o turnserver -g turnserver \
  /etc/letsencrypt/live/turn.shahrmeeting.ir/privkey.pem \
  /etc/coturn/certs/privkey.pem
```

TURN secret:

```bash
openssl rand -base64 48
```

```bash
nano /etc/spark/turn-secret.env
```

```text
TURN_DOMAIN=turn.shahrmeeting.ir
TURN_SHARED_SECRET=<FRESH_SECRET>
TURN_URL=turn:turn.shahrmeeting.ir:3478?transport=udp
TURN_TCP_URL=turn:turn.shahrmeeting.ir:3478?transport=tcp
TURNS_URL=turns:turn.shahrmeeting.ir:5349?transport=tcp
```

```bash
chmod 600 /etc/spark/turn-secret.env
```

Coturn config:

```bash
nano /etc/turnserver.conf
```

برای NAT:

```text
listening-port=3478
tls-listening-port=5349
listening-ip=<TURN_PRIVATE_IP>
relay-ip=<TURN_PRIVATE_IP>
external-ip=<TURN_PUBLIC_IP>/<TURN_PRIVATE_IP>

fingerprint
use-auth-secret
static-auth-secret=<FRESH_SECRET>
realm=turn.shahrmeeting.ir
server-name=turn.shahrmeeting.ir

min-port=49160
max-port=49200

cert=/etc/coturn/certs/fullchain.pem
pkey=/etc/coturn/certs/privkey.pem

no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
no-tlsv1
no-tlsv1_1
```

اگر Public/Private IP یکی است:

```text
external-ip=<TURN_PUBLIC_IP>
```

فعال کنید:

```bash
nano /etc/default/coturn
```

```text
TURNSERVER_ENABLED=1
```

```bash
systemctl enable --now coturn
```

---

# 19. Certbot Renewal -> Coturn بدون shell script

چون Nginx همیشه port 80 و ACME webroot را سرو می‌کند، renewal نیاز به باز/بسته کردن firewall ندارد.

```bash
mkdir -p /etc/systemd/system/certbot.service.d
nano /etc/systemd/system/certbot.service.d/spark-turn.conf
```

```ini
[Service]
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/turn.shahrmeeting.ir/fullchain.pem /etc/coturn/certs/fullchain.pem
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/turn.shahrmeeting.ir/privkey.pem /etc/coturn/certs/privkey.pem
ExecStartPost=/usr/bin/systemctl try-restart coturn.service
```

```bash
systemctl daemon-reload
systemctl enable --now certbot.timer
certbot renew --dry-run
```

---

# 20. Firewall

```bash
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from <ADMIN_CIDR> to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49160:49200/udp
ufw --force enable
ufw status verbose
```

پورت‌های زیر **نباید** public باشند:

```text
5432
5433
6543
8000
9000
```

---

# 21. Validation نهایی

Supabase local:

```bash
curl -fsS http://127.0.0.1:8000/auth/v1/health
```

Frontend:

```bash
curl -I https://shahrmeeting.ir
```

API:

```bash
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
curl -i https://api.shahrmeeting.ir/functions/v1/password-login
```

Docker:

```bash
docker compose -f /opt/spark-supabase/docker-compose.yml ps
```

Scheduler:

```bash
systemctl list-timers 'spark-*' --no-pager
```

TURN:

```bash
ss -lntup | grep -E ':(3478|5349)\b'
turnutils_stunclient turn.shahrmeeting.ir -p 3478
```

DB public exposure check:

```bash
ss -lntp | grep ':5432'
```

نباید `0.0.0.0:5432` یا `[::]:5432` وجود داشته باشد.

```bash
ss -lntp | grep -E '0\.0\.0\.0:(5432|5433|6543|8000)|\[::\]:(5432|5433|6543|8000)'
```

خروجی باید خالی باشد.

---

# 22. Update دستی

Frontend/Functions:

```bash
cd /opt/spark
git fetch origin
git checkout main
git pull --ff-only origin main
```

Functions:

```bash
rsync -a --delete /opt/spark/supabase/functions/ /opt/spark-supabase/volumes/functions/
rm -rf /opt/spark-supabase/volumes/functions/main
cp -a /opt/supabase-source/docker/volumes/functions/main /opt/spark-supabase/volumes/functions/main
```

Frontend:

```bash
cd /opt/spark
npm ci
npm run build
rsync -a --delete dist/ /var/www/spark/
chown -R www-data:www-data /var/www/spark
nginx -t
systemctl reload nginx
```

Worker/Functions:

```bash
cd /opt/spark-supabase
docker compose build avatar-worker
docker compose up -d --force-recreate functions avatar-worker
```

Supabase version upgrade را مانند یک migration مستقل انجام دهید: backup، review release notes، pin commit/tag، `docker compose config` و سپس controlled update. از `master` شناور برای Production استفاده نکنید.
