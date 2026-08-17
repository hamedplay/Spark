# Server 1 — Manual Web / API Gateway Installation

نقش Server 1:

```text
Zone: DMZ
Public: 80/TCP, 443/TCP
Private upstream: Server 2:8000, Server 3:9000
Direct PostgreSQL: ممنوع
```

این راهنما معادل `deploy/production/server-1-web-gateway.sh` است، اما تمام مراحل دستی انجام می‌شوند.

## 1. مقادیر محیط خودت را مشخص کن

در این راهنما فرض می‌شود:

```text
APP_DOMAIN       = shahrmeeting.ir
WWW_DOMAIN       = www.shahrmeeting.ir
API_DOMAIN       = api.shahrmeeting.ir
S2_PRIVATE_IP    = 10.20.0.12
S3_PRIVATE_IP    = 10.20.0.13
ADMIN_CIDR       = <ADMIN_CIDR>
LETSENCRYPT_MAIL = ops@example.com
```

قبل از شروع، فایل `server1.env` تولیدشده در Server 2 را به `/root/server1.env` منتقل کنید. این فایل فقط باید anon key مرورگر را داشته باشد.

```bash
sudo -i
chmod 600 /root/server1.env
cat /root/server1.env
```

مقدار `VITE_SUPABASE_ANON_KEY` را برای مرحله build نگه دارید.

---

# 2. نصب packageهای پایه

```bash
apt update
apt upgrade -y
apt install -y ca-certificates curl git gnupg jq nginx certbot ufw rsync
```

## Node.js 24

پروژه در `package.json` به Node `>=24.18.1 <25` نیاز دارد.

```bash
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod a+r /etc/apt/keyrings/nodesource.gpg
```

فایل زیر را بسازید:

```bash
nano /etc/apt/sources.list.d/nodesource.list
```

محتوا:

```text
deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main
```

سپس:

```bash
apt update
apt install -y nodejs
npm install -g npm@^11.6.2
node --version
npm --version
```

Node باید حداقل 24.18.1 و کمتر از 25 باشد.

---

# 3. بررسی Private Connectivity قبل از Public Exposure

```bash
timeout 3 bash -c '</dev/tcp/10.20.0.12/8000'
timeout 3 bash -c '</dev/tcp/10.20.0.13/9000'
```

هر دو باید موفق شوند.

این تست باید fail شود:

```bash
timeout 3 bash -c '</dev/tcp/10.20.0.12/5432' && echo 'ERROR: PostgreSQL is reachable from Server 1'
```

اگر 5432 قابل دسترسی بود، قبل از ادامه Firewall/ACL را اصلاح کنید.

---

# 4. دریافت پروژه Spark

```bash
mkdir -p /opt
cd /opt
git clone https://github.com/hamedplay/Spark.git spark
cd /opt/spark
git checkout main
git pull --ff-only origin main
```

برای Production بهتر است به جای branch شناور، commit/tag تأییدشده deploy شود.

---

# 5. ساخت Frontend production environment

```bash
nano /opt/spark/.env.production
```

محتوا:

```text
VITE_SUPABASE_URL=https://api.shahrmeeting.ir
VITE_SUPABASE_ANON_KEY=<ANON_KEY_FROM_SERVER2>
```

سپس:

```bash
chmod 600 /opt/spark/.env.production
cd /opt/spark
npm ci
npm run build
```

در پایان باید پوشه زیر وجود داشته باشد:

```bash
ls -la /opt/spark/dist
```

---

# 6. Deploy فایل‌های SPA

```bash
mkdir -p /var/www/spark
mkdir -p /var/www/acme
rsync -a --delete /opt/spark/dist/ /var/www/spark/
chown -R www-data:www-data /var/www/spark /var/www/acme
```

---

# 7. ساخت Nginx proxy snippet

```bash
nano /etc/nginx/snippets/spark-proxy.conf
```

محتوا:

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 10s;
proxy_send_timeout 120s;
proxy_read_timeout 120s;
```

---

# 8. ساخت Security Headers snippet

```bash
nano /etc/nginx/snippets/spark-security.conf
```

محتوا:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;
add_header Cross-Origin-Resource-Policy "same-site" always;
add_header X-Permitted-Cross-Domain-Policies "none" always;
add_header X-DNS-Prefetch-Control "off" always;
add_header X-XSS-Protection "0" always;
```

---

# 9. Bootstrap HTTP برای دریافت Certificate

ابتدا فایل Frontend را بسازید:

```bash
nano /etc/nginx/sites-available/spark
```

محتوا:

```nginx
server {
    listen 80;
    server_name shahrmeeting.ir www.shahrmeeting.ir;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 301 https://shahrmeeting.ir$request_uri;
    }
}
```

فایل API:

```bash
nano /etc/nginx/sites-available/spark-api
```

محتوا:

```nginx
server {
    listen 80;
    server_name api.shahrmeeting.ir;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 301 https://api.shahrmeeting.ir$request_uri;
    }
}
```

فعال‌سازی:

```bash
ln -sfn /etc/nginx/sites-available/spark /etc/nginx/sites-enabled/spark
ln -sfn /etc/nginx/sites-available/spark-api /etc/nginx/sites-enabled/spark-api
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx
```

---

# 10. دریافت TLS Certificate

قبل از این مرحله DNS باید به Public IP Server 1 اشاره کند و TCP/80 موقتاً قابل دسترسی باشد.

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

تست:

```bash
certbot certificates
```

---

# 11. Nginx نهایی Frontend

فایل زیر را جایگزین کنید:

```bash
nano /etc/nginx/sites-available/spark
```

محتوا:

```nginx
server {
    listen 80;
    server_name shahrmeeting.ir www.shahrmeeting.ir;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 301 https://shahrmeeting.ir$request_uri;
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

    include /etc/nginx/snippets/spark-security.conf;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location /assets/ {
        try_files $uri =404;
        access_log off;
        expires 30d;
        add_header Cache-Control "public, max-age=2592000, immutable";
    }

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-store";
    }
}
```

---

# 12. Nginx نهایی API Gateway

```bash
nano /etc/nginx/sites-available/spark-api
```

محتوا:

```nginx
map $http_upgrade $spark_connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name api.shahrmeeting.ir;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/acme;
    }

    location / {
        return 301 https://api.shahrmeeting.ir$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name api.shahrmeeting.ir;

    ssl_certificate /etc/letsencrypt/live/api.shahrmeeting.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.shahrmeeting.ir/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    client_max_body_size 50m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header X-Frame-Options "DENY" always;

    # Edge Functions -> Server 3
    # trailing slash removes /functions/v1/ before forwarding to Edge Runtime
    location ^~ /functions/v1/ {
        proxy_pass http://10.20.0.13:9000/;
        include /etc/nginx/snippets/spark-proxy.conf;
    }

    # Realtime -> Server 2
    location ^~ /realtime/v1/ {
        proxy_pass http://10.20.0.12:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $spark_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location ^~ /auth/v1/ {
        proxy_pass http://10.20.0.12:8000;
        include /etc/nginx/snippets/spark-proxy.conf;
    }

    location ^~ /rest/v1/ {
        proxy_pass http://10.20.0.12:8000;
        include /etc/nginx/snippets/spark-proxy.conf;
    }

    location ^~ /storage/v1/ {
        proxy_pass http://10.20.0.12:8000;
        include /etc/nginx/snippets/spark-proxy.conf;
    }

    location ^~ /graphql/v1 {
        proxy_pass http://10.20.0.12:8000;
        include /etc/nginx/snippets/spark-proxy.conf;
    }

    # Studio/Kong internal routes must not become public
    location / {
        return 404;
    }
}
```

اعمال config:

```bash
nginx -t
systemctl reload nginx
```

---

# 13. Firewall Server 1

Host firewall:

```bash
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from <ADMIN_CIDR> to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
```

همان rules را در Firewall/VPC Provider نیز اعمال کنید.

**هیچ rule برای 5432 ایجاد نکنید.**

---

# 14. Validation

```bash
nginx -t
systemctl status nginx --no-pager
curl -I https://shahrmeeting.ir/
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
curl -i https://api.shahrmeeting.ir/functions/v1/password-login
```

Studio نباید publish باشد:

```bash
curl -i https://api.shahrmeeting.ir/studio/
```

باید 404 یا deny شود.

Private upstreamها:

```bash
timeout 3 bash -c '</dev/tcp/10.20.0.12/8000'
timeout 3 bash -c '</dev/tcp/10.20.0.13/9000'
```

PostgreSQL باید fail شود:

```bash
timeout 3 bash -c '</dev/tcp/10.20.0.12/5432' && echo 'ERROR: DB reachable from Server 1'
```

---

# 15. حذف handoff

بعد از build موفق:

```bash
shred -u /root/server1.env
```

`.env.production` شامل anon key است که browser-safe محسوب می‌شود، ولی همچنان نباید secretهای privileged داخل آن قرار بگیرند.

---

# 16. Update دستی Frontend

```bash
cd /opt/spark
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run build
rsync -a --delete dist/ /var/www/spark/
chown -R www-data:www-data /var/www/spark
nginx -t
systemctl reload nginx
```

پس از Update:

```bash
curl -I https://shahrmeeting.ir
curl -fsS https://api.shahrmeeting.ir/auth/v1/health
```
