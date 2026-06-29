# TURN Server Testing Guide

Verify your Coturn deployment works end-to-end before going live.

---

## 1. Service Status

```bash
sudo systemctl status coturn
sudo journalctl -u coturn -f          # live logs
tail -f /var/log/coturn/turn.log      # coturn's own log file
```

---

## 2. Port Reachability

From a machine **outside** the VPS:

```bash
# Check TCP ports
nc -zv turn.YOURDOMAIN.COM 3478
nc -zv turn.YOURDOMAIN.COM 5349

# Check UDP (requires nmap)
nmap -sU -p 3478 turn.YOURDOMAIN.COM
```

---

## 3. TURN Credential Test (turnutils)

```bash
# Install coturn utilities
sudo apt install -y coturn

# Allocate a relay address — should print "Relay address: X.X.X.X"
turnutils_uclient -T -u meetinguser -w CHANGE_THIS_SECRET turn.YOURDOMAIN.COM
```

A successful output looks like:

```
Total transmit time is 5
Transmit time is 0, Rcvd rate 0, Sent rate 0
```

---

## 4. Browser WebRTC Test (Trickle ICE)

1. Open https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
2. Add a TURN server:
   - URI: `turn:turn.YOURDOMAIN.COM:3478?transport=udp`
   - Username: `meetinguser`
   - Password: `CHANGE_THIS_SECRET`
3. Click **Gather candidates**
4. You should see candidates with `typ relay` — these confirm TURN is working

---

## 5. TLS Verification

```bash
openssl s_client -connect turn.YOURDOMAIN.COM:5349 -showcerts
```

Check:
- Certificate chain is valid
- Common name matches `turn.YOURDOMAIN.COM`
- No expired certificates

---

## 6. In-Application Verification

Open browser DevTools → Console while in a conference room.

Look for:
```
[WebRTC Diag] <peerId> — RTT: 45ms  Loss: 0%  Bitrate↑: 850kbps
```

Also check `chrome://webrtc-internals` (Chrome) or `about:webrtc` (Firefox):
- `remotecandidate` type should be `relay`
- Connection state should reach `connected`
