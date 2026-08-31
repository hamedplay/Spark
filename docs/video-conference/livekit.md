# Spark Video Conference — LiveKit

## 1. Purpose

LiveKit is Spark's self-hosted SFU and media signaling layer. It is not the business authorization database.

Current checked-in versions:

| Component | Version |
|---|---|
| LiveKit Server | `v1.13.5` |
| LiveKit Egress | `v1.13.0` |
| LiveKit Ingress | `v1.5.0` |
| Browser `livekit-client` | `2.22.0` |
| Edge `livekit-server-sdk` | `2.18.0` |

## 2. Token issuance

Token issuance is handled by:

```text
supabase/functions/conference-livekit-token/index.ts
```

Flow:

1. Require Bearer authentication.
2. Resolve the user with Supabase Auth.
3. Reject anonymous users.
4. Require Spark access state `FULL`.
5. Call `prepare_livekit_conference_join`.
6. Call `get_my_livekit_conference_policy`.
7. Ensure/provision the LiveKit room.
8. Mint a room-scoped LiveKit token.

Current token properties:

- identity = authenticated Spark user UUID
- TTL = **120 seconds**
- `roomAdmin = false`
- publish/subscribe/data permission is derived from server policy
- allowed publish sources are derived from server policy
- response is sent with no-store/no-cache headers

The short token TTL is intentional. Runtime reconnect/reissue rules are enforced by the Phase 21 join guard.

## 3. LiveKit permission policy

The token function does not grant blanket publishing rights.

The DB policy returns:

- `can_publish`
- `can_subscribe`
- `can_publish_data`
- `publish_sources`

Recognized sources:

- camera
- microphone
- screen share
- screen-share audio

Moderation changes to mic/camera/screen restrictions update durable DB state and then synchronize the connected LiveKit participant permission.

## 4. Room provisioning

When an authorized user joins, the token Edge Function ensures the LiveKit room exists.

Provisioning parameters include:

- `emptyTimeout = 300`
- `departureTimeout = 60`
- Spark room ID in LiveKit room metadata
- maximum participant count clamped to a hard maximum of 20

The current live Spark runtime configuration sets `max_participants=10`. A value of 20 is the code/test ceiling, not the currently configured production limit.

## 5. Media configuration

LiveKit is configured with:

- API/signaling port: 7880
- ICE/TCP: 7881
- UDP media range: 50000-60000
- embedded TURN/UDP: 443
- TURN/TLS: 5349
- Prometheus metrics: 6789
- Redis-backed distributed state

Frontend media includes:

- microphone
- camera
- screen share
- active-speaker focus
- grid/speaker layouts
- adaptive media-quality profiles
- reconnect state
- connection quality
- per-track network diagnostics

## 6. Moderation

`conference-host-control` is the LiveKit runtime moderation boundary.

Supported actions include:

- remove participant
- mute current microphone track
- assign conference role
- disable/enable microphone publishing
- disable/enable camera publishing
- disable/enable screen publishing
- lock/unlock room
- lower hand
- end room

Authorization is checked in PostgreSQL before the LiveKit server API is called.

For publish-source restrictions, Spark synchronizes DB policy with `RoomServiceClient.updateParticipant`. If a participant is offline, the durable DB restriction remains authoritative and applies on the next token issue.

## 7. Meeting phase and speaker enforcement

Meeting phase and speaker timer are PostgreSQL-authoritative, with Edge workers responsible for applying runtime media restrictions to connected LiveKit participants.

Relevant functions:

- `conference-phase-control`
- `conference-phase-enforcer`
- `conference-speaker-timer-control`
- `conference-speaker-timer-enforcer`

Stale phase revisions are prevented from overwriting newer state.

## 8. Webhook integration

LiveKit sends signed webhooks to:

```text
supabase/functions/livekit-webhook/index.ts
```

The handler:

- verifies the LiveKit webhook signature
- requires a LiveKit event ID
- treats event ID as idempotency key
- extracts room, participant, and Egress identifiers
- applies state through `apply_livekit_webhook_event_v1`

Never bypass signature verification or process webhook lifecycle changes directly in the browser.

## 9. Egress and Ingress

Egress:

- records room composite output
- uses Redis
- exposes metrics on 6788
- writes recordings to S3-compatible storage

Ingress:

- uses Redis
- RTMP port 1935
- WHIP UDP port 7885
- metrics on 6787

Ingress infrastructure exists even if no current Spark UI workflow exercises every ingress scenario.

## 10. Legacy Mesh boundary

`ConferenceRoom.tsx` still routes non-SFU rooms to `ConferenceRoomCore.tsx`.

Do not remove that branch solely because the active runtime config is SFU. A safe removal requires a separate migration/cutover decision proving no supported room or rollback path depends on Mesh.
