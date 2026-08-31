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
- `conference-reaction`
- `conference-poll-control`
- `conference-whiteboard-control`
- `conference-presentation-control`
- `livekit-webhook`

Also configure:

- `LIVEKIT_URL=https://meet.shahrmeeting.ir` (server API)
- `LIVEKIT_WS_URL=wss://meet.shahrmeeting.ir` (browser signaling)
- `RECORDING_STORAGE_BUCKET`
- `RECORDING_STORAGE_REGION`
- `RECORDING_STORAGE_ACCESS_KEY`
- `RECORDING_STORAGE_SECRET_KEY`
- `RECORDING_STORAGE_ENDPOINT` when using a custom S3-compatible endpoint
- `PRESENTATION_CONVERTER_URL` for a self-hosted Gotenberg LibreOffice endpoint reachable from the Edge Functions runtime (for example `http://gotenberg:3000` on a private service network)

Keep the converter internal; do not expose it directly to the public Internet. PDF/image presentations need no conversion. PowerPoint/OpenDocument/Word sources are converted to PDF before activation.

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
3. For SFU rooms, `conference_waiting_room` is the authoritative admission state. Each room/user has one request row with a five-minute TTL and lifecycle `waiting -> admitted/rejected/expired`. No media token is issued while `waiting`. Host actions `admit`, `reject`, and capacity-aware `admit all` are serialized in PostgreSQL. Locking a room blocks new waiting requests but preserves pre-existing waiting decisions and already-admitted reconnects.
4. The token service provisions the opaque LiveKit room with `RoomServiceClient` and `maxParticipants <= 20`.
5. The browser receives only a short-lived participant JWT and the public WSS URL.
6. LiveKit Server handles SFU media routing, adaptive stream, dynacast and TURN fallback.
7. Host moderation uses `conference-host-control`; browser tokens never receive `roomAdmin`.
8. Recording uses LiveKit RoomComposite Egress through `conference-recording` with the production lifecycle `queued -> starting -> recording -> stopping -> processing -> completed/failed`. One active recording per room is enforced in PostgreSQL. Start/stop uncertainty is reconciled against LiveKit Egress by Egress ID or the unique object-storage path instead of immediately marking an uncertain request failed.
9. LiveKit signed webhooks are verified by `livekit-webhook`. Webhook `event.id` is the database idempotency key, Egress state transitions are monotonic, and final `duration_seconds`, `size_bytes`, `started_at`, `ended_at`, `provider_egress_id`, `status`, and `storage_path` are synchronized from verified Egress lifecycle payloads. Recording consent is stored per room/user; starting recording requires accepted consent from the host and every joined participant, and a participant cannot receive a LiveKit media token for an already-recording room until consent is accepted.
10. Speaker timer and hand-raise queue state are authoritative in Postgres. `conference-speaker-queue-control` performs Host reorder/time/allow/remove actions, and the timer enforcer reconciles queued/paused/expired/completed microphone permissions with LiveKit.
11. Meeting phase state is authoritative in `conference_rooms` with revisioned `conference_phase_events`. `conference-phase-control` applies Host transitions and `conference-phase-enforcer` synchronizes automatic Countdown/Break/Resuming transitions to every connected LiveKit participant.
12. Public conference chat history is persisted in PostgreSQL. `conference-chat-control` handles SFU send/edit/delete/reaction mutations, while Realtime only refreshes persisted message/reaction/mention state.
13. One-to-one private conference chat is persisted in `conference_private_messages`. Only sender and recipient can read through RLS; `conference-private-chat-control` handles send/edit/delete/read-receipt mutations.
14. Moderator chat is persisted independently in `conference_moderator_messages`. Access is permission-gated through `ACCESS_MODERATOR_CHAT`, granted only to HOST, CO_HOST and MODERATOR; normal participants cannot read it through Data API or Realtime.
15. Interactive meeting reactions stay transient. `conference-reaction` authenticates the participant, applies an atomic 5-per-5-seconds rate limit, enriches the event with identity/display name/avatar/timestamp, and broadcasts it through LiveKit RoomService SendData on topic `spark-reaction`.
16. Polls are persisted in `conference_polls`, `conference_poll_options` and `conference_poll_votes`. `conference-poll-control` validates create/open/close/vote/delete mutations server-side, while clients consume RLS-safe aggregate snapshots and use Realtime changes only to refresh that snapshot.
17. Collaborative whiteboard state uses revisioned PostgreSQL page snapshots plus periodic checkpoint snapshots. `conference-whiteboard-control` validates persistent mutations server-side and broadcasts committed operations through LiveKit Reliable DataPackets on `spark-whiteboard-op`; cursors and laser pointers stay transient on `spark-whiteboard-presence`. Images live in the private `conference-whiteboard-assets` bucket and snapshots store only scoped object paths.
18. Presentation sharing stores PDF/images/slides/documents in the private `conference-presentations` bucket with PostgreSQL metadata and synchronized page state. `conference-presentation-control` authorizes create/finalize/activate/navigate/delete and annotation mutations. Office sources use self-hosted Gotenberg; laser pointers stay transient on `spark-presentation-laser`.
19. Media quality profiles (`AUTO`, `DATA_SAVER`, `BALANCED`, `HIGH`) use LiveKit Adaptive Stream + Dynacast + camera simulcast. Small Grid tiles are capped below the high simulcast layer, while the active speaker or pinned tile can request a higher layer. Camera capture supports 180p/360p/540p/720p/1080p. Screen Share is configured independently at 720p or 1080p with its own simulcast ladder.
20. Network diagnostics sample supported WebRTC sender/receiver stats through LiveKit track `getRTCStatsReport()` and combine them with LiveKit Connection Quality. The user sees only `Excellent/Good/Weak/Poor`; admins with `MANAGE_ROLES` can inspect RTT, packet loss, jitter, bitrate, codec, resolution, FPS, candidate type, ICE pair state, TURN relay usage and reconnect count. Candidate addresses, IPs, SDP, tokens and TURN credentials are never rendered.
21. Audio/video controls keep local media preferences separate from server authorization. Participants can toggle microphone/camera/screen share, locally mute remote audio, select supported microphone/camera/speaker devices, cycle cameras, switch Grid/Speaker layout, pin locally, and use fullscreen/Picture-in-Picture/zoom. Screen share is rendered with display priority without discarding the participant strip.
22. Host media moderation distinguishes `mute current microphone track` from `revoke publish permission`. Temporary mute uses LiveKit `MutePublishedTrack` only for the microphone source. Persistent microphone/camera/screen restrictions are stored in `conference_participants`, included in every generated LiveKit publish policy, and immediately synchronized with `UpdateParticipant`, so reconnect/token refresh cannot restore a revoked source.
23. Pin and Spotlight are intentionally separate. Pin is a client-local preference only and is never written to PostgreSQL or Realtime. Spotlight is Host-controlled shared room state stored in `conference_spotlights`, supports multiple participants, is read-only to authenticated joined clients, synchronizes through Postgres Realtime, and is automatically removed when a spotlighted participant leaves. The legacy `conference_rooms.pinned_user_id` field is not used by the LiveKit SFU Pin/Spotlight path.
24. Conference API boundaries fail closed unless the current Supabase session has `FULL` authorization. Direct Data API insertion into `conference_participants` is disabled, LiveKit publish-restriction columns are server-authoritative, and legacy direct chat inserts are guarded in PostgreSQL with canonical identity, authorization, rate limits and attachment validation. Anonymous access to legacy `conference_signals` and `conference_reactions` is disabled.
25. Conference chat attachments use a private bucket with a 5 MiB server limit and an exact JPEG/PNG/WebP/GIF MIME allowlist. Conference paths are scoped to `conf-chat/<room>/<user>/...`, require FULL authorization, joined-room membership and `SEND_CHAT`, and attached messages must reference an owned storage object. Presentation and whiteboard buckets remain private and enforce their own server-side size/MIME/path policies.
26. LiveKit access tokens are generated only in the server-side token Edge Function, scoped to the authenticated identity and one room, have a 2-minute TTL, derive publish sources from PostgreSQL authorization and never grant `roomAdmin`. Token responses are explicitly `no-store`. While a client remains connected, the LiveKit SDK/server owns normal signal/media resume and in-session token refresh. If that recovery becomes terminal, Spark discards the dead Room and requests a fresh backend-authorized token only for retryable disconnect reasons with bounded backoff. `PARTICIPANT_REMOVED`, `ROOM_DELETED`, `ROOM_CLOSED` and `DUPLICATE_IDENTITY` never auto-rejoin. Moderator removal also creates a 2-minute server-authoritative fresh-token reissue cooldown, matching the short self-hosted replay window. LiveKit webhooks verify the signed raw body with `WebhookReceiver` and require an event ID before idempotent state mutation.
27. Observability is self-hosted through Prometheus, Grafana, Loki, Alertmanager, Alloy, Node Exporter and Blackbox Exporter. LiveKit/Egress/Ingress native Prometheus endpoints remain the authoritative media metrics source. SFU CPU/RAM use the LiveKit process metrics directly, host CPU/RAM/network use Node Exporter, and public API latency/availability use HTTPS Blackbox probes. Docker logs are collected by Alloy into Loki so reconnects, ICE/RTC failures, Egress errors and PostgreSQL errors are queryable without exposing credentials.
28. Monitoring HTTP surfaces are loopback-only: Grafana `127.0.0.1:3000`, Prometheus `127.0.0.1:9090`, Alertmanager `127.0.0.1:9093`, Loki `127.0.0.1:3100`, Alloy `127.0.0.1:12345`, Node Exporter `127.0.0.1:9100` and Blackbox Exporter `127.0.0.1:9115`. Access Grafana through an SSH tunnel or another explicitly authenticated internal access layer; do not publish these ports through Nginx or UFW.
29. Prometheus keeps 15 days of metrics and Loki keeps 7 days of logs in the single-host profile. Alertmanager is provisioned with a local receiver only; add an internal webhook/email receiver explicitly if operations notifications are required.
30. The Grafana folder `Spark LiveKit` is provisioned with `Spark LiveKit — Overview` and `Spark LiveKit — Operations & Logs`. Together they cover active rooms/participants, SFU CPU/RAM, media network in/out, packet loss, embedded TURN/relay connection telemetry, RTC join failures, Egress availability/errors, API latency, reconnect/ICE events and DB errors.
31. Spark Manager configures both server-side worker endpoints used for timer/queue and meeting-phase reconciliation.
32. Ingress exposes RTMP on `ingress.shahrmeeting.ir:1935` and WHIP over `https://ingress.shahrmeeting.ir/whip` for external sources.

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
- host microphone mute changes only the current microphone track and does not silently revoke publish permission
- disabling microphone/camera/screen publishing removes only the targeted LiveKit source and remains revoked after reconnect/token refresh
- re-enabling a media source restores only the DB-authorized source set
- browser-native Stop Sharing updates Spark screen-share state without requiring a page refresh
- supported browsers can select microphone/camera/speaker devices and device-change events refresh the available list
- local speaker mute affects only the current user's playback and does not change server/participant state
- Grid and Speaker views work independently from local Pin; an active screen share receives focus priority
- Pin changes only the current browser layout and never mutate `conference_rooms.pinned_user_id` or any shared table
- Host Spotlight changes are visible to every joined participant through `conference_spotlights` Realtime updates
- multiple Spotlight participants can coexist; display priority is Screen Share → Spotlight → local Pin → Active Speaker
- duplicate Spotlight add/remove requests are idempotent and leaving a room removes stale Spotlight state
- a RESTRICTED/expired application session cannot resolve, join, authorize or manage a Conference room
- direct Data API participant insertion is denied; client updates cannot clear microphone/camera/screen publish restrictions
- legacy mesh media-state updates remain limited to local mute/video/hand fields
- anonymous clients cannot read or write legacy conference signaling/reaction tables
- server-managed Conference audit, attendance, phase, speaker and message-index tables are not directly writable by authenticated clients
- legacy direct chat cannot bypass backend room authorization, canonical sender identity or chat rate limits
- conference chat attachment upload/read is room-scoped, FULL-auth gated and limited to the bucket MIME/size policy
- a message cannot attach another user's Conference storage object or a fake/nonexistent Conference attachment path
- LiveKit webhook requests with an invalid signature or missing event ID are rejected
- LiveKit tokens remain identity-scoped, room-scoped, DB-permission-derived, non-admin and two minutes or shorter
- token responses are non-cacheable and no LiveKit API key/secret or room token is persisted in frontend storage
- normal LiveKit reconnect uses the SDK-managed in-session refresh/resume path; terminal retryable disconnects obtain a fresh backend token with bounded backoff
- participant removal, room deletion/closure and duplicate identity do not trigger automatic fresh-token rejoin
- moderator removal blocks fresh token issuance for the self-hosted replay cooldown before a new join can be authorized
- participant video supports fullscreen, Picture-in-Picture where the browser supports it, and local zoom
- simultaneous waiting-room admit/reject actions resolve only once and cannot overwrite the first decision
- admit-all preserves request order and never reserves more than the 20-participant room capacity
- waiting requests become expired after five minutes even if a Realtime event is missed
- locking an SFU room blocks new waiting requests while existing waiting requests remain manageable
- an admitted participant keeps a reserved capacity slot until joining and can reconnect after the room is locked
- persistent chat and ordered raise-hand state survive reconnects
- device switching works without leaving the room
- 20-person Grid does not request the 1080p camera layer for ordinary small tiles
- active-speaker/pinned tile can step up to the high camera layer when bandwidth permits
- changing Camera profile does not alter the independent Screen Share quality setting
- recording start is rejected until every current participant has accepted the recording consent policy
- joining an already-recording SFU room without accepted consent yields no LiveKit media token
- duplicate/out-of-order Egress webhooks do not downgrade a terminal recording state
- an uncertain start/stop request is reconciled with LiveKit before another Egress is created
- completed recording metadata contains duration, size, timestamps, Egress ID and object-storage path
- diagnostics shows Excellent/Good/Weak/Poor to normal users
- admin diagnostics exposes RTC health metrics without IP/candidate addresses or credentials
- restrictive-network test reports TURN relay usage without exposing TURN secrets
- RoomComposite Egress reaches object storage and webhook marks final state `ready`
- RTMP and WHIP Ingress publish into an authorized room
- webhook replay is idempotent
- Prometheus scrapes LiveKit/Egress/Ingress plus host/exporter endpoints and all required targets report `up == 1`
- active rooms/participants, SFU CPU/RAM, media network throughput, packet-loss p95, RTC join failures and Egress availability render in the Overview dashboard
- reconnect/resume events, ICE/RTC failures, Egress errors and PostgreSQL errors are queryable through Loki
- Blackbox probes report Spark API and LiveKit/Ingress HTTPS availability; Spark API latency is visible and alertable
- Grafana, Prometheus, Alertmanager, Loki, Alloy and exporter HTTP ports listen on `127.0.0.1` only
- Grafana anonymous access and sign-up remain disabled and the generated admin password is stored only in the root-owned LiveKit `.env`
- no secret appears in built frontend assets

## Version pins

- LiveKit Server: `v1.13.5`
- LiveKit Egress: `v1.13.0`
- LiveKit Ingress: `v1.5.0`
- JS client: `2.22.0`
- JS server SDK in Edge Functions: `2.18.0`

- Prometheus: `v3.14.0`
- Alertmanager: `v0.34.0`
- Grafana OSS: `13.2.0`
- Loki: `3.7.0`
- Grafana Alloy: `v1.19.0`
- Node Exporter: `v1.12.1`
- Blackbox Exporter: `v0.28.0`

Upgrade only after reviewing release notes and rerunning the production checks above.

## Spark Manager single-host mode

`deploy/spark-cli` uses `docker-compose.spark-cli.yml`; Caddy remains disabled because Spark Nginx already owns TCP 80/443. Manager steps 19–22 manage TLS/Nginx, secrets, runtime, firewall, validation and observability automatically.

Step 22 runs the `observability` Docker Compose profile after the LiveKit validation step. It generates Blackbox targets from the actual `API_DOMAIN`, `LIVEKIT_DOMAIN` and `LIVEKIT_INGRESS_DOMAIN`, creates a random Grafana admin password when needed, starts the pinned monitoring images, verifies every monitoring service, verifies Prometheus target health, and rejects any observability HTTP listener bound to `0.0.0.0` or `[::]`.

For operator access without publishing Grafana, use a local tunnel such as `ssh -L 3000:127.0.0.1:3000 <server>`, then open `http://127.0.0.1:3000`. The Grafana username/password are the `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` values in the root-owned `/opt/spark-livekit/.env`. Do not copy that password into frontend source, Nginx config, dashboards or documentation.
