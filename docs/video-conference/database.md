# Spark Video Conference — Database

## 1. Database role in the architecture

PostgreSQL is the authoritative state store for the conference business layer. LiveKit runtime state is synchronized back into PostgreSQL where durable lifecycle, authorization, audit, or recovery semantics are required.

All currently identified conference tables in the live database have RLS enabled.

## 2. Public conference tables

Current public tables are grouped below.

### Room and participant lifecycle

- `conference_rooms`
- `conference_participants`
- `conference_waiting_room`
- `conference_attendance_events`
- `conference_audit_events`
- `conference_archives`
- `conference_preflight_results`
- `conference_quality_metrics`

### Meeting control

- `conference_phase_events`
- `conference_speaker_sessions`
- `conference_spotlights`

### Communication

- `conference_messages`
- `conference_message_mentions`
- `conference_message_reactions`
- `conference_private_messages`
- `conference_moderator_messages`
- `conference_reactions`

### Polls

- `conference_polls`
- `conference_poll_options`
- `conference_poll_votes`

### Whiteboard and presentation

- `conference_whiteboard` — legacy compatibility
- `conference_whiteboard_boards`
- `conference_whiteboard_pages`
- `conference_whiteboard_snapshots`
- `conference_presentations`
- `conference_presentation_state`
- `conference_presentation_annotations`

### Recording/transcript

- `conference_recordings`
- `conference_recording_consents`
- `conference_live_captions`
- `conference_transcripts`
- `conference_transcript_segments`

### Breakout/legacy signaling

- `conference_breakout_rooms`
- `conference_breakout_assignments`
- `conference_signals`

### LiveKit integration

- `livekit_webhook_events`

## 3. Private RBAC tables

RBAC catalogue and assignments are deliberately stored in the private schema:

- `private.conference_rbac_roles`
- `private.conference_permissions`
- `private.conference_role_permissions`
- `private.conference_role_assignments`

Client roles do not receive direct table access to these catalogues. Public authorization is exposed through narrow RPCs such as `get_my_conference_authorization`.

## 4. Important room columns

`conference_rooms` contains both legacy and SFU lifecycle fields. Important current columns include:

- `host_id`
- `status`
- `media_topology`
- `max_participants`
- `livekit_room_name`
- `livekit_room_sid`
- `livekit_metadata`
- `waiting_room_enabled`
- `is_locked`
- `record_enabled`
- `recording_consent_required`
- `current_phase`
- `phase_started_at`
- `phase_ends_at`
- phase media/chat policy fields
- `expires_at`

The schema default for `media_topology` is still `mesh`, but the current runtime system configuration selects `sfu` for new rooms created through the authoritative RPC path.

## 5. Participant state

`conference_participants` stores durable participant state including:

- user identity and display name
- legacy role projection
- joined/waiting/left lifecycle
- mute/video/hand state
- speaking limit
- hand raise timestamp
- mic/camera/screen publish restrictions
- `livekit_rejoin_blocked_until`

Phase 20/21 guards prevent clients from directly changing server-authoritative identity, role, lifecycle, and LiveKit restriction columns.

## 6. Meeting phase state

The room stores the current phase while `conference_phase_events` stores revisioned transition history and runtime enforcement metadata.

Supported phase model:

```text
SCHEDULED -> WAITING -> COUNTDOWN -> LIVE
LIVE -> BREAK -> RESUMING -> LIVE
any non-ended valid state -> ENDED
```

Timer enforcement is server-driven. Realtime updates are synchronization notifications; clients refresh authoritative snapshots.

## 7. Recording state

`conference_recordings.status` is constrained to:

```text
queued
starting
recording
stopping
processing
completed
failed
```

Only one active recording per room is allowed by a partial unique index over:

```text
queued, starting, recording, stopping, processing
```

Consent decisions are stored in `conference_recording_consents` as `accepted` or `declined`.

## 8. Whiteboard v2 state

Whiteboard v2 uses:

- one board row per room
- ordered pages per room
- revisioned snapshots per page
- JSON snapshots with an `elements` array
- a private Storage bucket for image assets

The legacy `conference_whiteboard` table remains for compatibility and is not the v2 source of truth.

## 9. Public RPC vs private implementation

The database follows a wrapper pattern:

```text
authenticated client
  -> public RPC
      -> full-session/access gate
      -> private authorization/business function
          -> authoritative table mutation
```

Examples:

- `get_my_conference_authorization`
- `prepare_livekit_conference_join`
- `get_my_livekit_conference_policy`
- `get_conference_phase_snapshot`
- `get_conference_speaker_timer_snapshot`
- `get_livekit_waiting_room_snapshot`
- `get_conference_whiteboard_snapshot_v2`
- `get_conference_poll_snapshot`
- `get_conference_presentation_snapshot`
- `set_conference_recording_consent`

Service-role-only apply/reconciliation RPCs are used for Edge Function and worker mutations.

## 10. Current non-secret runtime configuration

Observed current values relevant to architecture:

| Key | Current value |
|---|---|
| `media_topology` | `sfu` |
| `max_participants` | `10` |
| `default_waiting_room` | `true` |
| `default_allow_chat` | `true` |
| `default_allow_reactions` | `true` |
| `default_allow_screen_share` | `true` |
| `recording_enabled` | `true` |
| `room_default_ttl_hours` | `8` |
| `enable_turn_fallback` | `true` |

Credentials, TURN secrets, API keys, JWT secrets, and service-role values are intentionally excluded from documentation.

## 11. Migration discipline

Conference development uses append-only migrations. Existing migration files must not be edited after application.

Current conference migration series covers, among other areas:

- Phase 2: RBAC
- Phase 3: LiveKit permission policy
- Phase 4/5: speaker timer and queue
- Phase 6: meeting phase
- Phase 7-9: public/private/moderator chat
- Phase 10: reactions
- Phase 11: polls
- Phase 12: whiteboard
- Phase 13: presentation
- Phase 16: recording hardening
- Phase 17: waiting room
- Phase 18: media permission hardening
- Phase 19: spotlight
- Phase 20: security/runtime boundary
- Phase 21: token/rejoin hardening

Any future DB change must be delivered as a new migration and validated against the live schema.
