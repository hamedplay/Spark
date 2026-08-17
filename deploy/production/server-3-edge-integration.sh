#!/usr/bin/env bash
set -Eeuo pipefail

# Spark - Server 3: Edge Functions + Integration + Workers (DMZ)
# Ubuntu 24.04. Run as root.
#
# MODES
# 1) Prepare the completely offline Server-2 bundle (run BEFORE Server 2):
#      sudo bash server-3-edge-integration.sh prepare-server2-bundle
#    Output: /root/spark-server2-offline-bundle.tar.gz + bootstrap script
#
# 2) Install Server 3 after Server 2 has generated /root/server3.env:
#      sudo bash server-3-edge-integration.sh install
#
# Install-mode required variables:
#   export S1_PRIVATE_IP="10.20.0.11"
#   export S2_PRIVATE_IP="10.20.0.12"
#   export S3_PRIVATE_IP="10.20.0.13"
#   export PRIVATE_CIDR="10.20.0.0/24"
#   export ADMIN_CIDR="203.0.113.10/32"
#   export APP_DOMAIN="shahrmeeting.ir"
#   export API_DOMAIN="api.shahrmeeting.ir"
# Optional: SERVER2_ENV_FILE, SPARK_REPO, SPARK_REF, SUPABASE_REF.

MODE="${1:-install}"
SPARK_REPO="${SPARK_REPO:-https://github.com/hamedplay/Spark.git}"
SPARK_REF="${SPARK_REF:-main}"
SUPABASE_REF="${SUPABASE_REF:-master}"
SERVER2_ENV_FILE="${SERVER2_ENV_FILE:-/root/server3.env}"
APP_DIR="/opt/spark"
SB_SRC="/opt/supabase-source"
EDGE_DIR="/opt/spark-edge"
FUNCTIONS_DIR="${EDGE_DIR}/functions"
[[ "${EUID}" -eq 0 ]] || { echo "Run as root"; exit 1; }

install_base() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get upgrade -y
  apt-get install -y ca-certificates curl git gnupg jq openssl ufw rsync python3 python3-yaml chrony tar
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
}

prepare_server2_bundle() {
  install_base
  local work=/root/spark-server2-bundle-work bundle=/root/spark-server2-offline-bundle.tar.gz bootstrap=/root/server-2-supabase-core.sh
  rm -rf "$work" "$bundle" "${bundle}.sha256" "$bootstrap"
  mkdir -p "$work/bundle/bin" "$work/src"

  git clone "$SPARK_REPO" "$work/src/spark"
  git -C "$work/src/spark" checkout "$SPARK_REF"
  local spark_commit
  spark_commit="$(git -C "$work/src/spark" rev-parse HEAD)"
  mkdir -p "$work/bundle/spark"
  git -C "$work/src/spark" archive "$spark_commit" | tar -x -C "$work/bundle/spark"
  install -m 0700 "$work/src/spark/deploy/production/server-2-supabase-core.sh" "$bootstrap"

  git clone https://github.com/supabase/supabase.git "$work/src/supabase"
  git -C "$work/src/supabase" checkout "$SUPABASE_REF"
  local supabase_commit
  supabase_commit="$(git -C "$work/src/supabase" rev-parse HEAD)"
  cp -a "$work/src/supabase/docker" "$work/bundle/supabase-docker"

  cd "$work/bundle/supabase-docker"
  cp .env.example .env
  local images
  images="$(docker compose config --images | sort -u)"
  [[ -n "$images" ]] || { echo "No Supabase images resolved"; exit 1; }
  while IFS= read -r image; do docker pull "$image"; done <<< "$images"
  docker pull nginx:1.27-alpine
  docker save $images nginx:1.27-alpine -o "$work/bundle/docker-images.tar"
  rm -f .env

  # Native CLI lets Server 2 apply migrations with zero public-network dependency.
  local arch asset latest tmp
  case "$(uname -m)" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo "Unsupported architecture"; exit 1 ;; esac
  latest="$(curl -fsSL https://api.github.com/repos/supabase/cli/releases/latest | jq -r '.tag_name')"
  [[ -n "$latest" && "$latest" != null ]] || { echo "Could not resolve Supabase CLI release"; exit 1; }
  asset="https://github.com/supabase/cli/releases/download/${latest}/supabase_linux_${arch}.tar.gz"
  tmp="$(mktemp -d)"
  curl -fsSL "$asset" -o "$tmp/cli.tgz"
  tar -xzf "$tmp/cli.tgz" -C "$tmp"
  install -m 0755 "$tmp/supabase" "$work/bundle/bin/supabase"
  rm -rf "$tmp"

  cat > "$work/bundle/manifest.env" <<EOF
SUPABASE_UPSTREAM_COMMIT='${supabase_commit}'
SPARK_COMMIT='${spark_commit}'
SUPABASE_CLI_RELEASE='${latest}'
EOF
  cat > "$work/bundle/README-OFFLINE.txt" <<'EOF'
Generated on Internet-enabled Server 3 for isolated Server 2.
Contains a reviewed Spark snapshot, exact Supabase Docker snapshot, required OCI
images and native Supabase CLI. Contains no production credentials.
EOF
  tar -C "$work/bundle" -czf "$bundle" .
  sha256sum "$bundle" | tee "${bundle}.sha256"
  chmod 600 "$bundle" "${bundle}.sha256" "$bootstrap"
  echo "Offline Server-2 media ready:"
  echo "  $bundle"
  echo "  ${bundle}.sha256"
  echo "  $bootstrap"
  echo "Transfer all three over the PRIVATE/admin network to Server 2 /root/."
  exit 0
}

if [[ "$MODE" == "prepare-server2-bundle" ]]; then prepare_server2_bundle; fi
[[ "$MODE" == "install" ]] || { echo "Usage: $0 {prepare-server2-bundle|install}"; exit 2; }

: "${S1_PRIVATE_IP:?Set S1_PRIVATE_IP}"
: "${S2_PRIVATE_IP:?Set S2_PRIVATE_IP}"
: "${S3_PRIVATE_IP:?Set S3_PRIVATE_IP}"
: "${PRIVATE_CIDR:?Set PRIVATE_CIDR}"
: "${ADMIN_CIDR:?Set ADMIN_CIDR}"
: "${APP_DOMAIN:?Set APP_DOMAIN}"
: "${API_DOMAIN:?Set API_DOMAIN}"
[[ -f "${SERVER2_ENV_FILE}" ]] || { echo "Missing ${SERVER2_ENV_FILE}"; exit 1; }
chmod 600 "${SERVER2_ENV_FILE}"
# shellcheck disable=SC1090
source "${SERVER2_ENV_FILE}"
: "${SUPABASE_UPSTREAM_COMMIT:?Missing SUPABASE_UPSTREAM_COMMIT}"
: "${SUPABASE_ANON_KEY:?Missing SUPABASE_ANON_KEY}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Missing SUPABASE_SERVICE_ROLE_KEY}"
: "${JWT_SECRET:?Missing JWT_SECRET}"
: "${POSTGRES_PASSWORD:?Missing POSTGRES_PASSWORD}"
: "${SEND_SMS_HOOK_SECRET:?Missing SEND_SMS_HOOK_SECRET}"
ip -o addr show | grep -Fq "${S3_PRIVATE_IP}" || { echo "${S3_PRIVATE_IP} is not configured on this host"; exit 1; }
install_base

# Server 3 is the private NTP source for the isolated DB/Core server.
cat > /etc/chrony/chrony.conf <<EOF
pool pool.ntp.org iburst
allow ${S2_PRIVATE_IP}/32
makestep 1.0 3
rtcsync
driftfile /var/lib/chrony/chrony.drift
logdir /var/log/chrony
EOF
systemctl restart chrony

if [[ ! -d "${APP_DIR}/.git" ]]; then git clone "${SPARK_REPO}" "${APP_DIR}"; fi
git -C "${APP_DIR}" fetch --prune origin
git -C "${APP_DIR}" checkout "${SPARK_REF}"
git -C "${APP_DIR}" pull --ff-only origin "${SPARK_REF}" || true
rm -rf "${SB_SRC}"
git clone https://github.com/supabase/supabase.git "${SB_SRC}"
git -C "${SB_SRC}" checkout "${SUPABASE_UPSTREAM_COMMIT}"
EDGE_RUNTIME_IMAGE="$(python3 - "${SB_SRC}/docker/docker-compose.yml" <<'PY'
import sys,yaml
print(yaml.safe_load(open(sys.argv[1]))['services']['functions']['image'])
PY
)"
[[ -n "$EDGE_RUNTIME_IMAGE" ]] || { echo "Could not resolve Edge Runtime image"; exit 1; }

install -d -m 0755 "$FUNCTIONS_DIR"
rsync -a --delete "$APP_DIR/supabase/functions/" "$FUNCTIONS_DIR/"
rm -rf "$FUNCTIONS_DIR/main"
cp -a "$SB_SRC/docker/volumes/functions/main" "$FUNCTIONS_DIR/main"
install -d -m 0700 /etc/spark
POSTGRES_PASSWORD_URLENC="$(python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$POSTGRES_PASSWORD")"

DAILY_REPORT_CRON_SECRET="$(openssl rand -hex 32)"
NOTIFICATION_OUTBOX_CRON_SECRET="$(openssl rand -hex 32)"
MINUTES_REMINDER_CRON_SECRET="$(openssl rand -hex 32)"
DECISION_DUE_CRON_SECRET="$(openssl rand -hex 32)"
PHONE_RATE_LIMIT_PEPPER="$(openssl rand -hex 32)"
PHONE_PASSWORD_RESET_SECRET="$(openssl rand -hex 32)"
cat > /etc/spark/functions.env <<EOF
JWT_SECRET=${JWT_SECRET}
SUPABASE_URL=http://api-router:8080
SUPABASE_PUBLIC_URL=https://${API_DOMAIN}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
SUPABASE_DB_URL=postgresql://postgres:${POSTGRES_PASSWORD_URLENC}@${S2_PRIVATE_IP}:5432/postgres
VERIFY_JWT=false
SEND_SMS_HOOK_SECRET=${SEND_SMS_HOOK_SECRET}
PHONE_RATE_LIMIT_PEPPER=${PHONE_RATE_LIMIT_PEPPER}
PHONE_PASSWORD_RESET_SECRET=${PHONE_PASSWORD_RESET_SECRET}
PHONE_LOGIN_ALLOWED_ORIGINS=https://${APP_DOMAIN},https://www.${APP_DOMAIN}
ALLOWED_ORIGINS=https://${APP_DOMAIN},https://www.${APP_DOMAIN}
DAILY_REPORT_CRON_SECRET=${DAILY_REPORT_CRON_SECRET}
NOTIFICATION_OUTBOX_CRON_SECRET=${NOTIFICATION_OUTBOX_CRON_SECRET}
MINUTES_REMINDER_CRON_SECRET=${MINUTES_REMINDER_CRON_SECRET}
DECISION_DUE_CRON_SECRET=${DECISION_DUE_CRON_SECRET}
EOF
chmod 600 /etc/spark/functions.env
touch /etc/spark/functions-extra.env
chmod 600 /etc/spark/functions-extra.env
cat > /etc/spark/avatar-worker.env <<EOF
SUPABASE_URL=http://api-router:8080
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
AVATAR_WORKER_ID=avatar-worker-s3
EOF
chmod 600 /etc/spark/avatar-worker.env

cat > "$EDGE_DIR/api-router.conf" <<EOF
server {
  listen 8080;
  client_max_body_size 50m;
  location ^~ /functions/v1/ { proxy_pass http://functions:9000/; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto http; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; }
  location / { proxy_pass http://${S2_PRIVATE_IP}:8000; proxy_http_version 1.1; proxy_set_header Host \$host; proxy_set_header X-Forwarded-Proto http; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; }
}
EOF
cat > "$EDGE_DIR/docker-compose.yml" <<EOF
services:
  functions:
    image: ${EDGE_RUNTIME_IMAGE}
    restart: unless-stopped
    env_file: [/etc/spark/functions.env, /etc/spark/functions-extra.env]
    command: ["start", "--main-service", "/home/deno/functions/main"]
    volumes: ["${FUNCTIONS_DIR}:/home/deno/functions:ro"]
    ports: ["${S3_PRIVATE_IP}:9000:9000"]
  api-router:
    image: nginx:1.27-alpine
    restart: unless-stopped
    depends_on: [functions]
    volumes: ["${EDGE_DIR}/api-router.conf:/etc/nginx/conf.d/default.conf:ro"]
  avatar-worker:
    build: {context: ${APP_DIR}/worker, dockerfile: Dockerfile}
    restart: unless-stopped
    env_file: [/etc/spark/avatar-worker.env]
    depends_on: [api-router]
    mem_limit: 512m
    cpus: 0.5
    read_only: true
    tmpfs: [/tmp:size=64m,mode=1777]
    security_opt: [no-new-privileges:true]
    cap_drop: [ALL]
EOF
cd "$EDGE_DIR"
docker compose config >/dev/null
docker compose pull functions api-router
docker compose build avatar-worker
docker compose up -d
sleep 8
docker compose ps

cat > /usr/local/sbin/spark-function-trigger <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
FN="${1:?function name required}"; SECRET_NAME="${2:?secret variable name required}"; BODY="${3:-{}}"
set -a; source /etc/spark/functions.env; set +a
SECRET="${!SECRET_NAME:-}"; [[ -n "$SECRET" ]] || { echo "Missing ${SECRET_NAME}"; exit 1; }
exec curl --fail --silent --show-error --connect-timeout 5 --max-time 120 -X POST "http://127.0.0.1:9000/${FN}" -H "content-type: application/json" -H "x-cron-secret: ${SECRET}" --data "$BODY"
EOF
chmod 750 /usr/local/sbin/spark-function-trigger
make_timer(){ local n=$1 f=$2 s=$3 e=$4 b=$5; cat >"/etc/systemd/system/${n}.service" <<EOF
[Unit]
Description=Spark scheduler: ${f}
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/spark-function-trigger ${f} ${s} '${b}'
EOF
cat >"/etc/systemd/system/${n}.timer" <<EOF
[Timer]
OnBootSec=2min
OnUnitActiveSec=${e}
Persistent=true
AccuracySec=15s
[Install]
WantedBy=timers.target
EOF
}
make_timer spark-daily-report send-daily-meetings DAILY_REPORT_CRON_SECRET 5min '{"scheduled":true}'
make_timer spark-minutes-reminder process-minutes-reminders MINUTES_REMINDER_CRON_SECRET 5min '{}'
make_timer spark-decision-due process-decision-due-overdue DECISION_DUE_CRON_SECRET 10min '{}'
make_timer spark-notification-outbox process-notification-outbox NOTIFICATION_OUTBOX_CRON_SECRET 1min '{}'
systemctl daemon-reload
systemctl enable --now spark-daily-report.timer spark-minutes-reminder.timer spark-decision-due.timer spark-notification-outbox.timer

# Host DMZ boundary. SMS/Rahyab may require outbound HTTPS on TCP/8443; Bale,
# Telegram, registries and normal integrations use TCP/443.
ufw --force reset
ufw default deny incoming
ufw default deny outgoing
ufw allow from "$ADMIN_CIDR" to any port 22 proto tcp
ufw allow from "$S1_PRIVATE_IP" to "$S3_PRIVATE_IP" port 9000 proto tcp
ufw allow from "$S2_PRIVATE_IP" to "$S3_PRIVATE_IP" port 9000 proto tcp
ufw allow from "$S2_PRIVATE_IP" to "$S3_PRIVATE_IP" port 123 proto udp
ufw allow out to "$PRIVATE_CIDR"
ufw allow out 53/udp
ufw allow out 53/tcp
ufw allow out 123/udp
ufw allow out 443/tcp
ufw allow out 8443/tcp
ufw --force enable

# Docker can bypass ordinary UFW forwarding rules. Restrict Edge/worker containers
# to private networks plus DNS/NTP/HTTPS(443/8443), then reject other Internet egress.
iptables -N SPARK_EDGE_EGRESS 2>/dev/null || true
iptables -F SPARK_EDGE_EGRESS
iptables -A SPARK_EDGE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -d "$PRIVATE_CIDR" -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p udp --dport 53 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 53 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p udp --dport 123 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 443 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 8443 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -s 172.16.0.0/12 -j REJECT
iptables -A SPARK_EDGE_EGRESS -j RETURN
iptables -C DOCKER-USER -j SPARK_EDGE_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j SPARK_EDGE_EGRESS
cat > /usr/local/sbin/spark-edge-firewall <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
iptables -N SPARK_EDGE_EGRESS 2>/dev/null || true
iptables -F SPARK_EDGE_EGRESS
iptables -A SPARK_EDGE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -d ${PRIVATE_CIDR} -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p udp --dport 53 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 53 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p udp --dport 123 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 443 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -p tcp --dport 8443 -j ACCEPT
iptables -A SPARK_EDGE_EGRESS -s 172.16.0.0/12 -j REJECT
iptables -A SPARK_EDGE_EGRESS -j RETURN
iptables -C DOCKER-USER -j SPARK_EDGE_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j SPARK_EDGE_EGRESS
EOF
chmod 750 /usr/local/sbin/spark-edge-firewall
cat > /etc/systemd/system/spark-edge-firewall.service <<'EOF'
[Unit]
Description=Spark Server 3 Docker egress boundary
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/spark-edge-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now spark-edge-firewall.service

# Health checks.
timeout 3 bash -c "</dev/tcp/${S2_PRIVATE_IP}/8000"
timeout 3 bash -c "</dev/tcp/${S2_PRIVATE_IP}/5432"
curl -fsS "http://${S2_PRIVATE_IP}:8000/auth/v1/health" >/dev/null
curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:9000/password-login" | grep -Eq '^(200|204|400|401|405)$'
systemctl is-active --quiet chrony spark-edge-firewall
systemctl list-timers 'spark-*' --no-pager

cat <<EOF
Server 3 installed.
Edge Runtime: ${S3_PRIVATE_IP}:9000 (private ingress only)
Supabase Core: ${S2_PRIVATE_IP}:8000 private
Direct DB: ${S2_PRIVATE_IP}:5432 private, Server-3 only
Schedulers: local systemd timers; no public hairpin
Outbound: DNS/NTP plus TCP 443/8443 for approved integrations
Optional provider secrets: /etc/spark/functions-extra.env
After verification, securely delete ${SERVER2_ENV_FILE}.
EOF