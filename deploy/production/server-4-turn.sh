#!/usr/bin/env bash
set -Eeuo pipefail

# Spark - Server 4: TURN/STUN (DMZ)
# Ubuntu 24.04. Run as root.
#
# Required:
#   export TURN_DOMAIN="turn.shahrmeeting.ir"
#   export TURN_PUBLIC_IP="203.0.113.40"
#   export TURN_PRIVATE_IP="10.20.0.14"  # use public IP here if directly attached
#   export ADMIN_CIDR="203.0.113.10/32"
#   export LETSENCRYPT_EMAIL="ops@example.com"
# Optional:
#   export TURN_MIN_PORT="49160"
#   export TURN_MAX_PORT="49200"

: "${TURN_DOMAIN:?Set TURN_DOMAIN}"
: "${TURN_PUBLIC_IP:?Set TURN_PUBLIC_IP}"
: "${TURN_PRIVATE_IP:?Set TURN_PRIVATE_IP}"
: "${ADMIN_CIDR:?Set ADMIN_CIDR}"
: "${LETSENCRYPT_EMAIL:?Set LETSENCRYPT_EMAIL}"
TURN_MIN_PORT="${TURN_MIN_PORT:-49160}"
TURN_MAX_PORT="${TURN_MAX_PORT:-49200}"
[[ "${EUID}" -eq 0 ]] || { echo "Run as root"; exit 1; }

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y
apt-get install -y coturn certbot ufw openssl ca-certificates curl

# Temporary HTTP-01 access only for initial certificate issuance.
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "${ADMIN_CIDR}" to any port 22 proto tcp
ufw allow 80/tcp
ufw --force enable
systemctl stop coturn 2>/dev/null || true
certbot certonly --standalone -d "${TURN_DOMAIN}" --email "${LETSENCRYPT_EMAIL}" --agree-tos --non-interactive

# Coturn must be able to read the private key; keep a protected service copy.
CERT_DIR="/etc/coturn/certs"
install -d -m 0750 -o turnserver -g turnserver "${CERT_DIR}"
install -m 0640 -o turnserver -g turnserver "/etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem" "${CERT_DIR}/fullchain.pem"
install -m 0640 -o turnserver -g turnserver "/etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem" "${CERT_DIR}/privkey.pem"

TURN_SECRET="$(openssl rand -base64 48 | tr -d '\n')"
install -d -m 0700 /etc/spark
cat > /etc/spark/turn-secret.env <<EOF
TURN_DOMAIN=${TURN_DOMAIN}
TURN_SHARED_SECRET=${TURN_SECRET}
TURN_URL=turn:${TURN_DOMAIN}:3478?transport=udp
TURN_TCP_URL=turn:${TURN_DOMAIN}:3478?transport=tcp
TURNS_URL=turns:${TURN_DOMAIN}:5349?transport=tcp
EOF
chmod 600 /etc/spark/turn-secret.env

if [[ "${TURN_PUBLIC_IP}" == "${TURN_PRIVATE_IP}" ]]; then
  EXTERNAL_IP_LINE="external-ip=${TURN_PUBLIC_IP}"
else
  EXTERNAL_IP_LINE="external-ip=${TURN_PUBLIC_IP}/${TURN_PRIVATE_IP}"
fi

cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
listening-ip=${TURN_PRIVATE_IP}
relay-ip=${TURN_PRIVATE_IP}
${EXTERNAL_IP_LINE}

fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=${TURN_DOMAIN}
server-name=${TURN_DOMAIN}

min-port=${TURN_MIN_PORT}
max-port=${TURN_MAX_PORT}

cert=${CERT_DIR}/fullchain.pem
pkey=${CERT_DIR}/privkey.pem
no-cli
no-loopback-peers
no-multicast-peers
stale-nonce=600
no-tlsv1
no-tlsv1_1
log-file=/var/log/turnserver/turnserver.log
simple-log
EOF
chmod 640 /etc/turnserver.conf
chown root:turnserver /etc/turnserver.conf 2>/dev/null || true
install -d -o turnserver -g turnserver /var/log/turnserver 2>/dev/null || install -d /var/log/turnserver

if [[ -f /etc/default/coturn ]]; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
fi
systemctl enable --now coturn

# ACME renewals temporarily open TCP/80 and refresh the protected cert copy.
cat > /etc/letsencrypt/renewal-hooks/pre/spark-turn-open-http.sh <<'EOF'
#!/usr/bin/env bash
ufw allow 80/tcp >/dev/null 2>&1 || true
EOF
cat > /etc/letsencrypt/renewal-hooks/deploy/spark-turn-restart.sh <<EOF
#!/usr/bin/env bash
set -e
install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/fullchain.pem ${CERT_DIR}/fullchain.pem
install -m 0640 -o turnserver -g turnserver /etc/letsencrypt/live/${TURN_DOMAIN}/privkey.pem ${CERT_DIR}/privkey.pem
systemctl restart coturn
EOF
cat > /etc/letsencrypt/renewal-hooks/post/spark-turn-close-http.sh <<'EOF'
#!/usr/bin/env bash
ufw delete allow 80/tcp >/dev/null 2>&1 || true
EOF
chmod 750 /etc/letsencrypt/renewal-hooks/pre/spark-turn-open-http.sh /etc/letsencrypt/renewal-hooks/deploy/spark-turn-restart.sh /etc/letsencrypt/renewal-hooks/post/spark-turn-close-http.sh

# Final production firewall.
ufw delete allow 80/tcp >/dev/null 2>&1 || true
ufw allow 3478/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow "${TURN_MIN_PORT}:${TURN_MAX_PORT}/udp"
ufw --force enable

systemctl is-active --quiet coturn
ss -lntup | grep -E ':(3478|5349)\b'
turnutils_stunclient "${TURN_DOMAIN}" -p 3478 || true
openssl s_client -connect "${TURN_DOMAIN}:5349" -servername "${TURN_DOMAIN}" </dev/null 2>/dev/null | grep -q "BEGIN CERTIFICATE" || true

cat <<EOF

Server 4 installed.
  stun:${TURN_DOMAIN}:3478
  turn:${TURN_DOMAIN}:3478?transport=udp
  turn:${TURN_DOMAIN}:3478?transport=tcp
  turns:${TURN_DOMAIN}:5349?transport=tcp
  relay UDP: ${TURN_MIN_PORT}-${TURN_MAX_PORT}

Root-only TURN secret:
  /etc/spark/turn-secret.env

Never place TURN_SHARED_SECRET in browser/frontend code. The client must use short-lived TURN REST credentials issued by a trusted backend. Also open the same TURN ports in the VPS/provider firewall.
EOF
