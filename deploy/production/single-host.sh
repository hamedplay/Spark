#!/usr/bin/env bash
set -Eeuo pipefail

# Spark SINGLE-HOST production topology
# Ubuntu 24.04, root. Web + Nginx + Supabase Core/PostgreSQL + all Edge
# Functions + avatar worker + schedulers + TURN/STUN on one VPS.
# PostgreSQL is NEVER published to a public interface.
#
# Required:
#   APP_DOMAIN WWW_DOMAIN API_DOMAIN TURN_DOMAIN
#   TURN_PUBLIC_IP TURN_PRIVATE_IP ADMIN_CIDR LETSENCRYPT_EMAIL
# Optional:
#   SPARK_REPO SPARK_REF SUPABASE_REF TURN_MIN_PORT TURN_MAX_PORT

: "${APP_DOMAIN:?Set APP_DOMAIN}"
: "${WWW_DOMAIN:?Set WWW_DOMAIN}"
: "${API_DOMAIN:?Set API_DOMAIN}"
: "${TURN_DOMAIN:?Set TURN_DOMAIN}"
: "${TURN_PUBLIC_IP:?Set TURN_PUBLIC_IP}"
: "${TURN_PRIVATE_IP:?Set TURN_PRIVATE_IP}"
: "${ADMIN_CIDR:?Set ADMIN_CIDR}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL}"
SPARK_REPO="${SPARK_REPO:-https://github.com/hamedplay/Spark.git}"
SPARK_REF="${SPARK_REF:-main}"
SUPABASE_REF="${SUPABASE_REF:-master}"
APP_DIR=/opt/spark
SB_SRC=/opt/supabase-source
SB_DIR=/opt/spark-supabase
WEB_ROOT=/var/www/spark
ACME_ROOT=/var/www/acme
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49200}"
[[ $EUID -eq 0 ]] || { echo 'Run as root'; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update && apt-get upgrade -y
apt-get install -y ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml nginx certbot coturn

# Docker + Node 24. Spark package.json currently requires Node >=24.18.1 / npm >=11.6.2.
install -m0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
chmod a+r /etc/apt/keyrings/docker.gpg /etc/apt/keyrings/nodesource.gpg
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" >/etc/apt/sources.list.d/docker.list
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_24.x nodistro main" >/etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin nodejs
npm install -g npm@^11.6.2
systemctl enable --now docker nginx

# Application and reviewed Supabase Docker snapshot.
if [[ ! -d ${APP_DIR}/.git ]]; then git clone "$SPARK_REPO" "$APP_DIR"; fi
git -C "$APP_DIR" fetch --prune origin
git -C "$APP_DIR" checkout "$SPARK_REF"
git -C "$APP_DIR" pull --ff-only origin "$SPARK_REF" || true
rm -rf "$SB_SRC"
git clone https://github.com/supabase/supabase.git "$SB_SRC"
git -C "$SB_SRC" checkout "$SUPABASE_REF"
SUPABASE_COMMIT="$(git -C "$SB_SRC" rev-parse HEAD)"
rm -rf "$SB_DIR" && mkdir -p "$SB_DIR"
cp -a "$SB_SRC/docker/." "$SB_DIR/"
printf '%s\n' "$SUPABASE_COMMIT" >"$SB_DIR/SUPABASE_UPSTREAM_COMMIT"
cd "$SB_DIR"
cp .env.example .env
./utils/generate-keys.sh
[[ ! -x ./utils/add-new-auth-keys.sh ]] || ./utils/add-new-auth-keys.sh
chmod 600 .env

set_env(){ python3 - "$SB_DIR/.env" "$1" "$2" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); k=sys.argv[2]; v=sys.argv[3]
out=[]; found=False
for line in p.read_text().splitlines():
    if line.startswith(k+'='):
        out.append(f'{k}={v}'); found=True
    else: out.append(line)
if not found: out.append(f'{k}={v}')
p.write_text('\n'.join(out)+'\n')
PY
}
set_env SUPABASE_PUBLIC_URL "https://${API_DOMAIN}"
set_env API_EXTERNAL_URL "https://${API_DOMAIN}"
set_env SITE_URL "https://${APP_DOMAIN}"
set_env ADDITIONAL_REDIRECT_URLS "https://${APP_DOMAIN}/*,https://${WWW_DOMAIN}/*"
set_env FUNCTIONS_VERIFY_JWT false
set_env PHONE_LOGIN_ALLOWED_ORIGINS "https://${APP_DOMAIN},https://${WWW_DOMAIN}"
set_env SEND_SMS_HOOK_SECRET "v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
set_env PHONE_RATE_LIMIT_PEPPER "$(openssl rand -hex 32)"
set_env PHONE_PASSWORD_RESET_SECRET "$(openssl rand -hex 32)"
set_env DAILY_REPORT_CRON_SECRET "$(openssl rand -hex 32)"
set_env NOTIFICATION_OUTBOX_CRON_SECRET "$(openssl rand -hex 32)"
set_env MINUTES_REMINDER_CRON_SECRET "$(openssl rand -hex 32)"
set_env DECISION_DUE_CRON_SECRET "$(openssl rand -hex 32)"

# Copy every Spark function but preserve the official self-hosted main router.
rsync -a --delete "$APP_DIR/supabase/functions/" "$SB_DIR/volumes/functions/"
rm -rf "$SB_DIR/volumes/functions/main"
cp -a "$SB_SRC/docker/volumes/functions/main" "$SB_DIR/volumes/functions/main"

SERVICE_ROLE_KEY="$(grep '^SERVICE_ROLE_KEY=' .env|cut -d= -f2-)"
install -d -m0700 /etc/spark
cat >/etc/spark/avatar-worker.env <<EOF
SUPABASE_URL=http://kong:8000
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
AVATAR_WORKER_ID=avatar-worker-single
EOF
chmod 600 /etc/spark/avatar-worker.env
# Optional provider credentials used by enabled Edge Functions go here.
touch /etc/spark/functions-extra.env
chmod 600 /etc/spark/functions-extra.env

# Core API stays loopback-only. DB stays Docker-private. GoTrue calls the local
# Edge Runtime for Send-SMS hook. Custom Spark env variables are injected into Functions.
python3 - "$SB_DIR/docker-compose.yml" <<'PY'
from pathlib import Path
import sys,yaml
p=Path(sys.argv[1]); d=yaml.safe_load(p.read_text()); s=d['services']
for n in ('kong','auth','db','functions'):
    if n not in s: raise SystemExit(f'Missing Supabase service: {n}')
s['kong']['ports']=['127.0.0.1:8000:8000/tcp']
s['db'].pop('ports',None)
if 'supavisor' in s: s['supavisor']['ports']=['127.0.0.1:5433:5432/tcp','127.0.0.1:6543:6543/tcp']
a=s['auth'].setdefault('environment',{})
a['GOTRUE_HOOK_SEND_SMS_ENABLED']='true'
a['GOTRUE_HOOK_SEND_SMS_URI']='http://functions:9000/auth-send-sms-hook'
a['GOTRUE_HOOK_SEND_SMS_SECRETS']='${SEND_SMS_HOOK_SECRET}'
fsvc=s['functions']
envf=fsvc.setdefault('env_file',[])
if isinstance(envf,str): envf=[envf]
if '/etc/spark/functions-extra.env' not in envf: envf.append('/etc/spark/functions-extra.env')
fsvc['env_file']=envf
f=fsvc.setdefault('environment',{})
for k in ['SEND_SMS_HOOK_SECRET','PHONE_RATE_LIMIT_PEPPER','PHONE_PASSWORD_RESET_SECRET','PHONE_LOGIN_ALLOWED_ORIGINS','DAILY_REPORT_CRON_SECRET','NOTIFICATION_OUTBOX_CRON_SECRET','MINUTES_REMINDER_CRON_SECRET','DECISION_DUE_CRON_SECRET']:
    f[k]='${'+k+'}'
s['avatar-worker']={
 'build':{'context':'/opt/spark/worker','dockerfile':'Dockerfile'},
 'restart':'unless-stopped','env_file':['/etc/spark/avatar-worker.env'],
 'depends_on':{'kong':{'condition':'service_healthy'}},
 'read_only':True,'tmpfs':['/tmp:size=64m,mode=1777'],
 'security_opt':['no-new-privileges:true'],'cap_drop':['ALL']}
p.write_text(yaml.safe_dump(d,sort_keys=False,width=120))
PY

docker compose config >/dev/null
docker compose pull
docker compose build avatar-worker
docker compose up -d
sleep 12
docker compose ps

# Apply all application migrations through loopback Supavisor.
POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' .env|cut -d= -f2-)"
ANON_KEY="$(grep '^ANON_KEY=' .env|cut -d= -f2-)"
ENC="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$POSTGRES_PASSWORD")"
cd "$APP_DIR"
npx --yes supabase@latest db push --db-url "postgresql://postgres:${ENC}@127.0.0.1:5433/postgres" --dry-run
npx --yes supabase@latest db push --db-url "postgresql://postgres:${ENC}@127.0.0.1:5433/postgres" --include-all

# Build frontend against the same public API hostname used in four-server mode.
cat >.env.production <<EOF
VITE_SUPABASE_URL=https://${API_DOMAIN}
VITE_SUPABASE_ANON_KEY=${ANON_KEY}
EOF
chmod 600 .env.production
npm ci
npm run build
install -d -m0755 "$WEB_ROOT" "$ACME_ROOT"
rsync -a --delete dist/ "$WEB_ROOT/"
chown -R www-data:www-data "$WEB_ROOT" "$ACME_ROOT"

# Initial ACME bootstrap for app/API/TURN domains.
cat >/etc/nginx/sites-available/spark-bootstrap <<EOF
server { listen 80; server_name ${APP_DOMAIN} ${WWW_DOMAIN} ${API_DOMAIN} ${TURN_DOMAIN}; location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; } location / { return 404; } }
EOF
ln -sfn /etc/nginx/sites-available/spark-bootstrap /etc/nginx/sites-enabled/spark-bootstrap
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot certonly --webroot -w "$ACME_ROOT" -d "$APP_DOMAIN" -d "$WWW_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive
certbot certonly --webroot -w "$ACME_ROOT" -d "$API_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive
certbot certonly --webroot -w "$ACME_ROOT" -d "$TURN_DOMAIN" --email "$LETSENCRYPT_EMAIL" --agree-tos --non-interactive

cat >/etc/nginx/sites-available/spark <<EOF
map \$http_upgrade \$spark_connection_upgrade { default upgrade; '' close; }
server {
 listen 80; server_name ${APP_DOMAIN} ${WWW_DOMAIN} ${API_DOMAIN} ${TURN_DOMAIN};
 location ^~ /.well-known/acme-challenge/ { root ${ACME_ROOT}; }
 location / { if (\$host = ${TURN_DOMAIN}) { return 404; } return 301 https://\$host\$request_uri; }
}
server {
 listen 443 ssl http2; server_name ${APP_DOMAIN} ${WWW_DOMAIN};
 ssl_certificate /etc/letsencrypt/live/${APP_DOMAIN}/fullchain.pem; ssl_certificate_key /etc/letsencrypt/live/${APP_DOMAIN}/privkey.pem; include /etc/letsencrypt/options-ssl-nginx.conf;
 root ${WEB_ROOT}; index index.html;
 add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always; add_header X-Content-Type-Options nosniff always; add_header X-Frame-Options SAMEORIGIN always;
 location /assets/ { try_files \$uri =404; expires 30d; add_header Cache-Control "public, max-age=2592000, immutable"; }
 location / { try_files \$uri \$uri/ /index.html; add_header Cache-Control no-store; }
}
server {
 listen 443 ssl http2; server_name ${API_DOMAIN};
 ssl_certificate /etc/letsencrypt/live/${API_DOMAIN}/fullchain.pem; ssl_certificate_key /etc/letsencrypt/live/${API_DOMAIN}/privkey.pem; include /etc/letsencrypt/options-ssl-nginx.conf; client_max_body_size 50m;
 location ^~ /realtime/v1/ { proxy_pass http://127.0.0.1:8000; proxy_http_version 1.1; proxy_set_header Upgrade \$http_upgrade; proxy_set_header Connection \$spark_connection_upgrade; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_read_timeout 3600s; }
 location ^~ /functions/v1/ { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; }
 location ^~ /auth/v1/ { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
 location ^~ /rest/v1/ { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
 location ^~ /storage/v1/ { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
 location ^~ /graphql/v1 { proxy_pass http://127.0.0.1:8000; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto \$scheme; }
 location / { return 404; }
}
EOF
ln -sfn /etc/nginx/sites-available/spark /etc/nginx/sites-enabled/spark
rm -f /etc/nginx/sites-enabled/spark-bootstrap
nginx -t && systemctl reload nginx

# Local schedulers invoke Functions through local Kong, never via public hairpin.
cat >/usr/local/sbin/spark-local-function-trigger <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
FN="\${1:?function}"; SECRET_NAME="\${2:?secret}"; BODY="\${3:-{}}"
set -a; source ${SB_DIR}/.env; set +a
SECRET="\${!SECRET_NAME:-}"; [[ -n "\$SECRET" ]] || exit 1
curl --fail --silent --show-error -X POST "http://127.0.0.1:8000/functions/v1/\$FN" -H 'content-type: application/json' -H "x-cron-secret: \$SECRET" --data "\$BODY"
EOF
chmod 750 /usr/local/sbin/spark-local-function-trigger
make_timer(){ local n=$1 f=$2 s=$3 e=$4 b=$5; printf '[Unit]\nAfter=docker.service\nRequires=docker.service\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/spark-local-function-trigger %s %s '\''%s'\''\n' "$f" "$s" "$b" >"/etc/systemd/system/$n.service"; printf '[Timer]\nOnBootSec=2min\nOnUnitActiveSec=%s\nPersistent=true\n[Install]\nWantedBy=timers.target\n' "$e" >"/etc/systemd/system/$n.timer"; }
make_timer spark-daily-report send-daily-meetings DAILY_REPORT_CRON_SECRET 5min '{"scheduled":true}'
make_timer spark-minutes-reminder process-minutes-reminders MINUTES_REMINDER_CRON_SECRET 5min '{}'
make_timer spark-decision-due process-decision-due-overdue DECISION_DUE_CRON_SECRET 10min '{}'
make_timer spark-notification-outbox process-notification-outbox NOTIFICATION_OUTBOX_CRON_SECRET 1min '{}'
systemctl daemon-reload
systemctl enable --now spark-daily-report.timer spark-minutes-reminder.timer spark-decision-due.timer spark-notification-outbox.timer

# TURN: copy Let's Encrypt key material to a coturn-readable protected location.
TURN_SECRET="$(openssl rand -base64 48|tr -d '\n')"
TURN_CERT_DIR=/etc/coturn/certs
install -d -m0750 -o turnserver -g turnserver "$TURN_CERT_DIR"
install -m0640 -o turnserver -g turnserver "/etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem" "$TURN_CERT_DIR/fullchain.pem"
install -m0640 -o turnserver -g turnserver "/etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem" "$TURN_CERT_DIR/privkey.pem"
install -d -m0700 /etc/spark
printf 'TURN_DOMAIN=%s\nTURN_SHARED_SECRET=%s\n' "$TURN_DOMAIN" "$TURN_SECRET" >/etc/spark/turn-secret.env
chmod 600 /etc/spark/turn-secret.env
if [[ "$TURN_PUBLIC_IP" == "$TURN_PRIVATE_IP" ]]; then EXT="external-ip=$TURN_PUBLIC_IP"; else EXT="external-ip=$TURN_PUBLIC_IP/$TURN_PRIVATE_IP"; fi
cat >/etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
listening-ip=${TURN_PRIVATE_IP}
relay-ip=${TURN_PRIVATE_IP}
${EXT}
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_DOMAIN}
server-name=${TURN_DOMAIN}
min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}
cert=${TURN_CERT_DIR}/fullchain.pem
pkey=${TURN_CERT_DIR}/privkey.pem
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
no-tlsv1
no-tlsv1_1
EOF
[[ -f /etc/default/coturn ]] && sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
systemctl enable --now coturn

# Refresh coturn's protected certificate copy after every Certbot renewal.
install -d /etc/letsencrypt/renewal-hooks/deploy
cat >/etc/letsencrypt/renewal-hooks/deploy/spark-single-turn.sh <<EOF
#!/usr/bin/env bash
set -e
install -m0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem ${TURN_CERT_DIR}/fullchain.pem
install -m0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem ${TURN_CERT_DIR}/privkey.pem
systemctl restart coturn
EOF
chmod 750 /etc/letsencrypt/renewal-hooks/deploy/spark-single-turn.sh

# Public firewall; PostgreSQL/Kong/Supavisor are loopback/Docker only.
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp"
ufw --force enable

# End-to-end health checks.
curl -fsS http://127.0.0.1:8000/auth/v1/health >/dev/null
curl -fsSI "https://${APP_DOMAIN}/" >/dev/null
curl -fsS "https://${API_DOMAIN}/auth/v1/health" >/dev/null
curl -sS -o /dev/null -w '%{http_code}\n' "https://${API_DOMAIN}/functions/v1/password-login" | grep -Eq '^(200|204|400|401|405)$'
systemctl is-active --quiet nginx coturn
systemctl list-timers 'spark-*' --no-pager
if ss -lntp | grep -E '(^|[[:space:]])0\.0\.0\.0:5432|\[::\]:5432'; then echo 'ERROR: PostgreSQL is public'; exit 1; fi

cat <<EOF
Single-host Spark installed.
Web:       https://${APP_DOMAIN}
API:       https://${API_DOMAIN}
Functions: https://${API_DOMAIN}/functions/v1/<name>
TURN:      turn:${TURN_DOMAIN}:3478 / turns:${TURN_DOMAIN}:5349
Database:  Docker-private; not published to Internet
Supabase:  ${SUPABASE_COMMIT}
Optional provider Edge-Function secrets: /etc/spark/functions-extra.env
EOF