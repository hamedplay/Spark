#!/usr/bin/env bash
set -Eeuo pipefail

# Spark - Server 2: Supabase Core + PostgreSQL (INTERNAL ZONE / OFFLINE)
# Ubuntu 24.04. Run as root.
#
# SECURITY CONTRACT
# - This script NEVER runs apt, git clone, npm, docker pull or any Internet fetch.
# - Server 2 has no direct Internet ingress or egress at runtime.
# - Docker Engine + Compose and basic OS tools must already exist in the approved
#   Ubuntu image, or be installed from an INTERNAL package mirror before running.
# - All Supabase source, Spark migrations, Docker images and the Supabase CLI are
#   delivered by Server 3 as /root/spark-server2-offline-bundle.tar.gz.
# - PostgreSQL 5432 is reachable ONLY from Server 3 private IP.
# - Kong/API 8000 is reachable ONLY from Server 1 and Server 3 private IPs.
# - Studio is never exposed publicly.
#
# FIRST, on Server 3 (Internet-enabled DMZ):
#   sudo bash deploy/production/server-3-edge-integration.sh prepare-server2-bundle
#   scp /root/spark-server2-offline-bundle.tar.gz root@<S2_PRIVATE_IP>:/root/
#
# Required variables:
#   export S1_PRIVATE_IP="10.20.0.11"
#   export S2_PRIVATE_IP="10.20.0.12"
#   export S3_PRIVATE_IP="10.20.0.13"
#   export PRIVATE_CIDR="10.20.0.0/24"
#   export ADMIN_CIDR="10.20.0.10/32"       # private bastion/admin source
#   export APP_DOMAIN="shahrmeeting.ir"
#   export API_DOMAIN="api.shahrmeeting.ir"
# Optional:
#   export OFFLINE_BUNDLE="/root/spark-server2-offline-bundle.tar.gz"
#   export BACKUP_DIR="/var/backups/spark"

: "${S1_PRIVATE_IP:?Set S1_PRIVATE_IP}"
: "${S2_PRIVATE_IP:?Set S2_PRIVATE_IP}"
: "${S3_PRIVATE_IP:?Set S3_PRIVATE_IP}"
: "${PRIVATE_CIDR:?Set PRIVATE_CIDR}"
: "${ADMIN_CIDR:?Set ADMIN_CIDR}"
: "${APP_DOMAIN:?Set APP_DOMAIN}"
: "${API_DOMAIN:?Set API_DOMAIN}"

OFFLINE_BUNDLE="${OFFLINE_BUNDLE:-/root/spark-server2-offline-bundle.tar.gz}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/spark}"
BOOTSTRAP_DIR="/opt/spark-bootstrap"
SB_DIR="/opt/spark-supabase"
APP_DIR="/opt/spark"
TRANSFER_DIR="/root/spark-transfer"

[[ "${EUID}" -eq 0 ]] || { echo "Run as root"; exit 1; }
[[ -f "${OFFLINE_BUNDLE}" ]] || { echo "Missing offline bundle: ${OFFLINE_BUNDLE}"; exit 1; }
ip -o addr show | grep -Fq "${S2_PRIVATE_IP}" || { echo "${S2_PRIVATE_IP} is not configured on this host"; exit 1; }

for c in docker python3 openssl ufw tar rsync systemctl iptables curl; do
  command -v "$c" >/dev/null || { echo "Missing required command '$c'. Install it from the approved base image/internal mirror; Server 2 must not use the Internet."; exit 1; }
done
docker compose version >/dev/null || { echo "Docker Compose plugin is required"; exit 1; }
systemctl enable --now docker

# Fail closed if the host unexpectedly has public Internet reachability.
# Private RFC1918 routes remain valid and are required.
if curl -4 -fsS --connect-timeout 2 https://1.1.1.1 >/dev/null 2>&1; then
  echo "ERROR: Server 2 currently has direct Internet egress. Remove it before deployment."
  exit 1
fi

rm -rf "${BOOTSTRAP_DIR}"
mkdir -p "${BOOTSTRAP_DIR}"
tar -xzf "${OFFLINE_BUNDLE}" -C "${BOOTSTRAP_DIR}"
[[ -f "${BOOTSTRAP_DIR}/manifest.env" ]] || { echo "Invalid bundle: manifest.env missing"; exit 1; }
# shellcheck disable=SC1091
source "${BOOTSTRAP_DIR}/manifest.env"
: "${SUPABASE_UPSTREAM_COMMIT:?Bundle manifest missing SUPABASE_UPSTREAM_COMMIT}"
: "${SPARK_COMMIT:?Bundle manifest missing SPARK_COMMIT}"

[[ -d "${BOOTSTRAP_DIR}/supabase-docker" ]] || { echo "Invalid bundle: supabase-docker missing"; exit 1; }
[[ -d "${BOOTSTRAP_DIR}/spark/supabase/migrations" ]] || { echo "Invalid bundle: Spark migrations missing"; exit 1; }
[[ -f "${BOOTSTRAP_DIR}/docker-images.tar" ]] || { echo "Invalid bundle: docker-images.tar missing"; exit 1; }
[[ -x "${BOOTSTRAP_DIR}/bin/supabase" ]] || { echo "Invalid bundle: Supabase CLI missing"; exit 1; }

# Configure host firewall BEFORE containers are started.
ufw --force reset
ufw default deny incoming
ufw default deny outgoing
ufw allow from "${ADMIN_CIDR}" to any port 22 proto tcp
ufw allow from "${S1_PRIVATE_IP}" to "${S2_PRIVATE_IP}" port 8000 proto tcp
ufw allow from "${S3_PRIVATE_IP}" to "${S2_PRIVATE_IP}" port 8000 proto tcp
ufw allow from "${S3_PRIVATE_IP}" to "${S2_PRIVATE_IP}" port 5432 proto tcp
ufw allow out to "${PRIVATE_CIDR}"
ufw allow out to "${S3_PRIVATE_IP}" port 123 proto udp
ufw --force enable

# Docker bypasses ordinary UFW forwarding; enforce a DOCKER-USER egress boundary.
iptables -N SPARK_CORE_EGRESS 2>/dev/null || true
iptables -F SPARK_CORE_EGRESS
iptables -A SPARK_CORE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A SPARK_CORE_EGRESS -d "${PRIVATE_CIDR}" -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 172.16.0.0/12 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 10.0.0.0/8 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 192.168.0.0/16 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -j REJECT
iptables -A SPARK_CORE_EGRESS -j RETURN
iptables -C DOCKER-USER -j SPARK_CORE_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j SPARK_CORE_EGRESS

cat > /usr/local/sbin/spark-core-firewall <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
ufw default deny outgoing
ufw allow out to ${PRIVATE_CIDR}
ufw allow out to ${S3_PRIVATE_IP} port 123 proto udp
iptables -N SPARK_CORE_EGRESS 2>/dev/null || true
iptables -F SPARK_CORE_EGRESS
iptables -A SPARK_CORE_EGRESS -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A SPARK_CORE_EGRESS -d ${PRIVATE_CIDR} -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 172.16.0.0/12 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 10.0.0.0/8 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -d 192.168.0.0/16 -j ACCEPT
iptables -A SPARK_CORE_EGRESS -s 172.16.0.0/12 -j REJECT
iptables -A SPARK_CORE_EGRESS -j RETURN
iptables -C DOCKER-USER -j SPARK_CORE_EGRESS 2>/dev/null || iptables -I DOCKER-USER 1 -j SPARK_CORE_EGRESS
ufw reload
EOF
chmod 750 /usr/local/sbin/spark-core-firewall
cat > /etc/systemd/system/spark-core-firewall.service <<'EOF'
[Unit]
Description=Spark Server 2 offline network boundary
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/spark-core-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable spark-core-firewall.service

# Private NTP source: Server 3. JWT/TOTP/session logic depends on correct time.
if systemctl list-unit-files systemd-timesyncd.service >/dev/null 2>&1; then
  mkdir -p /etc/systemd/timesyncd.conf.d
  cat > /etc/systemd/timesyncd.conf.d/spark.conf <<EOF
[Time]
NTP=${S3_PRIVATE_IP}
FallbackNTP=
EOF
  systemctl enable --now systemd-timesyncd || true
  systemctl restart systemd-timesyncd || true
fi

# Load all pre-fetched OCI images. No docker pull is permitted here.
docker load -i "${BOOTSTRAP_DIR}/docker-images.tar"

rm -rf "${SB_DIR}" "${APP_DIR}"
mkdir -p "${SB_DIR}" "${APP_DIR}"
cp -a "${BOOTSTRAP_DIR}/supabase-docker/." "${SB_DIR}/"
cp -a "${BOOTSTRAP_DIR}/spark/." "${APP_DIR}/"
install -m 0755 "${BOOTSTRAP_DIR}/bin/supabase" /usr/local/bin/supabase
printf '%s\n' "${SUPABASE_UPSTREAM_COMMIT}" > "${SB_DIR}/SUPABASE_UPSTREAM_COMMIT"
printf '%s\n' "${SPARK_COMMIT}" > "${APP_DIR}/SPARK_COMMIT"

cd "${SB_DIR}"
cp .env.example .env
./utils/generate-keys.sh
[[ ! -x ./utils/add-new-auth-keys.sh ]] || ./utils/add-new-auth-keys.sh
chmod 600 .env

set_env() {
  local key="$1" value="$2" file="${3:-${SB_DIR}/.env}"
  python3 - "$file" "$key" "$value" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]); key=sys.argv[2]; val=sys.argv[3]
lines=p.read_text().splitlines(); out=[]; found=False
for line in lines:
    if line.startswith(key+'='):
        out.append(f'{key}={val}'); found=True
    else: out.append(line)
if not found: out.append(f'{key}={val}')
p.write_text('\n'.join(out)+'\n')
PY
}

set_env SUPABASE_PUBLIC_URL "https://${API_DOMAIN}"
set_env API_EXTERNAL_URL "https://${API_DOMAIN}"
set_env SITE_URL "https://${APP_DOMAIN}"
set_env ADDITIONAL_REDIRECT_URLS "https://${APP_DOMAIN}/*,https://www.${APP_DOMAIN}/*"
set_env FUNCTIONS_VERIFY_JWT "false"
set_env PHONE_LOGIN_ALLOWED_ORIGINS "https://${APP_DOMAIN},https://www.${APP_DOMAIN}"
HOOK_SECRET="v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
set_env SEND_SMS_HOOK_SECRET "${HOOK_SECRET}"
set_env PHONE_PASSWORD_RESET_SECRET "$(openssl rand -hex 32)"

# Remove Edge Runtime from Server 2, bind only Core API/Postgres to the private IP,
# and make GoTrue send its SMS hook to Server 3 over the private network.
python3 - "${SB_DIR}/docker-compose.yml" "${S2_PRIVATE_IP}" "${S3_PRIVATE_IP}" <<'PY'
from pathlib import Path
import sys, yaml
path=Path(sys.argv[1]); s2=sys.argv[2]; s3=sys.argv[3]
data=yaml.safe_load(path.read_text()); services=data.get('services', {})
required={'kong','auth','db','functions'}
missing=required-set(services)
if missing: raise SystemExit(f'Missing expected Supabase services: {sorted(missing)}')
services['functions']['profiles']=['server3-only']
services['kong']['ports']=[f'{s2}:8000:8000/tcp']
services['db']['ports']=[f'{s2}:5432:5432/tcp']
# Supavisor remains internal to the compose network; no host/public pooler ports.
if 'supavisor' in services: services['supavisor']['ports']=[]
a=services['auth'].setdefault('environment', {})
a['GOTRUE_HOOK_SEND_SMS_ENABLED']='true'
a['GOTRUE_HOOK_SEND_SMS_URI']=f'http://{s3}:9000/auth-send-sms-hook'
a['GOTRUE_HOOK_SEND_SMS_SECRETS']='${SEND_SMS_HOOK_SECRET}'
a['GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED']='true'
path.write_text(yaml.safe_dump(data, sort_keys=False, width=120))
PY

docker compose config >/dev/null
docker compose --profile server3-only config >/dev/null
# Never pull on Server 2.
docker compose up -d --pull never
sleep 12
docker compose ps

POSTGRES_PASSWORD="$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
ANON_KEY="$(grep '^ANON_KEY=' .env | cut -d= -f2-)"
SERVICE_ROLE_KEY="$(grep '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)"
JWT_SECRET="$(grep '^JWT_SECRET=' .env | cut -d= -f2-)"
POSTGRES_PASSWORD_URLENC="$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "${POSTGRES_PASSWORD}")"
DB_URL="postgresql://postgres:${POSTGRES_PASSWORD_URLENC}@${S2_PRIVATE_IP}:5432/postgres"

# Apply every Spark migration through the bundled CLI; no network is used.
cd "${APP_DIR}"
supabase db push --db-url "${DB_URL}" --dry-run
supabase db push --db-url "${DB_URL}" --include-all

# Public handoff contains ONLY the browser-safe anonymous key.
install -d -m 0700 "${TRANSFER_DIR}"
cat > "${TRANSFER_DIR}/server1.env" <<EOF
VITE_SUPABASE_ANON_KEY='${ANON_KEY}'
EOF
chmod 600 "${TRANSFER_DIR}/server1.env"

# Private handoff to Server 3 contains server credentials required by Edge Runtime.
cat > "${TRANSFER_DIR}/server3.env" <<EOF
S2_PRIVATE_IP='${S2_PRIVATE_IP}'
S3_PRIVATE_IP='${S3_PRIVATE_IP}'
SUPABASE_UPSTREAM_COMMIT='${SUPABASE_UPSTREAM_COMMIT}'
SUPABASE_PUBLIC_URL='https://${API_DOMAIN}'
SUPABASE_ANON_KEY='${ANON_KEY}'
SUPABASE_SERVICE_ROLE_KEY='${SERVICE_ROLE_KEY}'
JWT_SECRET='${JWT_SECRET}'
POSTGRES_PASSWORD='${POSTGRES_PASSWORD}'
SEND_SMS_HOOK_SECRET='${HOOK_SECRET}'
EOF
chmod 600 "${TRANSFER_DIR}/server3.env"

# Local DB + Storage backup. Backups stay on Server 2/private backup storage.
install -d -m 0700 "${BACKUP_DIR}"
cat > /usr/local/sbin/spark-core-backup <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
STAMP="\$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${BACKUP_DIR}"
cd "${SB_DIR}"
docker compose exec -T db pg_dump -U postgres -d postgres -Fc > "${BACKUP_DIR}/postgres-\${STAMP}.dump"
if [[ -d "${SB_DIR}/volumes/storage" ]]; then
  tar -C "${SB_DIR}/volumes" -czf "${BACKUP_DIR}/storage-\${STAMP}.tar.gz" storage
fi
find "${BACKUP_DIR}" -type f -mtime +14 -delete
EOF
chmod 750 /usr/local/sbin/spark-core-backup
cat > /etc/systemd/system/spark-core-backup.service <<'EOF'
[Unit]
Description=Spark Supabase database/storage backup
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/spark-core-backup
EOF
cat > /etc/systemd/system/spark-core-backup.timer <<'EOF'
[Unit]
Description=Daily Spark Supabase backup
[Timer]
OnCalendar=*-*-* 01:30:00
Persistent=true
RandomizedDelaySec=10m
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now spark-core-firewall.service spark-core-backup.timer

# Validation: private listeners work, and public egress still fails.
ss -lnt | grep -E "${S2_PRIVATE_IP}:8000|${S2_PRIVATE_IP}:5432" >/dev/null
curl -fsS "http://${S2_PRIVATE_IP}:8000/auth/v1/health" >/dev/null
docker compose exec -T db psql -U postgres -d postgres -Atqc 'select 1' | grep -qx 1
if curl -4 -fsS --connect-timeout 2 https://1.1.1.1 >/dev/null 2>&1; then
  echo "ERROR: public Internet egress is still possible"; exit 1
fi

cat <<EOF

Server 2 complete — OFFLINE Internal Zone.
Supabase upstream: ${SUPABASE_UPSTREAM_COMMIT}
Spark snapshot:    ${SPARK_COMMIT}
Core API:          ${S2_PRIVATE_IP}:8000 (S1/S3 private only)
PostgreSQL:        ${S2_PRIVATE_IP}:5432 (S3 private only)
Studio:            not exposed
Backups:           ${BACKUP_DIR}

Securely transfer:
  ${TRANSFER_DIR}/server1.env -> Server 1
  ${TRANSFER_DIR}/server3.env -> Server 3 as /root/server3.env
Then delete the handoff files from every host after provisioning.

UPDATES: never unseal Server 2. Build a NEW offline bundle on Server 3 and transfer it over the private network.
EOF