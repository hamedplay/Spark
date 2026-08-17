#!/usr/bin/env bash
set -Eeuo pipefail

# Spark - Server 1: Web/App + Reverse Proxy (DMZ)
# Ubuntu 24.04. Run as root.
#
# Required environment variables before running:
#   export APP_DOMAIN="shahrmeeting.ir"
#   export WWW_DOMAIN="www.shahrmeeting.ir"
#   export API_DOMAIN="api.shahrmeeting.ir"
#   export S2_PRIVATE_IP="10.20.0.12"
#   export S3_PRIVATE_IP="10.20.0.13"
#   export ADMIN_CIDR="203.0.113.10/32"
#   export LETSENCRYPT_EMAIL="ops@example.com"
#   export VITE_SUPABASE_ANON_KEY="<anon key copied securely from Server 2>"
# Optional:
#   export SPARK_REPO="https://github.com/hamedplay/Spark.git"
#   export SPARK_REF="main"
#
# Network contract:
#   Internet -> Server 1: 443/TCP only for application/API traffic.
#   Server 1 -> Server 2: 8000/TCP private Supabase Core.
#   Server 1 -> Server 3: 9000/TCP private Edge Runtime.
#   Server 1 NEVER connects directly to PostgreSQL 5432.

: "${APP_DOMAIN:?Set APP_DOMAIN}"
: "${WWW_DOMAIN:?Set WWW_DOMAIN}"
: "${API_DOMAIN:?Set API_DOMAIN}"
: "${S2_PRIVATE_IP:?Set S2_PRIVATE_IP}"
: "${S3_PRIVATE_IP:?Set S3_PRIVATE_IP}"
: "${ADMIN_CIDR:?Set ADMIN_CIDR}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL}"
: "${VITE_SUPABASE_ANON_KEY:?Set VITE_SUPABASE_ANON_KEY}"

SPARK_REPO="${SPARK_REPO:-https://github.com/hamedplay/Spark.git}"
SPARK_REF="${SPARK_REF:-main}"
APP_DIR="/opt/spark"
WEB_ROOT="/var/www/spark"
ACME_ROOT="/var/www/acme"
NGINX_SITE="/etc/nginx/sites-available/spark"
API_SITE="/etc/nginx/sites-available/spark-api"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y ca-certificates curl git gnupg jq nginx certbot ufw rsync

# Spark package.json requires Node >=24.18.1 and npm >=11.6.2.
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
npm install -g npm@^11.6.2
node -e 'const [maj,min]=process.versions.node.split(".").map(Number); if (maj<24 || (maj===24 && min<18)) process.exit(1)'

# Verify private routes before exposing the public API.
timeout 3 bash -c "</dev/tcp/${S2_PRIVATE_IP}/8000" || { echo "ERROR: Server 2 ${S2_PRIVATE_IP}:8000 is unreachable"; exit 1; }
timeout 3 bash -c "</dev/tcp/${S3_PRIVATE_IP}/9000" || { echo "ERROR: Server 3 ${S3_PRIVATE_IP}:9000 is unreachable"; exit 1; }

if [[ ! -d "${APP_DIR}/.git" ]]; then git clone "${SPARK_REPO}" "${APP_DIR}"; fi
git -C "${APP_DIR}" fetch --prune origin
git -C "${APP_DIR}" checkout "${SPARK_REF}"
git -C "${APP_DIR}" pull --ff-only origin "${SPARK_REF}" || true

cat > "${APP_DIR}/.env.production" <<EOF
VITE_SUPABASE_URL=https://${API_DOMAIN}
VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
EOF
chmod 600 "${APP_DIR}/.env.production"

cd "${APP_DIR}"
npm ci
npm run build
install -d -m 0755 "${WEB_ROOT}" "${ACME_ROOT}"
rsync -a --delete dist/ "${WEB_ROOT}/"
chown -R www-data:www-data "${WEB_ROOT}" "${ACME_ROOT}"

cat > /etc/nginx/snippets/spark-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 10s;
proxy_send_timeout 120s;
proxy_read_timeout 120s;
EOF

cat > /etc/nginx/snippets/spark-security.conf <<'EOF'
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header Permissions-Policy "camera=(self), microphone=(self), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin-allow-popups" always;
add_header Cross-Origin-Resource-Policy "same-site" always;
add_header X-Permitted-Cross-Domain-Policies "none" always;
add_header X-DNS-Prefetch-Control "off" always;
add_header X-XSS-Protection "0" always;
EOF

cat > "${NGINX_SITE}" <<EOF
server {
  listen 80;
  server_name ${APP_DOMAIN} ${WWW_DOMAIN};
  location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
  location / { return 301 https://${APP_DOMAIN}\$request_uri; }
}
EOF
cat > "${API_SITE}" <<EOF
server {
  listen 80;
  server_name ${API_DOMAIN};
  location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
  location / { return 301 https://${API_DOMAIN}\$request_uri; }
}
EOF
ln -sfn "${NGINX_SITE}" /etc/nginx/sites-enabled/spark
ln -sfn "${API_SITE}" /etc/nginx/sites-enabled/spark-api
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

certbot certonly --webroot -w "${ACME_ROOT}" -d "${APP_DOMAIN}" -d "${WWW_DOMAIN}" --email "${LETSENCRYPT_EMAIL}" --agree-tos --non-interactive
certbot certonly --webroot -w "${ACME_ROOT}" -d "${API_DOMAIN}" --email "${LETSENCRYPT_EMAIL}" --agree-tos --non-interactive

cat > "${NGINX_SITE}" <<EOF
server {
  listen 80;
  server_name ${APP_DOMAIN} ${WWW_DOMAIN};
  location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
  location / { return 301 https://${APP_DOMAIN}\$request_uri; }
}
server {
  listen 443 ssl http2;
  server_name ${APP_DOMAIN} ${WWW_DOMAIN};
  ssl_certificate /etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  root ${WEB_ROOT};
  index index.html;
  include /etc/nginx/snippets/spark-security.conf;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  location /assets/ { try_files \$uri =404; access_log off; expires 30d; add_header Cache-Control "public, max-age=2592000, immutable"; }
  location / { try_files \$uri \$uri/ /index.html; add_header Cache-Control "no-store"; }
}
EOF

cat > "${API_SITE}" <<EOF
map \$http_upgrade \$spark_connection_upgrade { default upgrade; '' close; }
server {
  listen 80;
  server_name ${API_DOMAIN};
  location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
  location / { return 301 https://${API_DOMAIN}\$request_uri; }
}
server {
  listen 443 ssl http2;
  server_name ${API_DOMAIN};
  ssl_certificate /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  client_max_body_size 50m;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "no-referrer" always;
  add_header X-Frame-Options "DENY" always;

  # Edge Functions are physically on Server 3. Trailing slash strips /functions/v1/.
  location ^~ /functions/v1/ {
    proxy_pass http://${S3_PRIVATE_IP}:9000/;
    include /etc/nginx/snippets/spark-proxy.conf;
  }
  # Realtime stays on Server 2 and needs websocket upgrade.
  location ^~ /realtime/v1/ {
    proxy_pass http://${S2_PRIVATE_IP}:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection \$spark_connection_upgrade;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }
  location ^~ /auth/v1/ { proxy_pass http://${S2_PRIVATE_IP}:8000; include /etc/nginx/snippets/spark-proxy.conf; }
  location ^~ /rest/v1/ { proxy_pass http://${S2_PRIVATE_IP}:8000; include /etc/nginx/snippets/spark-proxy.conf; }
  location ^~ /storage/v1/ { proxy_pass http://${S2_PRIVATE_IP}:8000; include /etc/nginx/snippets/spark-proxy.conf; }
  location ^~ /graphql/v1 { proxy_pass http://${S2_PRIVATE_IP}:8000; include /etc/nginx/snippets/spark-proxy.conf; }
  # Studio, Kong admin and arbitrary internal routes are intentionally not public.
  location / { return 404; }
}
EOF

nginx -t
systemctl reload nginx

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${ADMIN_CIDR}" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

curl -fsSI "https://${APP_DOMAIN}/" >/dev/null
curl -fsS "https://${API_DOMAIN}/auth/v1/health" >/dev/null
systemctl is-active --quiet nginx

cat <<EOF
Server 1 installed.
Public: https://${APP_DOMAIN} and https://${API_DOMAIN}
Private upstreams: Server2 ${S2_PRIVATE_IP}:8000, Server3 ${S3_PRIVATE_IP}:9000
Update:
  cd ${APP_DIR} && git fetch origin && git checkout ${SPARK_REF} && git pull --ff-only
  npm ci && npm run build
  rsync -a --delete dist/ ${WEB_ROOT}/
  nginx -t && systemctl reload nginx
EOF