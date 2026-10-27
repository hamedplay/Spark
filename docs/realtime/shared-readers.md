# Shared Realtime readers

The following readers now use the common `watchLiveData` / `useLiveData` path:

- Chat conversation list and read/mention counters.
- Call history, including private per-user history hiding on another device.
- Chat sidebar and peer presence, online-users administration, layout profile.
- Runtime maintenance/Spark flags and the Spark visibility control.
- Existing and broadcast forward destinations. Saved Messages initialization is
  separate from invalidation; receiving an event never creates a conversation.
- Contact lists in both meeting forms, without replacing selected people/drafts.
- Per-user visited-address audit panel.
- SFU conference messages/reactions/mentions, participants, roles/permissions,
  phases, speaker timer, recording consent, polls, spotlights, private/moderator
  chats, presentations/annotations, waiting room and whiteboard snapshots.
- Legacy mesh room state, participants, approvals, bans and persisted whiteboard.
- Conference lobby and standalone room lifecycle.

App readers share one private `app-data-changes` subscription. A different
conference client gets its own bus, so its credentials are never replaced with
the shell's client. Reader scope keys rebind on room/user changes; callback refs
always use current filters. Burst coalescing, trailing invalidation, reconnect,
focus/visibility recovery and quiet refresh are provided by the common queue.

Database triggers publish table names only. All actual data still comes from the
existing authorized query/RPC. No RLS policy, media permission or auth gate was
loosened. The new migrations register 31 additional sources, including private
call-history hiding and conference role changes. There are 116 enabled shared
statement triggers in the connected test database after applying them.

Transient WebRTC signaling, typing, whiteboard clear/cursor/laser and LiveKit
media packets keep their existing transports. Local display countdowns and
presence heartbeat writers remain; they are not redundant data subscriptions.
Whiteboard snapshot merging retains unsaved strokes and redo, and deduplicates
late acknowledgements of strokes already observed in the shared snapshot.

Validation:

- Production frontend build passes. No lint was run.
- 17 focused Node tests pass: queue/lifecycle/routing, reader scope/client
  isolation, runtime flag deletion, forward initialization, conference role
  revocation, presence writer lifecycle and whiteboard reconciliation.
- `tests/database/sharedRealtimeReaders.sql` exercises all 31 new statement
  triggers inside a rolled-back transaction and verifies metadata-only payloads.
  It does not modify actual user records or commit broadcast events.
- Security advisor results did not add findings.
- The app-specific TypeScript check still has 600 baseline diagnostics from
  existing schema/type problems; the standard build passes.
- Older phase-based conference test scripts cannot run as-is because they read
  historical migration files removed from main. Those files were not restored.
- No physical-device media session or multi-browser end-to-end run is claimed.

Apply the two new migrations to the target database and deploy the frontend to
activate the new shared subscriptions in the actual web/PWA environment.
