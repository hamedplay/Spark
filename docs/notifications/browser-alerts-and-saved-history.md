# Browser alerts and Saved Messages history

## Changes

- Saved Messages has a directly visible trash button in the conversation header,
  including narrow mobile layouts. A focused confirmation dialog calls the existing
  `clear_chat_for_user` RPC only after confirmation. It refreshes the current message
  list, stars and sidebar, and clears stale reply/edit selections.
- Personal message queries explicitly honor sender/receiver deletion markers even
  when a monitoring permission allows the account to bypass the normal SELECT policy.
  Saved Messages also reacts to shared invalidation events, since clearing a row can
  make it invisible to the clearing user's Postgres Changes subscription.
- The existing browser notification bridge was dormant (not mounted), limited to
  installed PWAs, and lacked a user permission control. It now runs inside the fully
  authorized application and receives new inserts from the existing notification bell
  lifecycle. Initial snapshots/read updates do not trigger alerts.
- User Settings includes a default-on browser/sound switch, per-device deactivation, a test button,
  denied-permission guidance and iPhone Home Screen guidance. Permission is requested
  directly by the permission button/activation gesture; calendar mount no longer prompts automatically.
  The default-on application preference is separate from OS permission. Existing grants
  register automatically; explicit per-device/account opt-outs remain respected.
- Supported desktop and Android browsers can register Web Push without installing
  the PWA. The existing config function and subscription RPCs are reused. Registration
  errors leave open-page alerts available and expose a retry action.
- ServiceWorker messages and Web Push share one serialized, bounded persistent
  deduplication path keyed by notification ID. One visible window owns a short custom
  chime; when no window is visible the notification requests normal OS sound. This
  avoids duplicate alerts across multiple tabs and the two delivery paths. OS text
  stays generic, matching the existing push worker's privacy behavior.
- Existing service-worker registration checks imported scripts without cache reuse;
  the bounded notification deduplication cache survives worker updates. Notification
  clicks are constrained to this application's origin.

## Validation

- Production build passed. Lint was not run.
- 25 targeted tests passed: bridge permission/registration/logout/preferences,
  saved-vs-regular header rendering, Web Push/Realtime duplicate races, worker
  restart/retry/background/click routing/cache bounds, sound initialization,
  notification lifecycle and swipe regressions.
- `tests/database/savedMessagesHistory.sql` passed on the connected test Supabase:
  clear own saved history, idempotency, deny clearing another user's history,
  preserve other histories and display new messages after clearing. Explicit
  deletion-marker filtering also works with RLS bypassed. All fixtures roll back.
- `tests/database/browserPushSubscriptions.sql` passed there: own subscription
  registration/deactivation and protection of another user's subscription. These
  fixtures also roll back; no real push endpoint or notification was sent.
- Existing test-project push config and worker functions are ACTIVE; dispatch URL
  and worker token are configured (secret values were not read out).
- Full application type checking remains blocked by the repository's existing
  generated-schema/type issues (606 diagnostics at baseline, 605 after this change).
  The same three excessive-instantiation diagnostics remain, with one moving from
  unchanged GroupsPage to unchanged ChatActionsPanel. Build and behavioral tests pass.

## Deployment and platform boundaries

No schema change or migration is needed. Deploy the frontend and public service-worker
files together. Background delivery uses the existing `pwa-push-config`,
`pwa-push-worker`, subscription RPCs and dispatch configuration; the connected test
project is not the production database and physical device delivery was not tested.

Notifications require HTTPS and browser permission. On iOS/iPadOS 16.4+, Web Push
requires a Home Screen web app. Foreground audio is unlocked by the activation click
or a subsequent interaction after reopening; browsers can prohibit autoplay before
interaction. Background sound and display remain subject to OS notification/Focus/
silent-mode settings. A browser cannot force a custom sound while the app is closed.
