# Manual Production Deployment

این پوشه روش نصب **دستی و مرحله‌به‌مرحله** معماری Production اسپارک است. هیچ installer `.sh` در این مسیر وجود ندارد. فایل‌های این پوشه معادل عملی معماری `deploy/production/` هستند، اما هر package، config، firewall rule، Docker service و systemd unit به صورت دستی ایجاد می‌شود.

## مسیر چهار سروری

1. `server-3-edge-integration.md` — ابتدا Part A برای ساخت offline media مربوط به Server 2
2. `server-2-supabase-core.md` — نصب Supabase Core + PostgreSQL در Internal Zone بدون Internet
3. `server-3-edge-integration.md` — سپس Part B برای Edge Runtime + Integration + Schedulerها
4. `server-1-web-gateway.md` — Frontend + Nginx + Public API Gateway
5. `server-4-turn.md` — STUN/TURN/TURNS

## مسیر تک سرور

- `single-host.md`

## ابزار اختیاری مدیریت Single Host

برای اجرای تعاملی مراحل `single-host.md`، Health Check، log، Update و مدیریت
زیرساخت Single Host می‌توانید از `deploy/spark-cli/` استفاده کنید. مستند Manual
همچنان مرجع اصلی معماری و روش دستی است.

## Network Contract

```text
S1 10.20.0.11  Web/API Gateway
S2 10.20.0.12  Supabase Core + PostgreSQL
S3 10.20.0.13  Edge/Integration
S4 10.20.0.14  TURN
```

```text
Users -> S1:443
S1 -> S2:8000
S1 -> S3:9000
S3 -> S2:8000
S3 -> S2:5432
S2 -> S3:9000
S2 -> S3:123/UDP
S3 -> Internet:443/8443
Users -> S4:3478 UDP/TCP, 5349/TCP, 49160-49200/UDP
```

ممنوع:

```text
Internet -> S2
S2 -> Internet
S1 -> S2:5432
Internet -> S3:9000
Internet -> PostgreSQL/Studio
```

## DNS

```text
shahrmeeting.ir      -> Server 1 Public IP
www.shahrmeeting.ir  -> Server 1 Public IP
api.shahrmeeting.ir  -> Server 1 Public IP
turn.shahrmeeting.ir -> Server 4 Public IP
```

در حالت Single Host همه recordها به همان VPS اشاره می‌کنند.

## Secret Policy

Secretهای قدیمی را reuse نکنید. PostgreSQL password، JWT/API keys، service-role key، provider credentials، scheduler secrets و TURN secret باید fresh/rotated باشند. `SERVICE_ROLE_KEY`، DB password و TURN shared secret هرگز وارد Frontend یا Git نشوند.

فایل‌های root-only را با `chmod 600` نگه دارید.

## اصل مهم Server 2

Server 2 نباید برای نصب یا Update به Internet وصل شود. تمام source/image/CLI موردنیاز آن باید روی Server 3 آماده و با checksum از مسیر private/admin network منتقل شود. Update آینده نیز با offline bundle جدید انجام می‌شود؛ NAT موقت برای Server 2 باز نکنید.

## Acceptance Test

پس از نصب چهار سرور:

```bash
curl -I https://shahrmeeting.ir
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
curl -i https://api.shahrmeeting.ir/functions/v1/password-login
```

از S1:

```bash
timeout 3 bash -c '</dev/tcp/10.20.0.12/8000'
timeout 3 bash -c '</dev/tcp/10.20.0.13/9000'
timeout 3 bash -c '</dev/tcp/10.20.0.12/5432' && echo 'ERROR'
```

تست سوم باید fail شود.

از S2:

```bash
curl -4 --connect-timeout 2 https://1.1.1.1 && echo 'ERROR: Internet egress exists'
ufw status verbose
iptables -S DOCKER-USER
```

Internet request باید fail شود.

سپس Login، OTP/MFA، Storage، Realtime، SMS/Bale، Schedulerها، Avatar Worker و WebRTC/TURN را end-to-end تست کنید.
