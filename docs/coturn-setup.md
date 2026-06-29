# Coturn Installation & Configuration Guide

Self-hosted TURN server for the video conferencing module.  
Run these commands on the same VPS that hosts your application.

---

## 1. Install Coturn

```bash
sudo apt update
sudo apt install -y coturn
```

Enable the service to start on boot:

```bash
sudo systemctl enable coturn
```

---

## 2. TLS Certificate (Let's Encrypt)

Replace `turn.YOURDOMAIN.COM` with your real subdomain.

```bash
sudo apt install -y certbot
sudo certbot certonly --standalone -d turn.YOURDOMAIN.COM
```

Coturn needs to read these files. Add the coturn user to the ssl-cert group
(or copy certs — Let's Encrypt renews to `/etc/letsencrypt/live/`):

```bash
sudo usermod -aG ssl-cert turnserver
# Or use a deploy hook to copy certs after renewal:
# /etc/letsencrypt/renewal-hooks/deploy/copy-coturn-certs.sh
```

---

## 3. Configuration File

Edit `/etc/turnserver.conf` — replace every `YOURDOMAIN.COM` and `CHANGE_THIS_*`:

```ini
# Listening addresses
listening-port=3478
tls-listening-port=5349
listening-ip=0.0.0.0

# Your VPS public IP
external-ip=YOUR_VPS_PUBLIC_IP

# Realm — must match your domain
realm=turn.YOURDOMAIN.COM

# Long-term credentials (match .env values)
lt-cred-mech
user=meetinguser:CHANGE_THIS_SECRET

# TLS certificates (Let's Encrypt)
cert=/etc/letsencrypt/live/turn.YOURDOMAIN.COM/fullchain.pem
pkey=/etc/letsencrypt/live/turn.YOURDOMAIN.COM/privkey.pem

# Security
no-loopback-peers
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=172.16.0.0-172.31.255.255

# Relay only — disables STUN (clients must use TURN credentials)
# Comment this out if you want to allow unauthenticated STUN:
# no-stun

# Media relay port range
min-port=49152
max-port=65535

# Logging
log-file=/var/log/coturn/turn.log
verbose

# Performance
total-quota=200
max-bps=0
```

---

## 4. Create Log Directory

```bash
sudo mkdir -p /var/log/coturn
sudo chown turnserver:turnserver /var/log/coturn
```

---

## 5. Enable and Start

Uncomment `TURNSERVER_ENABLED=1` in `/etc/default/coturn`:

```bash
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl restart coturn
sudo systemctl status coturn
```

---

## 6. Update Your Application

In `.env`:

```
VITE_TURN_HOST=turn.YOURDOMAIN.COM
VITE_TURN_USERNAME=meetinguser
VITE_TURN_PASSWORD=CHANGE_THIS_SECRET
```

Rebuild and redeploy the frontend.

---

## 7. Certificate Auto-Renewal

```bash
# /etc/letsencrypt/renewal-hooks/deploy/coturn-renew.sh
#!/bin/bash
cp /etc/letsencrypt/live/turn.YOURDOMAIN.COM/fullchain.pem /etc/coturn/certs/fullchain.pem
cp /etc/letsencrypt/live/turn.YOURDOMAIN.COM/privkey.pem   /etc/coturn/certs/privkey.pem
chown turnserver:turnserver /etc/coturn/certs/*.pem
systemctl reload coturn
```

```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/coturn-renew.sh
```
