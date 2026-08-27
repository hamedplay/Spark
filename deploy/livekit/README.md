# Spark + LiveKit self-hosted media platform

This directory is the production deployment model for Spark video conferencing. It replaces the legacy P2P media path for new SFU rooms with a complete LiveKit media stack:

- LiveKit Server / SFU
- Embedded TURN/UDP and TURN/TLS
- Redis routing/state transport
- LiveKit Egress for server-side MP4 recording
- LiveKit Ingress for RTMP/WHIP sources
- Caddy TLS reverse proxy for HTTPS/WSS and WHIP
- Signed LiveKit webhooks back into Spark/Supabase

## 1. DNS

Create DNS records pointing to the LiveKit host:

- `meet.shahrmeeting.ir` -> LiveKit public IP
- `turn.shahrmeeting.ir` -> LiveKit public IP
- `ingress.shahrmeeting.ir` -> LiveKit public IP

Change the values in `.env` if different hostnames are used.

## 2. Firewall

Required inbound ports:

- TCP 80: ACME certificate issuance / redirect
- TCP 443: HTTPS + WSS signaling and TLS WHIP through Caddy
- UDP 443: embedded TURN/UDP for restrictive networks
- TCP 7881: WebRTC ICE/TCP fallback
- TCP 5349: embedded TURN/TLS fallback
- UDP 50000-60000: WebRTC ICE/UDP
- TCP 1935: RTMP Ingress
- UDP 7885: WHIP Ingress media

Do not expose Redis 6379, LiveKit API 7880, Egress health/metrics, or Ingress health/metrics to the public Internet. The supplied stack binds Redis to loopback and uses host networking for real-time media performance.

TCP 443 is already used by Caddy for HTTPS/WSS. If policy requires TURN/TLS specifically on TCP 443, give TURN a dedicated public IP or place an appropriate L4 load balancer in front of it. TURN/UDP can use UDP 443 on the same host without conflicting with HTTPS because it is a different transport protocol.

## 3. Secrets

Copy `.env.example` to `.env` and replace every placeholder. Never commit `.env`.

The same `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be configured as server-side secrets for these Supabase Edge Functions:

- `conference-livekit-token`
- `conference-host-control`
- `conference-recording`
- `conference-speaker-timer-control`
- `conference-speaker-queue-control`
- `conference-speaker-timer-enforcer`
- `conference-phase-control`
- `conference-phase-enforcer`
- `conference-chat-control`
- `conference-private-chat-control`
- `conference-moderator-chat-control`
- `livekit-webhook`

Also configure:

- `LIVEKIT_URL=https://meet.shahrmeeting.ir` (server API)
- `LIVEKIT_WS_URL=wss://meet.shahrmeeting.ir` (browser signaling)
- `RECORDING_STORAGE_BUCKET`
- `RECORDING_STORAGE_REGION`
- `RECORDING_STORAGE_ACCESS_KEY`
- `RECORDING_STORAGE_SECRET_KEY`
- `RECORDING_STORAGE_ENDPOINT` when using a custom S3-compatible endpoint

No LiveKit API secret or service-role key may be exposed through Vite/client environment variables.

## 4. Start

```bash
cd deploy/livekit
cp .env.example .env
# edit .env first
docker compose pull
docker compose config
docker compose up -d
```

Check services:

```bash
docker compose ps
docker compose logs --tail=200 livekit
docker compose logs --tail=200 egress
docker compose logs --tail=200 ingress
curl -fsS http://127.0.0.1:6789/metrics >/dev/null
```

## 5. Spark integration flow

1. Spark authorizes the user against the Meeting and conference DB state.
2. `conference-livekit-token` calls `prepare_livekit_conference_join`.
3. Waiting-room users receive no media token until admitted.
4. The token service provisions the opaque LiveKit room with `RoomServiceClient` and `maxParticipants <= 20`.
5. The browser receives only a short-lived participant JWT and the public WSS URL.
6. LiveKit Server handles SFU media routing, adaptive stream, dynacast and TURN fallback.
7. Host moderation uses `conference-host-control`; browser tokens never receive `roomAdmin`.
8. Recording uses LiveKit RoomComposite Egress through `conference-recording` and transitions `queued -> recording -> processing -> ready/failed` through verified lifecycle events.
9. LiveKit signed webhooks are verified by `livekit-webhook` and synchronize room, participant and egress lifecycle back into Postgres.
10. Speaker timer and hand-raise queue state are authoritative in Postgres. `conference-speaker-queue-control` performs Host reorder/time/allow/remove actions, and the timer enforcer reconciles queued/paused/expired/completed microphone permissions with LiveKit.
11. Meeting phase state is authoritative in `conference_rooms` with revisioned `conference_phase_events`. `conference-phase-control` applies Host transitions and `conference-phase-enforcer` synchronizes automatic Countdown/Break/Resuming transitions to every connected LiveKit participant.
12. Public conference chat history is persisted in PostgreSQL. `conference-chat-control` handles SFU send/edit/delete/reaction mutations, while Realtime only refreshes persisted message/reaction/mention state.
13. One-to-one private conference chat is persisted in `conference_private_messages`. Only sender and recipient can read through RLS; `conference-private-chat-control` handles send/edit/delete/read-receipt mutations.
14. Moderator chat is persisted independently in `conference_moderator_messages`. Access is permission-gated through `ACCESS_MODERATOR_CHAT`, granted only to HOST, CO_HOST and MODERATOR; normal participants cannot read it through Data API or Realtime.
15. Spark Manager configures both server-side worker endpoints used for timer/queue and meeting-phase reconciliation.
16. Ingress exposes RTMP on `ingress.shahrmeeting.ir:1935` and WHIP over `https://ingress.shahrmeeting.ir/whip` for external sources.

## 6. Production checks

Before production cutover validate all of the following from real client networks:

- two browsers on different networks can connect
- direct ICE/UDP works
- TURN/UDP on UDP 443 works
- TURN/TLS fallback works from a restrictive corporate network
- 20 simultaneous participants can join the same room
- 20th succeeds and 21st is rejected atomically
- screen sharing works on desktop and supported mobile browsers
- reconnect after Wi-Fi/mobile-network changes restores the session
- host remove/mute/promote/lock/end actions are enforced server-side
- persistent chat and ordered raise-hand state survive reconnects
- device switching works without leaving the room
- RoomComposite Egress reaches object storage and webhook marks final state `ready`
- RTMP and WHIP Ingress publish into an authorized room
- webhook replay is idempotent
- no secret appears in built frontend assets

## Version pins

- LiveKit Server: `v1.13.5`
- LiveKit Egress: `v1.13.0`
- LiveKit Ingress: `v1.5.0`
- JS client: `2.22.0`
- JS server SDK in Edge Functions: `2.18.0`

Upgrade only after reviewing release notes and rerunning the production checks above.

## Spark Manager single-host mode

`deploy/spark-cli` uses `docker-compose.spark-cli.yml`; Caddy remains disabled because Spark Nginx already owns TCP 80/443. Manager steps 19–21 manage TLS/Nginx, secrets, runtime, firewall and validation automatically.
