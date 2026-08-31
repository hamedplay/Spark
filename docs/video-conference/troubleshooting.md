# Spark Video Conference — Troubleshooting

## 1. First classify the failure

Determine which layer is failing:

| Symptom | Likely layer |
|---|---|
| Cannot open conference page | Spark frontend/auth |
| Token request 401/403 | Auth/access/RBAC |
| Token request 202 | Waiting room |
| Token request 409 | Capacity |
| Token request 423 | Room lock |
| Token request 503 | LiveKit/server configuration |
| Joined but no media | LiveKit/ICE/permissions/devices |
| One media source blocked | conference media permission |
| Chat/poll/whiteboard failure | DB/Edge authorization/state |
| Recording stuck | Egress/webhook/reconciliation/storage |
| High loss/reconnects | network/TURN/host capacity |

## 2. Token endpoint failures

### 401 `NOT_AUTHENTICATED`

Check:

- Spark session exists
- Bearer token is present
- token is not expired
- anonymous auth is not being used

### 403 `NOT_AUTHORIZED`

Check:

- `get_my_auth_access_state` returns `FULL`
- user is allowed to join the room
- conference authorization is loaded
- LiveKit policy RPC returns an allowed role/policy
- Phase 21 rejoin block is not active

### 202 `WAITING_FOR_ADMISSION`

This is not a media failure.

Check:

- `conference_waiting_room`
- host waiting-room panel
- expiration/admission status
- whether the host admitted the user

### 409 `ROOM_FULL`

Compare:

- room `max_participants`
- current joined/reserved participants
- live runtime `max_participants`

Do not raise the number only in the UI.

### 423 `ROOM_LOCKED`

Unlock via the authorized host-control path; do not update the room row directly from a browser client.

## 3. User joins but cannot publish microphone/camera/screen

Check effective authorization and participant restriction columns:

```text
mic_publishing_disabled
camera_publishing_disabled
screen_publishing_disabled
```

Then verify the LiveKit participant permission was synchronized.

For an offline participant, the DB restriction may be correct even though no runtime LiveKit participant exists; the next token will carry the restricted grant.

## 4. Media connection / TURN problems

Check public reachability:

- HTTPS/WSS 443 TCP
- TURN 443 UDP
- TURN/TLS 5349 TCP
- ICE/TCP 7881
- UDP media range 50000-60000

Then inspect browser diagnostics:

- ICE state
- candidate type
- transport protocol
- `turnInUse`
- relay protocol
- RTT
- packet loss
- jitter

If direct UDP is blocked, TURN should become relevant. A user falling back to TURN is not inherently an error.

## 5. Reconnect loop

Check:

- browser online/offline status
- LiveKit reconnect events
- `livekit_rejoin_blocked_until`
- recent moderation/removal events
- token reissue eligibility
- room state/expiry
- LiveKit server health

Do not repeatedly mint tokens if the database intentionally blocks rejoin.

## 6. Phase/countdown problems

Authoritative fields live in the room/phase event model.

Check:

- current phase
- phase revision
- `phase_ends_at`
- server time
- phase event runtime sync status
- enforcement attempts/error

The browser countdown is display logic based on synchronized server time. Do not repair it by making the browser the phase authority.

## 7. Speaker timer/queue problems

Check:

- `conference_speaker_sessions`
- session status
- allocated/used seconds
- queue position
- expiry timestamp
- worker enforcement state

If UI state differs, reload the authoritative speaker timer snapshot.

## 8. Chat/poll/private/moderator failures

Check the relevant permission first.

Examples:

- `SEND_CHAT`
- `SEND_PRIVATE_CHAT`
- `ACCESS_MODERATOR_CHAT`
- `CREATE_POLL`
- `MANAGE_POLLS`
- `VOTE_POLL`

Then inspect the corresponding Edge Function/server response code. Do not treat a hidden UI control as proof of server authorization.

## 9. Whiteboard failures

If load fails:

- participant must be joined
- session must be fully authorized
- v2 snapshot RPC must succeed

If edit fails:

- require `USE_WHITEBOARD`
- board may be locked
- managers require `MANAGE_WHITEBOARD`

If image upload fails:

- validate MIME type
- file must be <= 5 MiB
- verify room/page/user path
- verify private Storage policy
- request a fresh signed URL

## 10. Recording stuck or failed

Inspect:

```text
conference_recordings
```

Fields of interest:

- status
- provider_egress_id
- provider_status
- storage_path
- error_message
- last_webhook_event_id
- reconciled_at

Then verify:

1. Egress service is healthy
2. MinIO is healthy and has capacity
3. webhook signature endpoint is reachable
4. webhook event processing is not failing
5. explicit reconcile can find the Egress job

Do not force a terminal DB status if the provider state is unknown.

## 11. Monitoring shows no data

Check:

- observability profile is started
- Prometheus can scrape 6789/6788/6787
- node exporter is reachable
- Alloy and Loki are healthy
- Grafana data sources point to local Prometheus/Loki/Alertmanager
- filesystem permissions/volumes are writable

If alerts fire but nobody receives them, remember the checked-in Alertmanager config has no external delivery receiver.

## 12. Build/test failures

Run:

```bash
npm run test:video-conference
npm run build
```

Do not use Lint as the project validation gate.

For integration/E2E/load suites, verify required environment variables before interpreting failures as application regressions.

## 13. Safe database inspection

Prefer read-only queries while diagnosing.

Useful examples:

```sql
select id,status,media_topology,max_participants,current_phase
from public.conference_rooms
where id = '<room-uuid>';

select user_id,status,role,is_muted,
       mic_publishing_disabled,
       camera_publishing_disabled,
       screen_publishing_disabled,
       livekit_rejoin_blocked_until
from public.conference_participants
where room_id = '<room-uuid>';

select status,provider_egress_id,error_message,reconciled_at
from public.conference_recordings
where room_id = '<room-uuid>'
order by created_at desc;
```

Use real UUIDs through your secure DB tooling; do not paste secrets into chat/logs/scripts.

## 14. Secret handling

Never place these in bug reports or committed diagnostics:

- Supabase service-role key
- JWT secret
- LiveKit API secret
- TURN credential
- MinIO/S3 secret
- user Bearer tokens
- Grafana admin password

Redact secrets before sharing logs.
