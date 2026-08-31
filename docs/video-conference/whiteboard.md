# Spark Video Conference — Collaborative Whiteboard

## 1. Current implementation

The active collaborative whiteboard is **Whiteboard v2**.

Core frontend modules:

```text
src/features/video-conference/components/whiteboard/
src/features/video-conference/hooks/useConferenceWhiteboard.ts
src/features/video-conference/services/conferenceWhiteboard.ts
```

The legacy `src/components/VideoConference/Whiteboard.tsx` and `conference_whiteboard` table are compatibility surfaces and are not the v2 authoritative model.

## 2. Data model

Whiteboard v2 uses three durable tables:

### `conference_whiteboard_boards`

One board row per conference room.

Important fields:

- `room_id`
- `is_locked`
- `revision`
- `updated_by`

### `conference_whiteboard_pages`

Ordered pages belonging to a room.

Important fields:

- `id`
- `room_id`
- `title`
- `position`
- `snapshot_data`
- `revision`
- `created_by`

Each page snapshot is JSON with an `elements` array.

### `conference_whiteboard_snapshots`

Revision history for page snapshots.

A unique constraint prevents duplicate page revision numbers.

## 3. Supported tools/elements

Canonical element types:

- pen
- marker
- line
- arrow
- rectangle
- circle
- text
- sticky note
- image

Non-persisted/control tools also include:

- eraser
- laser pointer
- pan

## 4. Mutation model

Whiteboard mutations go through:

```text
conference-whiteboard-control
  -> authorize_conference_whiteboard_action_v2
  -> apply_conference_whiteboard_action_v2
```

Supported logical operations include:

- upsert element
- delete element
- add page
- delete page
- rename page
- clear page
- lock board
- unlock board

The frontend does not directly write authoritative whiteboard rows.

## 5. Authorization

Two key permissions:

- `USE_WHITEBOARD`
- `MANAGE_WHITEBOARD`

Read access requires a joined conference participant.

Edit access requires `USE_WHITEBOARD`.

When the board is locked, ordinary editors are blocked while users with `MANAGE_WHITEBOARD` retain management capability.

## 6. Snapshot loading

Clients load authoritative state with:

```text
get_conference_whiteboard_snapshot_v2
```

Snapshot output includes:

- room status
- board lock state
- board revision
- `canUse`
- `canManage`
- ordered page snapshots
- server time

Realtime is used to synchronize state changes, but clients can reload the authoritative snapshot after gaps/errors.

## 7. Revision strategy

Board/page revisions provide conflict and ordering context.

Snapshot history is preserved in `conference_whiteboard_snapshots` at server-defined points.

Do not make the browser the only holder of committed whiteboard state.

## 8. Image assets

Private Storage bucket:

```text
conference-whiteboard-assets
```

Allowed MIME types:

- image/jpeg
- image/png
- image/webp
- image/gif

Maximum image size:

```text
5 MiB
```

Object path convention:

```text
<room-id>/<page-id>/<user-id>/<uuid>.<extension>
```

The path is validated against room/page/user context by private database helpers and Storage policies.

## 9. Signed asset access

The frontend requests a signed Storage URL for authorized assets.

Current signed URL lifetime requested by the client:

```text
24 hours
```

The bucket itself remains private.

## 10. Security boundaries

- RLS is enabled on all v2 whiteboard tables.
- Authenticated clients receive SELECT only where joined/authorized.
- Authoritative table mutation is service-role/server controlled.
- Storage read/write/delete policies validate room and permission context.
- Board lock is enforced in server authorization, not only UI state.
- Ended rooms reject new authoritative whiteboard actions.

## 11. Recovery/troubleshooting

If the board looks stale:

1. reload `get_conference_whiteboard_snapshot_v2`
2. compare page and board revisions
3. verify the participant is still joined
4. verify `USE_WHITEBOARD` / `MANAGE_WHITEBOARD`
5. check whether the board is locked
6. for images, verify path structure and signed URL creation
7. avoid direct table fixes unless the server action path has been ruled out
