# Firewall Configuration

Open the required ports for Coturn and your application.

---

## UFW (Ubuntu)

```bash
# TURN/STUN — UDP and TCP
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp

# TURN over TLS
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp

# Media relay range (must match turnserver.conf min/max-port)
sudo ufw allow 49152:65535/udp

# Application HTTP/HTTPS (Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# SSH (keep this open!)
sudo ufw allow 22/tcp

sudo ufw enable
sudo ufw status verbose
```

---

## iptables (alternative)

```bash
# TURN
iptables -A INPUT -p udp --dport 3478 -j ACCEPT
iptables -A INPUT -p tcp --dport 3478 -j ACCEPT
iptables -A INPUT -p tcp --dport 5349 -j ACCEPT
iptables -A INPUT -p udp --dport 5349 -j ACCEPT

# Media relay range
iptables -A INPUT -p udp --dport 49152:65535 -j ACCEPT

# HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Save rules
sudo netfilter-persistent save
```

---

## Hetzner / Contabo / OVH Cloud Firewall

If your VPS provider has a **cloud-level** firewall (separate from the OS firewall),
add these same rules in the provider's control panel:

| Port(s)       | Protocol | Direction | Description             |
|---------------|----------|-----------|-------------------------|
| 3478          | UDP+TCP  | Inbound   | TURN/STUN               |
| 5349          | UDP+TCP  | Inbound   | TURN over TLS           |
| 49152–65535   | UDP      | Inbound   | WebRTC media relay      |
| 80, 443       | TCP      | Inbound   | HTTP/HTTPS              |

---

## Verify Ports Are Open

From outside the server:

```bash
nmap -sU -sT -p 3478,5349 turn.YOURDOMAIN.COM
```

Expected output: `3478/tcp open` and `3478/udp open`.
