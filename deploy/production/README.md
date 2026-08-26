# Spark — Canonical Production Deployment

> راهنمای نصب کاملاً دستی و بدون اجرای installer bash script نیز در `deploy/manual-production/README.md` قرار دارد.

این پوشه **تنها مرجع Deployment تولیدی Spark** است. فایل‌های cron، Nginx، firewall، TURN و runbookهای قدیمی حذف شده‌اند تا فقط یک معماری معتبر باقی بماند.

## فایل‌های نهایی

| فایل | سرور | Zone | مسئولیت |
|---|---|---|---|
| `server-1-web-gateway.sh` | Server 1 | DMZ | React/Vite + Nginx + Public Web/API Reverse Proxy |
| `server-2-supabase-core.sh` | Server 2 | Internal | Supabase Core + PostgreSQL، **کاملاً بدون Internet** |
| `server-3-edge-integration.sh` | Server 3 | DMZ | Edge Functions + Integration + Workers + Schedulers + Private NTP |
| `server-4-turn.sh` | Server 4 | DMZ | coturn: STUN/TURN/TURNS |
| `single-host.sh` | تک VPS | Combined | همه اجزا روی یک سرور با همان URLهای عمومی |

هر shell file مستقل است و package installation، config، firewall، systemd، Docker/Nginx و health check خودش را می‌سازد.

---

# 1) Network / DNS

نمونه IP خصوصی:

```text
S1 = 10.20.0.11   Web/API Gateway
S2 = 10.20.0.12   Supabase Core + PostgreSQL
S3 = 10.20.0.13   Edge/Integration
S4 = 10.20.0.14   TURN private NIC
Private CIDR = 10.20.0.0/24
```

DNS عمومی:

```text
shahrmeeting.ir      -> S1 Public IP
www.shahrmeeting.ir  -> S1 Public IP
api.shahrmeeting.ir  -> S1 Public IP
turn.shahrmeeting.ir -> S4 Public IP
```

## Firewall Matrix

| From | To | Port | Purpose |
|---|---|---:|---|
| Internet/Users | S1 | 443/TCP | SPA, REST, Auth, WSS, Functions |
| S1 | S2 | 8000/TCP private | Kong: Auth/REST/Realtime/Storage/GraphQL |
| S1 | S3 | 9000/TCP private | Edge Functions |
| S3 | S2 | 8000/TCP private | Supabase API calls from Functions/Workers |
| S3 | S2 | 5432/TCP private | controlled server-side DB access |
| S2 | S3 | 9000/TCP private | GoTrue Send-SMS hook |
| S2 | S3 | 123/UDP private | NTP for offline S2 |
| S3 | Internet | 443/TCP outbound | Bale/Telegram/HTTPS integrations |
| S3 | Internet | 8443/TCP outbound | SMS/Rahyab when configured on 8443 |
| Users | S4 | 3478 UDP/TCP | STUN/TURN |
| Users | S4 | 5349/TCP | TURN TLS |
| Users | S4 | 49160-49200/UDP | TURN relay media |

## Forbidden

```text
Internet -> S2                    DENY
S2 -> Internet                    DENY (host + Docker containers)
S1 -> S2:5432                     DENY
Internet -> PostgreSQL/Studio     DENY
Internet -> S3:9000               DENY
S4 -> S2                          NO DEPENDENCY
```

> نکته: در دیاگرام اولیه فلش SMS/Bale کنار Server 2 دیده می‌شود، اما چون شرط قطعی معماری «Server 2 بدون Internet» است، **خروجی SMS/Bale/Telegram در پیاده‌سازی واقعی از Server 3 انجام می‌شود**. Server 2 فقط hook خصوصی را به Server 3 می‌زند.

---

# 2) Secret Policy

Secretهای فایل‌های قدیمی را وارد این معماری نکنید. Secretهای متعلق به stack توسط scripts مجدداً تولید می‌شوند.

بعد از Migration حتماً rotate شود:

- PostgreSQL password
- Supabase JWT / anon / service-role / secret keys
- Dashboard password
- SMS/Rahyab credentials
- Bale/Telegram bot tokens
- scheduler secrets
- TURN shared secret
- OAuth secrets

```text
/etc/spark/*.env                 chmod 600
/opt/spark-supabase/.env        chmod 600
```

هیچ Service Role، DB password یا TURN shared secret نباید وارد Frontend/Vite/Git شود.

---

# 3) ترتیب نصب 4 سرور

## A. ابتدا روی Server 3 بسته Offline مربوط به Server 2 را بساز

```bash
sudo -i
apt update && apt install -y git
cd /root
git clone https://github.com/hamedplay/Spark.git
cd Spark

export SPARK_REF='main'
# برای Production یک tag/commit بررسی‌شده Supabase قرار بده؛ master توصیه نمی‌شود.
export SUPABASE_REF='<REVIEWED_SUPABASE_TAG_OR_COMMIT>'

bash deploy/production/server-3-edge-integration.sh prepare-server2-bundle
```

خروجی:

```text
/root/spark-server2-offline-bundle.tar.gz
/root/spark-server2-offline-bundle.tar.gz.sha256
/root/server-2-supabase-core.sh
```

Bundle شامل snapshot دقیق Spark، snapshot دقیق Docker رسمی Supabase، همه OCI imageهای لازم و Supabase CLI native است؛ credential تولیدی داخل bundle قرار نمی‌گیرد.

```bash
sha256sum -c /root/spark-server2-offline-bundle.tar.gz.sha256

scp /root/spark-server2-offline-bundle.tar.gz \
     /root/spark-server2-offline-bundle.tar.gz.sha256 \
     /root/server-2-supabase-core.sh \
     root@10.20.0.12:/root/
```

انتقال فقط از مسیر private/admin network انجام شود.

---

## B. Server 2 — Internal / No Internet

Base image باید از قبل این ابزارها را داشته باشد؛ از Internet روی S2 نصب نکن:

```text
Docker Engine + docker compose plugin
python3 + python3-yaml
openssl, ufw, tar, rsync, curl, iptables, systemd
```

قبل از اجرا route/NAT/public egress مربوط به S2 را حذف کن.

```bash
sudo -i
cd /root
sha256sum -c spark-server2-offline-bundle.tar.gz.sha256
chmod 700 server-2-supabase-core.sh

export S1_PRIVATE_IP='10.20.0.11'
export S2_PRIVATE_IP='10.20.0.12'
export S3_PRIVATE_IP='10.20.0.13'
export PRIVATE_CIDR='10.20.0.0/24'
export ADMIN_CIDR='10.20.0.10/32'
export APP_DOMAIN='shahrmeeting.ir'
export API_DOMAIN='api.shahrmeeting.ir'
export OFFLINE_BUNDLE='/root/spark-server2-offline-bundle.tar.gz'

bash /root/server-2-supabase-core.sh
```

Script اگر Internet egress تشخیص دهد abort می‌کند. همچنین Docker `DOCKER-USER` را می‌بندد تا containerهای Supabase هم Internet نداشته باشند.

Validation:

```bash
ss -lnt | grep -E '10.20.0.12:(8000|5432)'
curl -fsS http://10.20.0.12:8000/auth/v1/health
ufw status verbose
iptables -S DOCKER-USER
systemctl status spark-core-firewall --no-pager
systemctl list-timers spark-core-backup.timer --no-pager

# MUST FAIL:
curl -4 --connect-timeout 2 https://1.1.1.1
```

Expected:

```text
S2:8000  reachable only by S1/S3
S2:5432  reachable only by S3
Studio   not public
Internet egress blocked
```

S2 دو handoff یکبارمصرف تولید می‌کند:

```bash
scp /root/spark-transfer/server1.env root@10.20.0.11:/root/server1.env
scp /root/spark-transfer/server3.env root@10.20.0.13:/root/server3.env
```

بعد از تکمیل S1/S3:

```bash
shred -u /root/spark-transfer/server1.env /root/spark-transfer/server3.env
```

`server1.env` فقط anon key مرورگر را دارد؛ `server3.env` privileged است.

---

## C. Server 3 — Edge Functions / Integration

```bash
sudo -i
chmod 600 /root/server3.env
cd /root/Spark
git fetch origin && git checkout main && git pull --ff-only

export S1_PRIVATE_IP='10.20.0.11'
export S2_PRIVATE_IP='10.20.0.12'
export S3_PRIVATE_IP='10.20.0.13'
export PRIVATE_CIDR='10.20.0.0/24'
export ADMIN_CIDR='<ADMIN_CIDR>'
export APP_DOMAIN='shahrmeeting.ir'
export API_DOMAIN='api.shahrmeeting.ir'
export SERVER2_ENV_FILE='/root/server3.env'

bash deploy/production/server-3-edge-integration.sh install
```

این سرور تمام `supabase/functions/*` را اجرا می‌کند و برای callهای داخلی یک router خصوصی دارد؛ بنابراین Functionها می‌توانند Supabase API و Functionهای دیگر را بدون hairpin عمومی صدا بزنند.

Provider secrets فقط در فایل زیر:

```bash
sudoedit /etc/spark/functions-extra.env
sudo chmod 600 /etc/spark/functions-extra.env
cd /opt/spark-edge
docker compose up -d --force-recreate functions
```

نام variable را حدس نزن؛ فقط variableای که Function فعال واقعاً `Deno.env.get()` می‌خواند وارد کن.

Schedulers یکپارچه روی S3:

```text
send-daily-meetings             every 5m
process-minutes-reminders       every 5m
process-decision-due-overdue    every 10m
process-notification-outbox     every 1m
```

Validation:

```bash
curl -fsS http://10.20.0.12:8000/auth/v1/health
timeout 3 bash -c '</dev/tcp/10.20.0.12/5432'
curl -i http://127.0.0.1:9000/password-login
docker compose -f /opt/spark-edge/docker-compose.yml ps
systemctl list-timers 'spark-*' --no-pager
systemctl status spark-edge-firewall --no-pager
iptables -S DOCKER-USER
chronyc tracking
```

پس از تأیید:

```bash
shred -u /root/server3.env
```

---

## D. Server 1 — Web / Reverse Proxy

```bash
sudo -i
chmod 600 /root/server1.env
set -a; source /root/server1.env; set +a

cd /root
git clone https://github.com/hamedplay/Spark.git 2>/dev/null || true
cd Spark
git fetch origin && git checkout main && git pull --ff-only

export APP_DOMAIN='shahrmeeting.ir'
export WWW_DOMAIN='www.shahrmeeting.ir'
export API_DOMAIN='api.shahrmeeting.ir'
export S2_PRIVATE_IP='10.20.0.12'
export S3_PRIVATE_IP='10.20.0.13'
export ADMIN_CIDR='<ADMIN_CIDR>'
export LETSENCRYPT_EMAIL='ops@example.com'

bash deploy/production/server-1-web-gateway.sh
shred -u /root/server1.env
```

Routing نهایی:

```text
/functions/v1/* -> S3:9000
/auth/v1/*      -> S2:8000
/rest/v1/*      -> S2:8000
/realtime/v1/*  -> S2:8000 WebSocket
/storage/v1/*   -> S2:8000
/graphql/v1     -> S2:8000
other API path  -> 404
```

Validation:

```bash
curl -I https://shahrmeeting.ir
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
curl -i https://api.shahrmeeting.ir/functions/v1/password-login
curl -i https://api.shahrmeeting.ir/studio/   # must NOT expose Studio
nginx -t
ufw status verbose

# MUST FAIL from S1:
timeout 3 bash -c '</dev/tcp/10.20.0.12/5432' && echo 'ERROR DB reachable from S1'
```

---

## E. Server 4 — TURN/STUN

DNS `turn.shahrmeeting.ir` باید قبل از Certbot به S4 اشاره کند.

```bash
sudo -i
cd /root
git clone https://github.com/hamedplay/Spark.git 2>/dev/null || true
cd Spark
git fetch origin && git checkout main && git pull --ff-only

export TURN_DOMAIN='turn.shahrmeeting.ir'
export TURN_PUBLIC_IP='<S4_PUBLIC_IP>'
export TURN_PRIVATE_IP='<S4_PRIVATE_IP_OR_SAME_PUBLIC_IP>'
export ADMIN_CIDR='<ADMIN_CIDR>'
export LETSENCRYPT_EMAIL='ops@example.com'
export TURN_MIN_PORT='49160'
export TURN_MAX_PORT='49200'

bash deploy/production/server-4-turn.sh
```

هم در provider firewall و هم UFW باز شود:

```text
3478/UDP
3478/TCP
5349/TCP
49160-49200/UDP
```

Validation:

```bash
systemctl status coturn --no-pager
ss -lntup | grep -E ':(3478|5349)\b'
turnutils_stunclient turn.shahrmeeting.ir -p 3478
openssl s_client -connect turn.shahrmeeting.ir:5349 -servername turn.shahrmeeting.ir </dev/null
```

`TURN_SHARED_SECRET` فقط در `/etc/spark/turn-secret.env` است و نباید وارد Browser شود. WebRTC client در صورت استفاده باید credential کوتاه‌عمر TURN REST را از backend مورد اعتماد بگیرد.

---

# 4) Acceptance Test

بعد از نصب هر چهار سرور:

```bash
curl -I https://shahrmeeting.ir
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
curl -i https://api.shahrmeeting.ir/functions/v1/password-login
```

در UI/Production flow حداقل تست کن:

1. Password Login
2. Phone OTP/Recovery در صورت فعال‌بودن
3. TOTP/MFA
4. Storage upload/download + signed URL
5. Realtime/WSS
6. SMS/Rahyab
7. Bale/Telegram
8. Daily report / Minutes reminder / Decision due / Notification outbox
9. Avatar processing worker
10. WebRTC/TURN اگر قابلیت تماس در build فعال است

---

# 5) Update

### S1 Frontend

```bash
cd /opt/spark
git fetch origin && git checkout main && git pull --ff-only
npm ci && npm run build
rsync -a --delete dist/ /var/www/spark/
nginx -t && systemctl reload nginx
```

### S3 Functions/Worker

```bash
cd /opt/spark
git fetch origin && git checkout main && git pull --ff-only
rsync -a --delete supabase/functions/ /opt/spark-edge/functions/
rm -rf /opt/spark-edge/functions/main
cp -a /opt/supabase-source/docker/volumes/functions/main /opt/spark-edge/functions/main
cd /opt/spark-edge
docker compose build avatar-worker
docker compose up -d --force-recreate functions avatar-worker
```

### S2 Core/DB

**هرگز برای update به S2 اینترنت نده.** روی S3 یک bundle جدید با Supabase ref بررسی‌شده بساز و private منتقل کن. قبل از هر migration backup بگیر.

```bash
sudo /usr/local/sbin/spark-core-backup
ls -lh /var/backups/spark
```

Backup تولیدی باید طبق سیاست بانک به storage داخلی رمزنگاری‌شده منتقل شود.

---

# 6) Single-Host Mode

در حالت یک VPS، URLهای عمومی دقیقاً همانند معماری 4 سروری می‌مانند تا Frontend و Functionها نیاز به تغییر کد نداشته باشند:

```text
Internet -> Nginx :443
  shahrmeeting.ir -> SPA
  api.shahrmeeting.ir -> local Kong :8000
       /functions/v1 -> local Edge Runtime
       /auth/rest/realtime/storage/graphql -> local Supabase Core

Docker private network:
  PostgreSQL (not published)
  Auth / PostgREST / Realtime / Storage
  Edge Runtime / all Spark Functions
  Avatar worker

Host:
  systemd schedulers -> 127.0.0.1:8000/functions/v1/*
  coturn 3478/5349 + UDP relay range
```

Install:

```bash
sudo -i
cd /root
git clone https://github.com/hamedplay/Spark.git
cd Spark

export APP_DOMAIN='shahrmeeting.ir'
export WWW_DOMAIN='www.shahrmeeting.ir'
export API_DOMAIN='api.shahrmeeting.ir'
export TURN_DOMAIN='turn.shahrmeeting.ir'
export TURN_PUBLIC_IP='<VPS_PUBLIC_IP>'
export TURN_PRIVATE_IP='<VPS_PRIVATE_IP_OR_PUBLIC_IP>'
export ADMIN_CIDR='<ADMIN_CIDR>'
export LETSENCRYPT_EMAIL='ops@example.com'
export SUPABASE_REF='<REVIEWED_SUPABASE_TAG_OR_COMMIT>'

bash deploy/production/single-host.sh
```

Provider credentials مربوط به Functionها در صورت نیاز:

```bash
sudoedit /etc/spark/functions-extra.env
sudo chmod 600 /etc/spark/functions-extra.env
cd /opt/spark-supabase
docker compose up -d --force-recreate functions
```

Validation:

```bash
curl -I https://shahrmeeting.ir
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
curl -i https://api.shahrmeeting.ir/functions/v1/password-login
docker compose -f /opt/spark-supabase/docker-compose.yml ps
systemctl list-timers 'spark-*' --no-pager
ss -lntup | grep -E ':(3478|5349)\b'

# PostgreSQL نباید روی public interface باشد:
ss -lntp | grep ':5432'
```

---

# 7) Canonical Rules

1. Server 2 همیشه Internal و بدون Internet است.
2. در 4-Server mode تمام Edge Functions روی Server 3 هستند.
3. Server 1 تنها public entry point برای Web/API است.
4. Server 4 فقط Media Relay است و به DB وابسته نیست.
5. Schedulers کنار Functions روی Server 3 اجرا می‌شوند، نه با public cron hairpin.
6. Single-host همان public endpoint contract را حفظ می‌کند و همه Functions را local اجرا می‌کند.
7. Studio/PostgreSQL/Supavisor هیچ‌وقت public نیستند.
8. Secretها generated/out-of-band هستند و در Git قرار نمی‌گیرند.
9. هر تغییر Supabase در S2 با offline bundle جدید انجام می‌شود، نه temporary Internet access.
