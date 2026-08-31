# Spark Video Conference — Monitoring and Observability

## 1. Stack

Phase 22 adds a complete single-host observability stack under:

```text
deploy/livekit/monitoring/
```

Components:

- Prometheus
- Alertmanager
- Grafana
- Loki
- Grafana Alloy
- Node Exporter
- Blackbox Exporter

LiveKit Server, Egress, and Ingress expose native Prometheus metrics.

## 2. Metrics endpoints

| Target | Endpoint |
|---|---|
| LiveKit | `127.0.0.1:6789` |
| Egress | `127.0.0.1:6788` |
| Ingress | `127.0.0.1:6787` |
| Prometheus | `127.0.0.1:9090` |
| Alertmanager | `127.0.0.1:9093` |
| Loki | `127.0.0.1:3100` |
| Alloy | `127.0.0.1:12345` |
| Node Exporter | `127.0.0.1:9100` |
| Blackbox Exporter | `127.0.0.1:9115` |
| Grafana | `127.0.0.1:3000` |

These interfaces are loopback-bound in the checked-in single-host profile.

## 3. Prometheus cadence

Current configuration:

- scrape interval: 15 seconds
- rule evaluation interval: 15 seconds
- alert rule group interval: 30 seconds

Prometheus also performs HTTP blackbox probes from file-based targets.

## 4. Recording rules

Current recording rules include:

- aggregate network input bitrate
- aggregate network output bitrate
- p95 packet-loss percentage
- 5-minute RTC join failure count

These normalized series are used by dashboards and alerts.

## 5. Alerts

Important configured alerts:

### Metrics endpoint availability

- LiveKit metrics down for 2 minutes -> critical
- Egress metrics down for 2 minutes -> critical
- Ingress metrics down for 2 minutes -> warning

### Media/network

- packet-loss p95 above 5% for 5 minutes -> warning
- at least 3 RTC join failures in 5 minutes -> warning

### Host resources

- CPU above 85% for 10 minutes -> warning
- memory above 90% for 10 minutes -> warning

### HTTP health

- monitored HTTPS probe failure for 2 minutes -> critical
- API probe duration above 2 seconds for 5 minutes -> warning

## 6. Logs

Loki is configured for local filesystem storage.

Current retention:

```text
168 hours (7 days)
```

Grafana Alloy is responsible for log collection/forwarding into Loki.

Analytics reporting is disabled in Loki.

## 7. Grafana

Provisioned data sources:

- Prometheus
- Loki
- Alertmanager

Provisioned dashboard folder:

```text
Spark LiveKit
```

Checked-in dashboards include:

- Spark LiveKit Overview
- Spark LiveKit Operations

Dashboards are file-provisioned and not intended to be edited as the source of truth in the UI.

## 8. Alert delivery limitation

Alertmanager currently has a local receiver definition without an external notification integration.

Therefore:

- alert evaluation/routing is configured
- durable external notification delivery (email, webhook, Bale, etc.) is **not** established by the checked-in Alertmanager configuration

Do not claim operational paging is complete until a receiver is configured and tested.

## 9. Browser diagnostics

The conference UI also collects client-side WebRTC diagnostics approximately every 2.5 seconds while connected.

Collected signals include:

- RTT
- packet loss
- jitter
- bitrate
- codec
- resolution
- FPS
- ICE state
- local/remote candidate type
- transport protocol
- relay protocol
- TURN usage
- reconnect count
- per-track diagnostics

These diagnostics complement infrastructure monitoring; they do not replace Prometheus.

## 10. Operational triage order

For a user-facing media incident:

1. confirm LiveKit/Ingress/Egress process health
2. check LiveKit and host resource dashboards
3. check join-failure and packet-loss alerts
4. inspect browser network diagnostics
5. identify whether TURN is in use
6. inspect Loki logs around the incident window
7. correlate with conference audit/attendance events in PostgreSQL
8. verify whether the failure is media-only or business/API state

## 11. Security

Do not expose Grafana, Prometheus, Loki, Alertmanager, or metrics ports directly to the public Internet in this topology.

Use authenticated administrative access or a protected tunnel/reverse proxy if remote observability access is required.
