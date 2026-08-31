# Spark Video Conference — Deployment

## 1. Deployment model

The checked-in production model is a **single-host self-hosted LiveKit media stack** managed by Spark Server Manager.

Primary assets:

```text
deploy/livekit/
deploy/spark-cli/lib/install-livekit.sh
```

Spark Manager mode uses Nginx on the host for public HTTPS. The standalone Caddy proxy is placed behind an inactive compose profile in `docker-compose.spark-cli.yml`.

## 2. Services

Primary media services:

- LiveKit Server
- Redis
- LiveKit Egress
- LiveKit Ingress
- MinIO
- MinIO initializer

Observability profile:

- Prometheus
- Alertmanager
- Grafana
- Loki
- Grafana Alloy
- Node Exporter
- Blackbox Exporter

## 3. Network/port model

| Port | Protocol | Purpose |
|---:|---|---|
| 443 | TCP | HTTPS/WSS through host reverse proxy |
| 443 | UDP | embedded TURN/UDP |
| 5349 | TCP | TURN/TLS |
| 7881 | TCP | LiveKit ICE/TCP |
| 50000-60000 | UDP | WebRTC media |
| 1935 | TCP | RTMP ingress |
| 7885 | UDP | WHIP ingress media |
| 7880 | TCP loopback/internal | LiveKit API/signaling upstream |
| 6379 | TCP loopback | Redis |
| 9000 | TCP loopback | MinIO S3 API |
| 9001 | TCP loopback | MinIO console |
| 6789 | TCP loopback | LiveKit metrics |
| 6788 | TCP loopback | Egress metrics |
| 6787 | TCP loopback | Ingress metrics |
| 9090 | TCP loopback | Prometheus |
| 9093 | TCP loopback | Alertmanager |
| 3000 | TCP loopback | Grafana |
| 3100 | TCP loopback | Loki |
| 9100 | TCP loopback | Node Exporter |
| 9115 | TCP loopback | Blackbox Exporter |

Firewall policy should expose only the ports that are intentionally public. Redis, MinIO, metrics, Grafana, Loki, and Alertmanager are designed to remain loopback-only in the single-host profile.

## 4. Persistent state

Named volumes persist:

- Redis data
- MinIO recording data
- Prometheus TSDB
- Alertmanager state
- Loki data
- Alloy state
- Grafana data

Treat these volumes as operational state during backup, upgrade, and rollback.

## 5. Secrets and environment

Use `deploy/livekit/.env.example` only as a template.

Real values must never be committed for:

- LiveKit API key/secret
- TURN credentials
- S3/MinIO credentials
- Grafana admin password
- Supabase service-role/JWT secrets

Spark Manager creates/synchronizes function runtime environment in protected files with restrictive permissions.

## 6. Recording storage

Spark Manager configures local MinIO as S3-compatible recording storage:

```text
endpoint: 127.0.0.1:9000
bucket: spark-conference-recordings
```

Credentials are generated and synchronized to Edge Function runtime configuration; they must not appear in browser configuration.

## 7. Reverse proxy

In Spark Manager mode:

- Nginx terminates HTTPS for the LiveKit domain.
- WebSocket upgrade headers are forwarded to LiveKit on loopback port 7880.
- The Ingress domain receives its own HTTPS virtual host.
- HSTS and `X-Content-Type-Options` are configured.
- Frontend CSP is patched to allow the configured LiveKit HTTPS/WSS endpoint.

TURN certificate material is copied with restrictive permissions and renewed through a deploy hook.

## 8. Manager validation

The install script validates, among other things:

- required files exist
- environment variables are non-placeholder
- environment file permissions are restrictive
- DNS resolves to the expected public IP
- TURN certificate is present and valid
- compose configuration parses
- LiveKit function environment matches deployment values
- health endpoints respond
- worker functions are configured/probed

## 9. Resource defaults

Checked-in defaults include:

- LiveKit: 4 CPU / 4 GiB
- Egress: 4 CPU / 4 GiB
- Ingress: 2 CPU / 2 GiB
- Redis: 0.5 CPU / 512 MiB
- MinIO: 1 CPU / 1 GiB
- Prometheus: 1 CPU / 1 GiB
- Loki: 1 CPU / 1 GiB
- Grafana: 0.5 CPU / 512 MiB

These are deployment limits, not a substitute for capacity testing.

## 10. Capacity and rollout

Current Spark runtime config is SFU with `max_participants=10`.

The repository contains a 20-participant LiveKit load harness. Production rollout to 20 should be accepted only after the real target host/network passes the live load test and operational metrics remain within agreed thresholds.

## 11. Deployment checklist

Before deployment:

1. Confirm all images are pinned.
2. Confirm DNS for LiveKit/TURN/Ingress.
3. Confirm TLS/TURN certificates.
4. Confirm public firewall ports.
5. Confirm Redis/MinIO/monitoring remain non-public.
6. Confirm Edge Function LiveKit/storage env synchronization.
7. Confirm webhook URL.
8. Run compose/config health checks.
9. Run conference contract/unit tests.
10. Run integration/E2E/load checks appropriate to the environment.
11. Verify dashboards and alerts after service start.

## 12. Rollback principle

Do not destroy durable volumes during an application rollback. Revert application/deployment code to the last known-good commit while preserving DB migration history and storage unless a separately tested data rollback plan exists.
