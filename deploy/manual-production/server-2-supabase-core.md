# Server 2 — Manual Supabase Core + PostgreSQL Installation

نقش Server 2:

```text
Zone: Internal
Internet ingress: DENY
Internet egress: DENY
Kong/API: 10.20.0.12:8000 فقط برای Server 1 و Server 3
PostgreSQL: 10.20.0.12:5432 فقط برای Server 3
Studio/Public DB: ممنوع
```

این سرور باید **کاملاً آفلاین** نصب شود. هیچ دستور `apt`, `git clone`, `npm`, `docker pull` از Internet روی Server 2 اجرا نکنید.

قبل از این فایل، بخش `Prepare Offline Media` در `server-3-edge-integration.md` را انجام دهید و این دو فایل را از شبکه خصوصی به `/root/` منتقل کنید:

```text
spark-server2-offline-bundle.tar.gz
spark-server2-offline-bundle.tar.gz.sha256
```

---

# 1. پیش‌نیاز Base Image

Server 2 باید از image سازمانی یا repository داخلی این ابزارها را داشته باشد:

```text
Docker Engine
docker compose plugin
python3
openssl
ufw
tar
rsync
curl
iptables
systemd
```

بررسی:

```bash
docker --version
docker compose version
python3 --version
openssl version
ufw --version
iptables --version
```

Docker را فعال کنید:

```bash
systemctl enable --now docker
```

---

# 2. اطمینان از قطع Internet

IP نمونه Server 2:

```text
10.20.0.12
```

اول routeها را بررسی کنید:

```bash
ip addr
ip route
```

سپس:

```bash
curl -4 -fsS --connect-timeout 2 https://1.1.1.1
```

این دستور **باید fail شود**. اگر موفق شد، ادامه ندهید؛ Public NAT/default route/security-group را حذف کنید.

---

# 3. بررسی checksum و باز کردن Offline Bundle

```bash
cd /root
sha256sum -c spark-server2-offline-bundle.tar.gz.sha256
```

اگر `OK` نبود ادامه ندهید.

```bash
rm -rf /opt/spark-bootstrap
mkdir -p /opt/spark-bootstrap
tar -xzf /root/spark-server2-offline-bundle.tar.gz -C /opt/spark-bootstrap
```

بررسی:

```bash
ls -la /opt/spark-bootstrap
ls -la /opt/spark-bootstrap/supabase-docker
ls -la /opt/spark-bootstrap/spark/supabase/migrations
ls -lh /opt/spark-bootstrap/docker-images.tar
cat /opt/spark-bootstrap/manifest.env
```

باید حداقل این موارد وجود داشته باشد:

```text
manifest.env
supabase-docker/
spark/
docker-images.tar
bin/supabase
```

---

# 4. Firewall Host قبل از اجرای Containerها

مقادیر نمونه:

```text
S1 = 10.20.0.11
S2 = 10.20.0.12
S3 = 10.20.0.13
PRIVATE_CIDR = 10.20.0.0/24
ADMIN_CIDR = 10.20.0.10/32
```

اعمال UFW:

```bash
ufw --force reset
ufw default deny incoming
ufw default deny outgoing
ufw allow from 10.20.0.10/32 to any port 22 proto tcp
ufw allow from 10.20.0.11 to 10.20.0.12 port 8000 proto tcp
ufw allow from 10.20.0.13 to 10.20.0.12 port 8000 proto tcp
ufw allow from 10.20.0.13 to 10.20.0.12 port 5432 proto tcp
ufw allow out to 10.20.0.0/24
ufw allow out to 10.20.0.13 port 123 proto udp
ufw --force enable
ufw status verbose
```

در firewall بالادستی بانک/VPS نیز همین policy را enforce کنید.

---

# 5. جلوگیری از Internet Egress کانتینرهای Docker

UFW به تنهایی برای Docker کافی نیست. chain اختصاصی ایجاد کنید:

```bash
iptables -N SPARK_CORE_EGRESS 2>/dev/null || true
iptables -F SPARK_CORE_EGRESS
iptables -A SPARK_CORE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A SPARK_CORE_EGRESS -d 10.20.0.0/24 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 172.16.0.0/12 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 10.0.0.0/8 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 192.168.0.0/16 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -j REJECT
iptables -A SPARK_CORE_EGRESS -j RETURN
iptables -C DOCKER-USER -j SPARK_CORE_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j SPARK_CORE_EGRESS
```

برای persistence بدون فایل bash script یک systemd unit بسازید:

```bash
nano /etc/systemd/system/spark-core-firewall.service
```

محتوا:

```ini
[Unit]
Description=Spark Server 2 offline Docker network boundary
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=oneshot
ExecStart=-/usr/sbin/iptables -N SPARK_CORE_EGRESS
ExecStart=/usr/sbin/iptables -F SPARK_CORE_EGRESS
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -d 10.20.0.0/24 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 172.16.0.0/12 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 10.0.0.0/8 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 192.168.0.0/16 -j ACCEPT
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -j REJECT
ExecStart=/usr/sbin/iptables -A SPARK_CORE_EGRESS -j RETURN
ExecStart=-/usr/sbin/iptables -D DOCKER-USER -j SPARK_CORE_EGRESS
ExecStart=/usr/sbin/iptables -I DOCKER-USER 1 -j SPARK_CORE_EGRESS
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

فعال‌سازی:

```bash
systemctl daemon-reload
systemctl enable --now spark-core-firewall.service
systemctl status spark-core-firewall.service --no-pager
iptables -S DOCKER-USER
```

---

# 6. تنظیم NTP خصوصی از Server 3

JWT/MFA/TOTP به time صحیح وابسته‌اند. Server 2 نباید NTP اینترنتی داشته باشد.

```bash
mkdir -p /etc/systemd/timesyncd.conf.d
nano /etc/systemd/timesyncd.conf.d/spark.conf
```

محتوا:

```ini
[Time]
NTP=10.20.0.13
FallbackNTP=
```

سپس:

```bash
systemctl enable --now systemd-timesyncd
systemctl restart systemd-timesyncd
timedatectl status
```

---

# 7. Load کردن Docker Imageهای آفلاین

```bash
docker load -i /opt/spark-bootstrap/docker-images.tar
```

بررسی:

```bash
docker images
```

در این مرحله **هیچ `docker pull` نزنید**.

---

# 8. کپی Supabase و Spark snapshot

```bash
rm -rf /opt/spark-supabase /opt/spark
mkdir -p /opt/spark-supabase /opt/spark
cp -a /opt/spark-bootstrap/supabase-docker/. /opt/spark-supabase/
cp -a /opt/spark-bootstrap/spark/. /opt/spark/
install -m 0755 /opt/spark-bootstrap/bin/supabase /usr/local/bin/supabase
```

Commitهای bundle را ثبت کنید:

```bash
cat /opt/spark-bootstrap/manifest.env
nano /opt/spark-supabase/SUPABASE_UPSTREAM_COMMIT
nano /opt/spark/SPARK_COMMIT
```

مقادیر را از `manifest.env` وارد کنید.

---

# 9. ساخت `.env` Supabase بدون اجرای generate-keys.sh

```bash
cd /opt/spark-supabase
cp .env.example .env
chmod 600 .env
```

Secretهای پایه را یکی‌یکی تولید کنید و در password manager امن ذخیره کنید:

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

## ساخت ANON_KEY و SERVICE_ROLE_KEY با Python، بدون shell script

ابتدا `JWT_SECRET` تولیدشده را فقط در session جاری قرار دهید:

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

خروجی‌ها را به ترتیب به عنوان `ANON_KEY` و `SERVICE_ROLE_KEY` ذخیره کنید.

## ویرایش `.env`

```bash
nano /opt/spark-supabase/.env
```

حداقل این مقادیر را جایگزین کنید:

```text
POSTGRES_PASSWORD=<FRESH_VALUE>
JWT_SECRET=<FRESH_VALUE>
ANON_KEY=<GENERATED_ANON_JWT>
SERVICE_ROLE_KEY=<GENERATED_SERVICE_ROLE_JWT>
DASHBOARD_PASSWORD=<FRESH_VALUE>
SECRET_KEY_BASE=<FRESH_VALUE>
REALTIME_DB_ENC_KEY=<FRESH_VALUE>
VAULT_ENC_KEY=<FRESH_VALUE>
PG_META_CRYPTO_KEY=<FRESH_VALUE>
LOGFLARE_PUBLIC_ACCESS_TOKEN=<FRESH_VALUE>
LOGFLARE_PRIVATE_ACCESS_TOKEN=<FRESH_VALUE>
S3_PROTOCOL_ACCESS_KEY_ID=<FRESH_VALUE>
S3_PROTOCOL_ACCESS_KEY_SECRET=<FRESH_VALUE>
MINIO_ROOT_PASSWORD=<FRESH_VALUE>

SUPABASE_PUBLIC_URL=https://api.shahrmeeting.ir
API_EXTERNAL_URL=https://api.shahrmeeting.ir/auth/v1
SITE_URL=https://shahrmeeting.ir
ADDITIONAL_REDIRECT_URLS=https://shahrmeeting.ir/*,https://www.shahrmeeting.ir/*
FUNCTIONS_VERIFY_JWT=false
PHONE_LOGIN_ALLOWED_ORIGINS=https://shahrmeeting.ir,https://www.shahrmeeting.ir
```

همچنین secretهای Spark را بسازید:

```bash
openssl rand -base64 32
openssl rand -hex 32
```

در `.env` اضافه کنید:

```text
SEND_SMS_HOOK_SECRET=v1,whsec_<RANDOM_BASE64_VALUE>
PHONE_PASSWORD_RESET_SECRET=<RANDOM_HEX_32>
```

> اگر Supabase snapshot انتخابی شما از `JWT_KEYS/JWT_JWKS` و opaque API keys استفاده می‌کند، آن مقادیر نیز باید طبق utility همان commit تولید و در `.env` قرار گیرند. چون ساختار آن‌ها به version وابسته است، از الگوریتم/نام متغیر commit دیگری استفاده نکنید. Offline bundle باید تمام image/tool لازم برای commit انتخابی را همراه داشته باشد.

---

# 10. ویرایش دستی `docker-compose.yml`

```bash
nano /opt/spark-supabase/docker-compose.yml
```

قبل از تغییر یک backup محلی بگیرید:

```bash
cp /opt/spark-supabase/docker-compose.yml /opt/spark-supabase/docker-compose.yml.before-spark
```

این تغییرات را اعمال کنید.

## 10.1 Edge Runtime روی Server 2 اجرا نشود

در service مربوط به `functions` اضافه کنید:

```yaml
profiles:
  - server3-only
```

## 10.2 Kong فقط روی private IP منتشر شود

در service `kong` بخش ports باید به شکل زیر باشد:

```yaml
ports:
  - "10.20.0.12:8000:8000/tcp"
```

## 10.3 PostgreSQL فقط روی private IP منتشر شود

در service `db`:

```yaml
ports:
  - "10.20.0.12:5432:5432/tcp"
```

Firewall فقط Server 3 را روی 5432 مجاز کرده است.

## 10.4 Supavisor host ports حذف شود

اگر service `supavisor` دارای `ports:` است، public/host mapping را حذف کنید یا:

```yaml
ports: []
```

## 10.5 GoTrue Send SMS Hook به Server 3

در environment مربوط به service `auth` اضافه کنید:

```yaml
GOTRUE_HOOK_SEND_SMS_ENABLED: "true"
GOTRUE_HOOK_SEND_SMS_URI: "http://10.20.0.13:9000/auth-send-sms-hook"
GOTRUE_HOOK_SEND_SMS_SECRETS: "${SEND_SMS_HOOK_SECRET}"
```

## 10.6 اگر snapshot از auth keyهای جدید استفاده می‌کند

خطوط version-specific مربوط به این متغیرها را طبق compose همان snapshot فعال کنید:

```text
GOTRUE_JWT_KEYS
API_JWT_JWKS
JWT_JWKS
SUPABASE_JWKS
```

نام service یا variable را حدس نزنید. اگر compose snapshot با این راهنما متفاوت بود، deployment را متوقف و تغییرات را با همان commit reconcile کنید.

---

# 11. Validate Compose قبل از Start

```bash
cd /opt/spark-supabase
docker compose config >/dev/null
docker compose --profile server3-only config >/dev/null
```

اگر error وجود داشت containerها را start نکنید.

---

# 12. Start Supabase Core بدون Pull

```bash
cd /opt/spark-supabase
docker compose up -d --pull never
```

بررسی:

```bash
docker compose ps
sleep 12
curl -fsS http://10.20.0.12:8000/auth/v1/health
```

PostgreSQL:

```bash
docker compose exec -T db psql -U postgres -d postgres -Atqc 'select 1'
```

باید `1` برگرداند.

---

# 13. اعمال Migrationهای Spark

مقادیر را از `.env` بخوانید:

```bash
cd /opt/spark-supabase
grep '^POSTGRES_PASSWORD=' .env
grep '^ANON_KEY=' .env
grep '^SERVICE_ROLE_KEY=' .env
grep '^JWT_SECRET=' .env
```

برای password دارای special character، URL-encoding:

```bash
python3 -c 'import urllib.parse; print(urllib.parse.quote(input("POSTGRES_PASSWORD: "), safe=""))'
```

سپس:

```bash
cd /opt/spark
supabase db push --db-url 'postgresql://postgres:<URL_ENCODED_PASSWORD>@10.20.0.12:5432/postgres' --dry-run
```

Dry-run را دقیق بررسی کنید. اگر صحیح بود:

```bash
supabase db push --db-url 'postgresql://postgres:<URL_ENCODED_PASSWORD>@10.20.0.12:5432/postgres' --include-all
```

---

# 14. ساخت Handoff برای Server 1

```bash
mkdir -p /root/spark-transfer
chmod 700 /root/spark-transfer
nano /root/spark-transfer/server1.env
```

محتوا:

```text
VITE_SUPABASE_ANON_KEY='<ANON_KEY_FROM_/opt/spark-supabase/.env>'
```

```bash
chmod 600 /root/spark-transfer/server1.env
```

انتقال:

```bash
scp /root/spark-transfer/server1.env root@10.20.0.11:/root/server1.env
```

---

# 15. ساخت Handoff Privileged برای Server 3

```bash
nano /root/spark-transfer/server3.env
```

محتوا:

```text
S2_PRIVATE_IP='10.20.0.12'
S3_PRIVATE_IP='10.20.0.13'
SUPABASE_UPSTREAM_COMMIT='<VALUE_FROM_MANIFEST>'
SUPABASE_PUBLIC_URL='https://api.shahrmeeting.ir'
SUPABASE_ANON_KEY='<ANON_KEY>'
SUPABASE_SERVICE_ROLE_KEY='<SERVICE_ROLE_KEY>'
JWT_SECRET='<JWT_SECRET>'
POSTGRES_PASSWORD='<POSTGRES_PASSWORD>'
SEND_SMS_HOOK_SECRET='<SEND_SMS_HOOK_SECRET>'
```

```bash
chmod 600 /root/spark-transfer/server3.env
scp /root/spark-transfer/server3.env root@10.20.0.13:/root/server3.env
```

این فایل privileged است و نباید روی Server 1 یا Git قرار گیرد.

---

# 16. Backup دستی و Timer

پوشه backup:

```bash
mkdir -p /var/backups/spark
chmod 700 /var/backups/spark
```

Backup فوری DB:

```bash
cd /opt/spark-supabase
docker compose exec -T db pg_dump -U postgres -d postgres -Fc > /var/backups/spark/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump
```

Storage:

```bash
tar -C /opt/spark-supabase/volumes -czf /var/backups/spark/storage-$(date -u +%Y%m%dT%H%M%SZ).tar.gz storage
```

برای اجرای روزانه بدون ایجاد فایل `.sh` یک service بسازید:

```bash
nano /etc/systemd/system/spark-core-backup.service
```

محتوا:

```ini
[Unit]
Description=Spark Supabase database/storage backup
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/spark-supabase
ExecStart=/bin/sh -c '/usr/bin/docker compose exec -T db pg_dump -U postgres -d postgres -Fc > /var/backups/spark/postgres-$(date -u +%%Y%%m%%dT%%H%%M%%SZ).dump'
ExecStart=/bin/sh -c '/usr/bin/tar -C /opt/spark-supabase/volumes -czf /var/backups/spark/storage-$(date -u +%%Y%%m%%dT%%H%%M%%SZ).tar.gz storage'
ExecStart=/usr/bin/find /var/backups/spark -type f -mtime +14 -delete
```

> `ExecStart=/bin/sh -c` فقط یک command inline داخل systemd است؛ هیچ installer یا فایل shell script ایجاد نمی‌شود.

Timer:

```bash
nano /etc/systemd/system/spark-core-backup.timer
```

```ini
[Unit]
Description=Daily Spark Supabase backup

[Timer]
OnCalendar=*-*-* 01:30:00
Persistent=true
RandomizedDelaySec=10m

[Install]
WantedBy=timers.target
```

فعال‌سازی:

```bash
systemctl daemon-reload
systemctl enable --now spark-core-backup.timer
systemctl list-timers spark-core-backup.timer --no-pager
```

---

# 17. Validation امنیتی نهایی

Listenerها:

```bash
ss -lnt | grep -E '10.20.0.12:(8000|5432)'
```

Health:

```bash
curl -fsS http://10.20.0.12:8000/auth/v1/health
```

DB:

```bash
cd /opt/spark-supabase
docker compose exec -T db psql -U postgres -d postgres -Atqc 'select 1'
```

Internet باید fail شود:

```bash
curl -4 -fsS --connect-timeout 2 https://1.1.1.1 && echo 'ERROR: Internet egress exists'
```

Docker egress rules:

```bash
iptables -S DOCKER-USER
systemctl status spark-core-firewall.service --no-pager
```

از Server 1، 5432 نباید reachable باشد.

از Server 3، 8000 و 5432 باید reachable باشند.

---

# 18. حذف Handoffها

پس از تکمیل Server 1 و Server 3:

```bash
shred -u /root/spark-transfer/server1.env
shred -u /root/spark-transfer/server3.env
```

نسخه مقصد نیز بعد از انتقال مقادیر به configهای root-only حذف شود.

---

# 19. Update Policy

برای Update به Server 2 Internet ندهید.

روال صحیح:

```text
1. روی Server 3 snapshot جدید Spark/Supabase و OCI images را آماده کن.
2. checksum بگیر.
3. از private/admin network به Server 2 منتقل کن.
4. Backup بگیر.
5. تغییر compose/migrations را review کن.
6. Update را offline انجام بده.
```

به هیچ عنوان برای سهولت Update، NAT موقت Internet برای Server 2 باز نکنید.
