# Spark Video Conference — Recording

## 1. Recording architecture

Spark recording uses **LiveKit Room Composite Egress** with S3-compatible storage.

```text
Authorized host/co-host/moderator
  -> conference-recording Edge Function
      -> PostgreSQL authorize_livekit_recording
      -> conference_recordings metadata
      -> LiveKit Egress
          -> MinIO/S3-compatible storage
      -> webhook/reconciliation
          -> final database lifecycle
```

## 2. Authorization

Starting/stopping recording is permission-based:

- `START_RECORDING`
- `STOP_RECORDING`

The Edge Function also requires Spark access state `FULL`.

Recording must be enabled for the room/runtime.

## 3. Consent gate

Rooms support `recording_consent_required`.

When consent is required, recording authorization checks joined participants and blocks start while required consent is missing.

Consent state:

```text
accepted
declined
```

The client controller exposes `pending` when no stored decision exists.

Consent is stored in:

```text
conference_recording_consents
(room_id, user_id, status, policy_version, decided_at, ...)
```

## 4. Lifecycle

Canonical recording lifecycle:

```text
queued
  -> starting
  -> recording
  -> stopping
  -> processing
  -> completed

failure at an unrecoverable stage -> failed
```

Database constraint permits only:

- queued
- starting
- recording
- stopping
- processing
- completed
- failed

A partial unique index permits only one active recording row per room across the active states.

## 5. Start flow

On `start`:

1. authorize the action
2. reconcile any existing active row
3. enforce idempotency
4. create a `queued` metadata row
5. move to `starting`
6. call `startRoomCompositeEgress`
7. use MP4/H.264 1080p30 room-composite output
8. store to a generated room-scoped object path
9. apply returned Egress state
10. write a recording audit event

The object path format is:

```text
conference/<room-id>/<uuid>.mp4
```

## 6. Stop flow

On `stop`:

1. locate/reconcile the active recording
2. require a known Egress ID
3. move metadata to `stopping`
4. call `stopEgress`
5. apply returned provider state
6. write a recording audit event

If provider status is uncertain, the system prefers reconciliation over inventing a terminal status.

## 7. Reconciliation

`conference-recording` supports an explicit `reconcile` action.

Reconciliation can match by:

- provider Egress ID
- room name + expected storage path

Database application is performed through:

```text
apply_livekit_recording_reconcile_v1
```

Provider Egress statuses are mapped monotonically into the Spark lifecycle so stale provider updates cannot move a terminal recording backward.

## 8. Webhook behavior

`livekit-webhook` verifies the signature and forwards Egress events to the database.

The recording row stores integration metadata such as:

- `provider_egress_id`
- `provider_status`
- `last_webhook_event_id`
- `reconciled_at`

Webhook event IDs are also used for integration idempotency.

## 9. Storage

The deployment uses local MinIO through the S3 API.

Security requirements:

- MinIO API remains loopback-only in the single-host topology.
- Storage credentials exist only in server/runtime environment.
- Browser code never receives S3 credentials.
- Real credentials must not be committed to Git.

## 10. Failure semantics

Important error categories include:

- recording disabled
- missing participant consent
- storage not configured
- metadata insert failure
- Egress start failure
- Egress stop uncertainty
- Egress not found during reconciliation

When start/stop outcome is uncertain because the provider cannot be queried, the row remains in a recoverable non-terminal state with an error marker rather than being falsely marked complete.

## 11. Operational checks

When recording appears stuck:

1. inspect `conference_recordings.status`
2. check `provider_egress_id`
3. check Egress worker health/metrics
4. inspect webhook processing
5. use the server-authorized reconcile path
6. verify MinIO health and capacity
7. never manually force `completed` unless provider/storage state has been independently proven
