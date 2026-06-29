# Troubleshooting Guide

---

## Problem: Video/audio never connects (stuck on "connecting")

**Cause:** TURN server unreachable — most common issue.

**Check:**
```bash
# On VPS
sudo systemctl status coturn
sudo ufw status   # ports 3478/udp, 3478/tcp, 5349/tcp must be ALLOW

# From outside
nc -zv turn.YOURDOMAIN.COM 3478
```

**Fix:**
1. Open firewall ports (see `firewall-config.md`)
2. Check that `VITE_TURN_HOST` in `.env` matches your actual domain/IP
3. Rebuild and redeploy the frontend after changing `.env`

---

## Problem: `iceTransportPolicy: 'relay'` — no candidates gathered

**Cause:** TURN credentials are wrong or TURN server is down.

**Check in browser console:**
```
RTCPeerConnection: ICE connection state changed to "failed"
```

**Fix:**
```bash
# Verify credentials work
turnutils_uclient -T -u meetinguser -w YOUR_PASSWORD turn.YOURDOMAIN.COM
```

If this fails, check `/etc/turnserver.conf` — `user=` line must exactly match
`VITE_TURN_USERNAME:VITE_TURN_PASSWORD`.

---

## Problem: TLS certificate error on port 5349

**Check:**
```bash
openssl s_client -connect turn.YOURDOMAIN.COM:5349
```

**Fix:**
```bash
sudo certbot renew --force-renewal
sudo systemctl restart coturn
```

---

## Problem: Users inside Iran cannot reach the server

**Diagnosis:**
- Is the VPS IP blocked by Iranian ISPs? Test with a proxy from inside Iran.
- Is DNS resolving to the right IP from inside Iran?

**Mitigations:**
1. Use an IP address directly instead of a domain in `VITE_TURN_HOST` (e.g. `1.2.3.4`).
   Use IP-based TURN URIs: `turn:1.2.3.4:3478?transport=tcp`
2. Use port 443 for TURN/TLS — less likely to be blocked:
   - Add `tls-listening-port=443` to `turnserver.conf` (requires Coturn to run as root or have capability)
   - Update `VITE_TURN_HOST` and use port 443 in `buildRTCConfig()`
3. Use a domain with clean reputation on an Iranian-friendly CDN for DNS.

---

## Problem: Coturn crashes or restarts

```bash
sudo journalctl -u coturn --since "1 hour ago"
```

Common cause: certificate files not readable by `turnserver` user.

```bash
sudo chown turnserver:turnserver /etc/letsencrypt/live/turn.YOURDOMAIN.COM/*.pem
sudo chmod 640 /etc/letsencrypt/live/turn.YOURDOMAIN.COM/*.pem
sudo systemctl restart coturn
```

---

## Problem: High packet loss / poor quality

Check diagnostics in browser console (`[WebRTC Diag]` lines).

**Actions:**
- Check server CPU/bandwidth usage: `htop`, `vnstat`
- Reduce video quality in Settings panel
- Enable Data Saver mode
- Check `max-bps` in `turnserver.conf` — `0` means unlimited; set a value if needed

---

## Problem: "Room at capacity" but room is not full

**Cause:** `MAX_PARTICIPANTS = 20` is enforced at the WebRTC mesh level in
`ConferenceRoom.tsx`. If ghost participants exist in `conference_participants`
with `status='joined'` but disconnected, they count toward the limit.

**Fix:**
```sql
-- Run in Supabase SQL editor — clean up stale participants
UPDATE conference_participants
SET status = 'left', left_at = now()
WHERE status = 'joined'
  AND last_seen < now() - interval '5 minutes';
```

---

## Useful Log Commands

```bash
# Coturn live log
tail -f /var/log/coturn/turn.log | grep -E "ERROR|allocation|session"

# Nginx errors
tail -f /var/log/nginx/error.log

# Application (if using PM2)
pm2 logs meeting-app
```
