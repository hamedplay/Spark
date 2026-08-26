# Server 4 — Manual TURN / STUN Installation

نقش Server 4:

```text
Zone: DMZ
Service: coturn
STUN/TURN: 3478 UDP/TCP
TURN TLS: 5349/TCP
Relay media: 49160-49200/UDP
Database dependency: none
```

این سرور هیچ ارتباطی با PostgreSQL یا Server 2 ندارد.

نمونه مقادیر:

```text
TURN_DOMAIN     = turn.shahrmeeting.ir
TURN_PUBLIC_IP  = <SERVER4_PUBLIC_IP>
TURN_PRIVATE_IP = 10.20.0.14
ADMIN_CIDR      = <ADMIN_CIDR>
LE_EMAIL         = ops@example.com
TURN_MIN_PORT    = 49160
TURN_MAX_PORT    = 49200
```

اگر VPS مستقیماً Public IP را روی interface خودش دارد، `TURN_PRIVATE_IP` می‌تواند همان Public IP باشد. اگر NAT وجود دارد، Public و Private متفاوت هستند.

---

# 1. DNS

قبل از نصب TLS:

```text
turn.shahrmeeting.ir -> Server 4 Public IP
```

بررسی:

```bash
getent ahosts turn.shahrmeeting.ir
```

---

# 2. نصب packageها

```bash
sudo -i
apt update
apt upgrade -y
apt install -y coturn certbot ufw openssl ca-certificates curl
```

---

# 3. Firewall موقت برای صدور Certificate

```bash
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from <ADMIN_CIDR> to any port 22 proto tcp
ufw allow 80/tcp
ufw --force enable
ufw status verbose
```

در provider firewall نیز TCP/80 را موقتاً باز کنید.

---

# 4. دریافت Certificate اولیه

```bash
systemctl stop coturn 2>/dev/null || true
```

```bash
certbot certonly --standalone \
  -d turn.shahrmeeting.ir \
  --email ops@example.com \
  --agree-tos \
  --non-interactive
```

بررسی:

```bash
certbot certificates
ls -la /etc/letsencrypt/live/turn.shahrmeeting.ir/
```

---

# 5. ساخت محل امن Certificate برای coturn

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

---

# 6. تولید TURN Shared Secret

```bash
openssl rand -base64 48
```

خروجی را در password manager امن ذخیره کنید.

```bash
mkdir -p /etc/spark
chmod 700 /etc/spark
nano /etc/spark/turn-secret.env
```

محتوا:

```text
TURN_DOMAIN=turn.shahrmeeting.ir
TURN_SHARED_SECRET=<FRESH_TURN_SECRET>
TURN_URL=turn:turn.shahrmeeting.ir:3478?transport=udp
TURN_TCP_URL=turn:turn.shahrmeeting.ir:3478?transport=tcp
TURNS_URL=turns:turn.shahrmeeting.ir:5349?transport=tcp
```

```bash
chmod 600 /etc/spark/turn-secret.env
chown root:root /etc/spark/turn-secret.env
```

**TURN_SHARED_SECRET را هرگز در Frontend/Vite قرار ندهید.** Browser باید short-lived TURN REST credential را از backend قابل اعتماد دریافت کند.

---

# 7. تنظیم `turnserver.conf`

## حالت NAT

اگر:

```text
Public IP  = 203.0.113.40
Private IP = 10.20.0.14
```

باید:

```text
external-ip=203.0.113.40/10.20.0.14
```

قرار دهید.

## حالت Public IP مستقیم

اگر Public و Private یکی هستند:

```text
external-ip=<PUBLIC_IP>
```

فایل config:

```bash
nano /etc/turnserver.conf
```

نمونه NAT:

```text
listening-port=3478
tls-listening-port=5349
listening-ip=10.20.0.14
relay-ip=10.20.0.14
external-ip=<SERVER4_PUBLIC_IP>/10.20.0.14

fingerprint
use-auth-secret
static-auth-secret=<FRESH_TURN_SECRET>
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

log-file=/var/log/turnserver/turnserver.log
simple-log
```

Permission:

```bash
chmod 640 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf
mkdir -p /var/log/turnserver
chown turnserver:turnserver /var/log/turnserver
```

---

# 8. فعال کردن coturn

فایل زیر را بررسی کنید:

```bash
nano /etc/default/coturn
```

مطمئن شوید:

```text
TURNSERVER_ENABLED=1
```

سپس:

```bash
systemctl enable --now coturn
systemctl status coturn --no-pager
```

---

# 9. Firewall نهایی TURN

ابتدا rule موقت 80 را حذف کنید:

```bash
ufw delete allow 80/tcp
```

سپس:

```bash
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 49160:49200/udp
ufw --force enable
ufw status verbose
```

در provider firewall نیز دقیقاً همین پورت‌ها را باز کنید.

---

# 10. تمدید TLS

برای renewal در حالت `standalone`، TCP/80 باید در زمان renewal موقتاً باز باشد. چون در این manual هیچ hook shell script ساخته نمی‌شود، دو روش مجاز دارید:

## روش A — تمدید کنترل‌شده دستی

قبل از پایان certificate:

```bash
ufw allow 80/tcp
certbot renew
install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/turn.shahrmeeting.ir/fullchain.pem /etc/coturn/certs/fullchain.pem
install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/turn.shahrmeeting.ir/privkey.pem /etc/coturn/certs/privkey.pem
systemctl restart coturn
ufw delete allow 80/tcp
```

## روش B — systemd drop-in بدون shell script file

ابتدا unit نصب‌شده Certbot را ببینید:

```bash
systemctl cat certbot.service
systemctl list-timers certbot.timer --no-pager
```

در صورت وجود `certbot.service` استاندارد Ubuntu:

```bash
mkdir -p /etc/systemd/system/certbot.service.d
nano /etc/systemd/system/certbot.service.d/spark-turn.conf
```

```ini
[Service]
ExecStartPre=-/usr/sbin/ufw allow 80/tcp
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/turn.shahrmeeting.ir/fullchain.pem /etc/coturn/certs/fullchain.pem
ExecStartPost=/usr/bin/install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/turn.shahrmeeting.ir/privkey.pem /etc/coturn/certs/privkey.pem
ExecStartPost=/usr/bin/systemctl try-restart coturn.service
ExecStartPost=-/usr/sbin/ufw delete allow 80/tcp
```

```bash
systemctl daemon-reload
systemctl enable --now certbot.timer
```

قبل از اعتماد به این روش، حتماً رفتار unit نسخه Ubuntu خودتان را با `certbot renew --dry-run` بررسی کنید و مطمئن شوید TCP/80 بعد از پایان باز نمانده است.

---

# 11. Validation

Listenerها:

```bash
ss -lntup | grep -E ':(3478|5349)\b'
```

STUN:

```bash
turnutils_stunclient turn.shahrmeeting.ir -p 3478
```

TLS:

```bash
openssl s_client \
  -connect turn.shahrmeeting.ir:5349 \
  -servername turn.shahrmeeting.ir \
  </dev/null
```

Service:

```bash
systemctl status coturn --no-pager
journalctl -u coturn -n 100 --no-pager
```

Firewall:

```bash
ufw status verbose
```

انتظار:

```text
3478/tcp          OPEN
3478/udp          OPEN
5349/tcp          OPEN
49160-49200/udp   OPEN
5432              CLOSED
8000              CLOSED
9000              CLOSED
```

---

# 12. WebRTC Client Contract

ICE serverها:

```text
stun:turn.shahrmeeting.ir:3478
turn:turn.shahrmeeting.ir:3478?transport=udp
turn:turn.shahrmeeting.ir:3478?transport=tcp
turns:turn.shahrmeeting.ir:5349?transport=tcp
```

username/password باید short-lived باشند و توسط backend بر اساس TURN shared secret تولید شوند؛ shared secret به browser داده نمی‌شود.

---

# 13. Update دستی

```bash
apt update
apt upgrade -y
systemctl restart coturn
systemctl is-active coturn
```

بعد از هر Update:

```bash
ss -lntup | grep -E ':(3478|5349)\b'
turnutils_stunclient turn.shahrmeeting.ir -p 3478
```
