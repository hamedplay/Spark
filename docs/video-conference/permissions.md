# Spark Video Conference — Roles and Permissions

## 1. Authorization model

Conference authorization is RBAC-based and server-authoritative.

Canonical roles:

| Role | Rank |
|---|---:|
| OWNER | 100 |
| HOST | 90 |
| CO_HOST | 80 |
| MODERATOR | 70 |
| PRESENTER | 50 |
| PARTICIPANT | 40 |
| VIEWER | 30 |

Role assignments and permission mappings live in the private database schema. The frontend receives only the current authorization snapshot.

## 2. Assignable roles

Normal role mutation can assign:

- HOST
- CO_HOST
- MODERATOR
- PRESENTER
- PARTICIPANT
- VIEWER

`OWNER` cannot be assigned through ordinary role mutation. Ownership transfer is a separate privileged action.

The UI helper `hasConferencePermission` fails closed until authorization is loaded.

## 3. Permission catalogue

Current canonical permissions:

```text
ACCESS_MODERATOR_CHAT
BAN_PARTICIPANT
CREATE_POLL
DELETE_CHAT
DISABLE_CAMERA
DISABLE_MIC
DISABLE_SCREEN
END_MEETING
JOIN_ROOM
LOCK_ROOM
MANAGE_BREAKOUTS
MANAGE_CHAT
MANAGE_PHASE
MANAGE_POLLS
MANAGE_PRESENTATIONS
MANAGE_ROLES
MANAGE_TIMER
MANAGE_WAITING_ROOM
MANAGE_WHITEBOARD
MUTE_OTHERS
PIN_PARTICIPANT
PUBLISH_CAMERA
PUBLISH_MIC
PUBLISH_SCREEN
REMOVE_PARTICIPANT
SEND_CHAT
SEND_PRIVATE_CHAT
SHARE_FILE
SPOTLIGHT_PARTICIPANT
START_BREAK
START_RECORDING
STOP_RECORDING
SUBSCRIBE_MEDIA
TRANSFER_OWNERSHIP
USE_WHITEBOARD
VOTE_POLL
```

Do not infer permissions from role rank alone. The exact database mapping is authoritative.

## 4. Effective role mapping

The database resolves effective role from the authoritative conference model and private assignments. Legacy participant role values are normalized/projected where needed for compatibility.

New role assignment also updates the legacy participant role projection so old UI/runtime surfaces do not immediately break during the migration period.

## 5. Capability summary

### OWNER

Broad meeting control, including:

- role management
- room lock
- meeting end
- waiting room
- phase/timer
- moderation
- chat/polls/whiteboard/presentation
- recording
- media publish/subscribe
- ownership transfer

**Observed live mapping note:** `ACCESS_MODERATOR_CHAT` is currently not present in OWNER's stored permission rows even though HOST and CO_HOST have it. This document records the live DB state; it does not silently infer inheritance. Treat that as a review item if OWNER is expected to access moderator chat.

### HOST

Broad meeting control similar to OWNER, except ownership transfer.

### CO_HOST

Broad operational control, including phase, waiting room, recording, whiteboard, presentation, moderation, and role management. It does not have `END_MEETING` or ownership transfer in the current mapping.

### MODERATOR

Moderation-oriented rights, including moderator chat, polls, presentation management, waiting room, role management, timer, recording, and publish controls. It does not have the full HOST control set.

### PRESENTER

Presentation/media-oriented rights:

- join
- mic/camera/screen publish
- subscribe
- chat/private chat
- share file
- whiteboard use
- poll vote
- create poll
- manage presentations

### PARTICIPANT

Standard collaboration rights:

- join
- mic/camera/screen publish
- subscribe
- public/private chat
- share file
- whiteboard use
- poll vote

### VIEWER

Restricted collaboration:

- join
- subscribe media
- public/private chat
- poll vote

No microphone/camera/screen publishing permission is granted by the RBAC mapping.

## 6. LiveKit grant derivation

PostgreSQL permission state is translated to LiveKit grant fields.

The token Edge Function uses:

- `canPublish`
- `canSubscribe`
- `canPublishData`
- `canPublishSources`

Therefore UI visibility is not the security boundary. Disabling a button without changing the server policy does not revoke media rights.

## 7. Runtime restriction model

Per-user media restrictions are durable columns on `conference_participants`:

- `mic_publishing_disabled`
- `camera_publishing_disabled`
- `screen_publishing_disabled`

Host-control actions update these through server RPCs and synchronize current LiveKit permissions. Offline users receive the restricted policy when they obtain the next token.

## 8. Security rules

1. Never authorize by frontend role labels.
2. Never trust user-editable metadata for conference authorization.
3. Never grant OWNER through normal role mutation.
4. Never mutate private RBAC tables from the client.
5. Use `get_my_conference_authorization` for the client snapshot.
6. Use server authorization for every privileged Edge Function.
7. Keep direct client updates away from server-authoritative participant fields.
