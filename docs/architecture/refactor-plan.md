# Refactor Plan — Spark

## Current architecture summary

Single-page React + TypeScript + Vite app. No React Router — navigation uses `activePage` state, `mpage` URL query param (minutes pages), `/admin` path via `pushState`/`popstate`, and `conference` query param for guest join. Supabase provides auth, database, realtime, storage, and edge functions. State is local React state + context providers; no external state library.

`src/App.tsx` (~135 lines) is a composition shell: wraps providers (PermissionsProvider, GlobalCallProvider) and delegates to `AppShell` for layout, navigation, and page rendering. Auth session, permission loading, meetings fetch + realtime, maintenance mode, spark visibility, and splash are handled by extracted hooks and feature modules.

### Provider tree (main.tsx)
`UserPreferencesProvider → ThemeProvider → GoogleOAuthProvider → App`

App additionally wraps content in `PermissionsProvider` and `GlobalCallProvider`.

## Important behavior invariants

- **Navigation**: `activePage` state drives rendering. Minutes pages sync via `mpage` URL param on popstate and initial load. `/admin` path sets `activePage='admin'` and calls `pushState`. `conference` query param renders `GuestJoinPage` before auth check.
- **Auth**: `supabase.auth.onAuthStateChange` updates `isAuthenticated`, clears state on sign-out, reloads permissions on login/refresh. `checkAuth` runs once on mount.
- **Permissions**: admin → `null` (full access). Non-admin loads via `loadUserPermissions`: legacy user-group → org-level → position overrides. `null`=full, `undefined`=loading, `{}`=none.
- **Meetings realtime**: channel subscribes to `meetings`, `participants`, `actions`, `shared_meetings` → full refetch.
- **Maintenance mode**: `system_config` section `security` key `maintenance_mode` via realtime; blocks non-admins.
- **Spark visibility**: `system_config` section `spark` key `spark_visible` via realtime + custom event.
- **Splash**: shown after login if `splash_enabled` config true and not already shown this session.
- **Landing page**: applied once auth + prefs resolve; `mpage` URL param takes precedence.
- **Permission gate**: while `userPermissions === undefined && !isAdmin`, show spinner. Pages with `PAGE_PERMISSION_KEY` entries are gated.
- **Layout**: full-bleed pages (`calendar`, `chat`, `channels`, `video-conference`, `portal-config`) render without scroll wrapper; others get scroll container.

## High-risk files

- `src/App.tsx` — monolithic shell, all orchestration
- `src/components/Layout.tsx` — navigation, pushState, permission-filtered menu
- `src/context/PermissionsContext.tsx` — permission resolution
- `src/lib/supabase.ts` — client + auth listener + error handling
- `src/context/UserPreferencesContext.tsx` — prefs loading + realtime

## Feature-to-folder migration map

| Feature            | Target folder                  | Current location                          |
|--------------------|--------------------------------|-------------------------------------------|
| auth               | `features/auth/`               | `components/AuthPage.tsx`, App.tsx auth    |
| permissions        | `features/permissions/`        | `context/PermissionsContext.tsx`, App.tsx |
| meetings           | `features/meetings/`           | `components/MeetingCard/`, Dashboard      |
| calendar           | `features/calendar/`          | `components/Calendar/`, `CalendarPage`    |
| tasks              | `features/tasks/`              | `components/TasksPage.tsx`                |
| minutes            | `features/minutes/`            | `components/Minutes/`                      |
| contacts           | `features/contacts/`           | `components/ContactsPage.tsx`             |
| chat               | `features/chat/`               | `components/Chat/`                         |
| channels           | `features/channels/`           | `components/Channels/`                     |
| reports            | `features/reports/`            | `components/ReportsPage.tsx`              |
| video-conference   | `features/video-conference/`   | `components/VideoConference/`             |
| spark-ai           | `features/spark-ai/`           | `components/Spark/`                        |
| administration     | `features/administration/`     | `components/AdminDashboard.tsx`           |

## Phased checklist

### Phase 0 — Baseline and safeguards ✅
- [x] Run baseline lint + build (record pre-existing failures)
- [x] Create `AGENTS.md`
- [x] Create refactor plan
- [x] Inventory routes, page keys, permission keys, Supabase tables, Realtime channels, browser events

### Phase 1 — Decompose App.tsx ✅
- [x] Extract `useMaintenanceMode` hook
- [x] Extract `useSparkVisibility` hook
- [x] Extract `useAuthSession` hook
- [x] Extract `resolveUserPermissions` (database-loading permission loader, not a pure resolver)
- [x] Extract `useMeetingsData` hook (fetch + realtime)
- [x] Extract `useNavigation` + `useAdminPathGuard` (navigation adapter)
- [x] Extract `permissions.ts` (PAGE_PERMISSION_KEY + checkPermission)
- [x] Extract `PageRenderer.tsx` + `pageRendererTypes.ts` (page rendering)
- [x] Extract `AccessDenied.tsx` (permission gate UI)
- [x] Extract `AppShell.tsx` (providers + layout + spark assistant)
- [x] Reduce `App.tsx` to composition shell (135 lines)
- [x] Preserve navigation behavior (activePage, mpage, popstate, /admin, conference)
- [x] No React Router, no DB changes

### Phase 2 — Establish feature boundaries

#### Phase 2A — Auth and Permissions ✅
- [x] Create `features/auth/` boundary (hook, types, index)
- [x] Create `features/permissions/` boundary (service, component, index)
- [x] Rename `resolveUserPermissions` → `loadResolvedUserPermissions`
- [x] Move `AccessDenied` to `features/permissions/components/`
- [x] Move `checkPermission` + `PAGE_PERMISSION_KEY` to `features/permissions/services/`
- [x] Update all active imports to use feature public APIs
- [x] Delete old duplicate files from `src/app/`
- [x] Add logout safeguard to `useMeetingsData` (clears meetings + pending count)
- [x] Build passes, scoped lint clean

#### Phase 2B1 — Meetings feature boundary ✅
- [x] Move `useMeetingsData` hook to `features/meetings/hooks/`
- [x] Extract `MeetingsPage` (meetings list composition) to `features/meetings/pages/`
- [x] Extract `CreateMeetingPage` (create-meeting wrapper) to `features/meetings/pages/`
- [x] Create `features/meetings/types/meetingsPage.ts` with `MeetingsPageProps` + `CreateMeetingPageProps`
- [x] Create `features/meetings/index.ts` public API
- [x] Update `App.tsx` and `PageRenderer.tsx` imports to use feature public API
- [x] Delete old `src/app/hooks/useMeetingsData.ts`
- [x] PageRenderer no longer imports Dashboard, MeetingCard, CreateMeetingForm, PendingMeetingsModal
- [x] Build passes, scoped lint clean
- [x] No feature imports from `src/app`; used local `MeetingsPageId` type instead of importing `PageId`

Deferred to Phase 3:
- Introduce meetings repository and mappers

#### Phase 2B2A — Relocate Meetings dashboard and MeetingCard family ✅
- [x] Move `src/components/CreateMeetingForm.tsx` → `src/features/meetings/components/CreateMeetingForm.tsx` (mechanical copy, unchanged logic)
- [x] Adjust import paths in moved file (`../lib/*` → `../../../lib/*`, `../types` → `../../../types`)
- [x] Update `CreateMeetingPage.tsx` and `MeetingCardMain.tsx` to import feature-local form
- [x] Not exported from `features/meetings/index.ts` (internal component)
- [x] Delete old `src/components/CreateMeetingForm.tsx`
- [x] Build passes (both pre- and post-deletion)
- [x] Scoped lint baseline preserved: 26 errors, 4 warnings (identical before/after)
- [x] No meetings component imports from `src/app`
- [x] No repository or mapper introduced
- Inherited Meetings lint debt (15 errors, 2 warnings in CreateMeetingForm; 11 errors, 2 warnings in MeetingCardMain) deferred to cleanup phase

#### Phase 2B2B — Relocate CreateMeetingForm ✅
- [x] Move `src/components/CreateMeetingForm.tsx` → `src/features/meetings/components/CreateMeetingForm.tsx` (mechanical copy, unchanged logic)
- [x] Adjust import paths in moved file (`../lib/*` → `../../../lib/*`, `../types` → `../../../types`)
- [x] Update `CreateMeetingPage.tsx` and `MeetingCardMain.tsx` to import feature-local form
- [x] Not exported from `features/meetings/index.ts` (internal component)
- [x] Delete old `src/components/CreateMeetingForm.tsx`
- [x] Build passes (both pre- and post-deletion)
- [x] Scoped lint baseline preserved: 26 errors, 4 warnings (identical before/after)
- [x] No meetings component imports from `src/app`
- [x] No repository or mapper introduced
- Inherited Meetings lint debt (15 errors, 2 warnings in CreateMeetingForm; 11 errors, 2 warnings in MeetingCardMain) deferred to cleanup phase

#### Phase 2B2C — MeetingCard split ✅ (complete at 449 lines)
- MeetingCardMain reduced from 635 → 449 lines across phases 2B2C1–2B2C4
- Remaining MeetingCard business operations (deletion, resend, edit, Google Calendar, notifications) deferred to Phase 3

#### Phase 3D3 — Extract the delete-and-revert MeetingCard command ✅
- [x] Created `src/features/meetings/commands/deleteAndRevertMeeting.ts` with `deleteAndRevertMeeting(input)` owning nine responsibilities: source Meeting read, participant snapshot read, action read, replacement Meeting insert, participant copy, action copy, cancellation notifications, old Inbox delete, old Meeting delete — no React, toast, Auth, hooks, repositories, or state
- [x] Preserved source Meeting read: `meetings` select 10 columns, `.maybeSingle()`, error ignored, missing data throws `جلسه یافت نشد`
- [x] Preserved participant and action reads: errors ignored, `null` behaves as empty array, no `.order()`
- [x] Preserved replacement Meeting insert payload exactly: `status: 'open'`, `status_type: 'approved'`, scheduling and recurrence fields null, no `request_jalaali_date` or `request_duration`, `.select('id').single()`, insert error throws
- [x] Preserved participant and action copies: batch inserts, only specified fields, row ordering, insert errors ignored
- [x] Preserved cancellation recipient construction: participants first, observers second, duplicates retained, current user excluded, no dedup
- [x] Preserved profile lookup: error ignored, missing profiles produce empty names, all recipients notified
- [x] Preserved cancellation notification fan-out: one `Promise.all`, participant/observer template selection, cancel action, Persian fallback, placeholder keys, greeting fallback, sender ID, action URL; `insertNotification` returns not inspected
- [x] Preserved deletion order: old Inbox delete (error ignored) → old Meeting delete (error throws)
- [x] Full operation order unchanged: source read → participant read → action read → replacement insert → participant copy → action copy → profile read → notifications → Inbox delete → Meeting delete
- [x] `handleDeleteAndRevert` now: `setLoading(true)` → `getCurrentAuthUserId()` → throw `unauthenticated` if missing → `deleteAndRevertMeeting(...)` → success toast → `onUpdate()` → catch with visible error message → `finally setLoading(false)`
- [x] Auth lookup, loading, toast, modal state, and `onUpdate` remain in `MeetingCardMain`
- [x] Missing Auth still produces visible `unauthenticated` message
- [x] `DeleteMeetingModal.tsx` and modal callback wiring unchanged
- [x] Permanent-delete, normal resend, rejected-edit resend, and Google Calendar code unchanged
- [x] Command not exported from `src/features/meetings/index.ts`
- [x] No explicit `any` introduced in the command
- [x] Scoped lint: command 0 errors/0 warnings; MeetingCardMain 3 errors (down from 4 — the `handleDeleteAndRevert` `any` is removed; remaining 3 are pre-existing)
- [x] 12 characterization tests pass
- [x] Build passes
- [x] No public Meetings export changed
- [x] Legacy risks recorded:
  - Delete-and-revert is not transactional.
  - Participant/action copy errors are ignored.
  - Profile and old-Inbox deletion errors are ignored.
  - A failure after replacement creation can leave both the old and replacement Meetings present.
  - A thrown notification failure can leave the replacement Meeting created while the old Meeting remains.

#### Phase 3D2 — Extract the permanent-delete MeetingCard command ✅
- [x] Created `src/features/meetings/commands/deleteMeetingPermanently.ts` with `deleteMeetingPermanently(input)` owning: cancellation-recipient construction, profile-name lookup, cancellation-notification fan-out, meeting Inbox deletion, Meeting deletion — no React, toast, Auth, hooks, repositories, or state
- [x] Preserved recipient construction: participant IDs first, observer IDs second, existing ordering, duplicate IDs retained, no dedup, sender exclusion, all recipients retained when `senderId` is `null`
- [x] Preserved profile lookup: `profiles` select `user_id, full_name` `in('user_id', recipientIds)`, error ignored, missing profiles produce empty names, recipients without profiles still notified
- [x] Preserved cancellation notification fan-out: one `Promise.all` over `recipientIds`, participant/observer template selection, cancel action, Persian fallback title/message, placeholder keys, greeting fallback, nullable sender ID, action URL; `insertNotification` return values not inspected; failed results do not abort deletion; thrown errors reject `Promise.all`
- [x] Preserved deletion order: notifications → `meeting_inbox` delete (awaited, error ignored) → `meetings` delete (error throws)
- [x] `handlePermanentDelete` now: `setLoading(true)` → `getCurrentAuthUserId()` → `deleteMeetingPermanently(...)` → success toast → `onUpdate()` → catch error toast → `finally setLoading(false)`
- [x] No early return on missing Auth user — permanent deletion continues with `senderId: null`; all participants/observers remain in notification list
- [x] Auth lookup, loading, toast, modal state, and `onUpdate` remain in `MeetingCardMain`
- [x] `DeleteMeetingModal.tsx` and modal callback wiring unchanged
- [x] Resend, delete-and-revert, rejected-edit resend, and Google Calendar code unchanged
- [x] Command not exported from `src/features/meetings/index.ts`
- [x] No explicit `any` introduced in the command
- [x] Scoped lint: command 0 errors/0 warnings; MeetingCardMain 4 errors (unchanged from 3D1 baseline)
- [x] 12 characterization tests pass
- [x] Build passes
- [x] No public Meetings export changed

#### Phase 3D1 — Inventory and extract the resend-invitations MeetingCard command ✅
- [x] Recorded MeetingCard command inventory:
  - `handleResend` — Auth lookup, resend RPC, Inbox query, profile query, notification fan-out
  - `handlePermanentDelete` — Auth lookup, cancellation notification fan-out, Inbox deletion, meeting deletion
  - `handleDeleteAndRevert` — Auth lookup, meeting/participant/action reads, unscheduled meeting creation, participant/action copies, cancellation notifications, old Inbox and meeting deletion
  - rejected edit-success branch — Auth lookup, resend RPC, participant read, profile read, notification fan-out
  - `handleAddToGoogleCalendar` — browser URL construction and window opening
- [x] Created `src/features/meetings/commands/resendMeetingInvitations.ts` with `resendMeetingInvitations(input)` owning: resend RPC, pending Inbox query, profile query, notification fan-out — no React, toast, Auth, hooks, repositories, or state
- [x] Preserved RPC exactly: `resend_meeting_invitations` with `p_meeting_id`, error-throwing, no retry/logging/fallback
- [x] Preserved Inbox query exactly: `meeting_inbox` select `user_id` where `status='pending'`, error ignored, `pendingRows ?? []`, row ordering preserved, no dedup, no creator exclusion
- [x] Preserved profile query exactly: `profiles` select `user_id, full_name` `in('user_id', notifyIds)`, error ignored, missing profiles produce empty names, ordering preserved
- [x] Preserved notification fan-out: one `Promise.all` over `notifyIds`, same template key, category, audience, Persian fallback text, placeholder keys, greeting fallback, sender ID, action URL; `insertNotification` return values not inspected
- [x] `handleResend` now: `setLoading(true)` → `getCurrentAuthUserId()` → silent return if no user → `resendMeetingInvitations(...)` → success toast → `onUpdate()` → catch error toast → `finally setLoading(false)`
- [x] Auth lookup, loading, toast, and `onUpdate` remain in `MeetingCardMain`
- [x] `MeetingCardHeader` callback wiring unchanged
- [x] Permanent-delete, delete-and-revert, rejected-edit resend, and Google Calendar code unchanged
- [x] Command not exported from `src/features/meetings/index.ts`
- [x] No explicit `any` introduced in the command
- [x] Scoped lint: command 0 errors/0 warnings; MeetingCardMain 4 errors (down from 5 — the `handleResend` `any` is removed; remaining 4 are pre-existing in other handlers)
- [x] 12 characterization tests pass
- [x] Build passes
- [x] No public Meetings export changed

#### Phase 3C2 — Move CreateMeetingForm Auth operations behind the Auth feature boundary ✅
- [x] Created `src/features/auth/services/authOperations.ts` with three stateless, imperative operations: `getCurrentAuthUserId`, `signUpWithPassword`, `signInWithPassword` — no React, no hook, no class, no context, no repository, no error-message mapping, no second Supabase client
- [x] Defined `PasswordAuthCredentials` and `SignUpWithPasswordInput` interfaces; exported only user-id-or-null results — no Supabase response objects or user objects exposed
- [x] `getCurrentAuthUserId` preserves the existing ignore-error/treat-absent-user-as-unauthenticated behavior; no `getSession`, no subscription, no sign-out
- [x] `signUpWithPassword` and `signInWithPassword` re-throw Supabase errors so the form still performs message mapping; no Session/profile queries added
- [x] Exported the three operations and two interfaces through `src/features/auth/index.ts`; existing `useAuthSession` and `AuthSessionState` exports preserved; Supabase client not exported
- [x] `CreateMeetingForm.tsx` now imports Auth operations only from `../../auth`; the direct `import { supabase } from '../../../lib/supabase'` is removed
- [x] Initial user lookup uses `getCurrentAuthUserId()`; contact loading still runs only after a user ID exists, sets both arrays, identical console message, no toast, `[]` dependency
- [x] Sign-up handler uses `signUpWithPassword` with `window.location.origin` redirect; preserves `e.preventDefault()`, loading, `finally`, `getErrorMessage`, `User already registered` comparison, both Persian messages, success toast
- [x] Login handler uses `signInWithPassword`; preserves loading, `finally`, `getErrorMessage`, `Invalid login credentials` comparison, both Persian messages, success toast
- [x] Form-local Auth state (`showAuthError`, `isSignUp`, `authForm`, `loading`, `userId`), toast messages, fallback rendering, and meeting-submission auth guard remain in the form
- [x] `useAuthSession.ts` unchanged — not imported or invoked by the form
- [x] `MeetingFormAuthFallback.tsx` unchanged
- [x] No Auth listener added; no explicit `any` introduced; no public Meetings export changed
- [x] Scoped lint: 0 errors, 0 warnings (form, Auth service, Auth index, Auth hook)
- [x] 12 characterization tests pass
- [x] Build passes
- [x] Direct Supabase access in `CreateMeetingForm`: before 3 operations + 1 import; after 0
- [x] **CreateMeetingForm architecture pass complete** (3B1–3C2)

#### Phase 3C1 — Remove CreateMeetingForm lint debt ✅
- [x] Baseline: 7 problems (5 errors, 2 warnings)
- [x] Removed obsolete no-op `fetchSystemUsers` (2 errors: `@typescript-eslint/no-unused-vars` for `fetchSystemUsers` and `_currentUserId`)
- [x] Converted three catch annotations from `any` to `unknown` (3 errors: `@typescript-eslint/no-explicit-any` at lines 259, 269, 374) using a single local `getErrorMessage(error: unknown)` helper — no casts, no `String(error)`
- [x] Removed local `fetchContacts` helper and inlined its repository call and error handling into the initial Auth effect `getUser` — preserves execution-after-auth, both state arrays, identical console message, no toast, no loading-state change, `[]` dependency
- [x] Removed component-level `resolveUserName` and `resolveUsersByIds`; added `allUsersRef` synced via a dedicated effect, and `resolvePrefillUsersByIds` defined inside the Prefill effect — fixes `react-hooks/exhaustive-deps` warning for `resolveUsersByIds` without adding `allUsers` to the Prefill dependency array (stays `[prefillData]`)
- [x] Added `requestDateInitializedRef` one-shot guard to the default request-date effect — fixes `react-hooks/exhaustive-deps` warning for `requestJalaaliDate` while preserving one-time initialization, no auto-fill after manual clear, same Jalali format, same effect order relative to Prefill
- [x] No `useCallback`, no ESLint disable comments, no `@ts-ignore`, no explicit `any`
- [x] Scoped lint: 0 errors, 0 warnings
- [x] 12 characterization tests pass
- [x] Build passes
- [x] No production file other than the form changed; no dependency or new file added
- [x] No public Meetings export changed

#### Phase 3B4 — Primary meeting-record characterization tests ✅
- [x] Create `tests/meetings/buildMeetingPersistenceRecord.test.ts` outside `src` — production `tsconfig.app.json` unchanged
- [x] Use Node's built-in `node:test` + `node:assert/strict`; `tsx` only as the TypeScript runtime — no new dependencies
- [x] Tests import only the builder and Node built-ins — no React, Supabase, repositories, form components, Moment, toast, or browser APIs
- [x] One input fixture (`createInput`) with representative defaults; overrides via `Partial<BuildMeetingPersistenceRecordInput>`
- [x] Exactly six characterization tests:
  1. `builds the legacy manual-request record` — full `assert.deepEqual`, `status: 'open'`, nullable repeat/reminder/manager/calendar fields, `start_time`/`end_time` absent
  2. `builds a closed calendar-scheduled record with a time-range duration` — `status: 'closed'`, `duration: '09:00 - 10:30'`, times present, unrelated fields preserved
  3. `preserves optional times without changing manual duration or status` — non-calendar with times keeps `status: 'open'`, `duration: requestDuration`, times present
  4. `falls back to request duration when the calendar time pair is incomplete` — `status: 'closed'`, `duration: requestDuration`, times absent (legacy mixed behavior)
  5. `deduplicates notification users in legacy insertion order without mutating input` — `['notify-2','owner-1','notify-2','notify-3']` → `['owner-1','notify-2','notify-3']`; full `JSON.stringify` input immutability; participant/external arrays preserved
  6. `maps enabled weekly and monthly repeat fields with legacy nullability` — weekly keeps `repeat_weekday: 4`; monthly sets `repeat_weekday: null`; notes/reminder/manager/calendar mapped; `send_sms: false`
- [x] Assertions use only `assert.equal`, `assert.deepEqual`, `assert.ok` — no snapshots, no algorithm duplication, no casts, no `@ts-ignore`, no explicit `any`
- [x] Strengthened existing recurrence Weekly test: capture `JSON.stringify(input.baseRecord)` before the builder and assert equality after — verifies full serializable base record, not just `status`/`id`
- [x] Existing narrower recurrence assertions retained; recurrence fixtures, dates, expected records, names, and behavior unchanged
- [x] Package scripts: `test:meeting-record` added; `test` alias updated to `npm run test:recurrence && npm run test:meeting-record`; `test:recurrence` preserved; no watch/coverage/CI/wildcard/parallel scripts
- [x] No dependency installed or updated; `package-lock.json` unchanged
- [x] Production files unchanged: `buildMeetingPersistenceRecord.ts`, `buildRecurringMeetingRecords.ts`, `meetingPersistence.ts`, `CreateMeetingForm.tsx`, repositories, `vite.config.ts`, `tsconfig.*`, `eslint.config.js`
- [x] No public Meetings export changed
- [x] Test result: 6 recurrence + 6 meeting-record = 12 tests, 12 pass, 0 fail
- [x] `npm test` passes
- [x] Build passes
- [x] Both test files, both builders, and persistence type lint-clean (zero errors and warnings)
- [x] No explicit `any`; no Supabase/repository import in tests; no snapshots

#### Phase 3B3 — Recurring-meeting characterization-test harness ✅
- [x] Install `tsx@4.23.1` as the only new development dependency (exact version, `--save-dev --save-exact`)
- [x] Add scripts `test` (alias) and `test:recurrence` to `package.json`; preserve all existing scripts exactly
- [x] Create `tests/meetings/buildRecurringMeetingRecords.test.ts` outside `src` — production `tsconfig.app.json` unchanged
- [x] Use Node's built-in `node:test` + `node:assert/strict`; `tsx` only as the TypeScript runtime — no Vitest/Jest/Mocha/Chai/Testing Library/jsdom/happy-dom/snapshot/coverage libraries, no `@types/node`, no separate test tsconfig
- [x] Tests import only the builder, `moment-jalaali`, and Node built-ins — no React, Supabase, repositories, form components, toast, or browser APIs
- [x] Timezone-safe strategy: local-Date constructors (`localDate`, `localMidnight`, `localEndOfDay`); no `TZ` mutation, no hardcoded UTC timestamps for locally constructed dates
- [x] One base fixture (`createBaseRecord`) with source `id`, `status: 'closed'`, `start_time: '09:00'`, `end_time: '10:00'`, and representative arrays
- [x] One input fixture (`createInput`) with defaults `repeatType: 'weekly'`, `repeatInterval: 1`, `repeatWeekday: 0`, `repeatMonthlyMode: 'specific'`, `repeatMonthlyWeekday: 0`
- [x] Exactly six characterization tests:
  1. `returns no records for an invalid end date` — asserts exact empty array
  2. `generates weekly Saturday records in legacy order` — Jan 3/10/17 2026; asserts ordered `request_date`, `status: 'open'`, `id` omitted, fields preserved, `request_jalaali_date` matches `moment(...).format('jYYYY/jMM/jDD')`, and base record immutability
  3. `preserves JavaScript Date rollover for monthly specific dates` — Jan 31 base → Mar 3, Mar 31 (legacy JS rollover, not corrected to Feb 28/Apr 30)
  4. `generates the first Saturday of each following month` — Feb 7, Mar 7, Apr 4 2026
  5. `generates the last Saturday of each following month` — Feb 28, Mar 28, Apr 25 2026
  6. `uses the Jalali repeat end date through its local end of day` — Jalali base `1404/01/01`, end `1404/01/15`, two expected Saturdays (base+1, base+8) computed relative to base, no hardcoded Gregorian dates
- [x] Assertions use only `assert.equal`, `assert.deepEqual`, `assert.ok` — no snapshots, no mocking of Date/Moment, no algorithm duplication beyond expected calendar dates
- [x] Monthly specific-day rollover explicitly characterized as legacy behavior, not corrected behavior
- [x] Production files unchanged: `buildRecurringMeetingRecords.ts`, `CreateMeetingForm.tsx`, `meetingPersistence.ts`, `meetingPersistenceRepository.ts`, `vite.config.ts`, `tsconfig.*`, `eslint.config.js`
- [x] No public Meetings export changed
- [x] Test result: 6 tests, 6 pass, 0 fail
- [x] `npm test` passes
- [x] Build passes
- [x] Test file, recurrence builder, and persistence type lint-clean (zero errors and warnings)
- [x] No explicit `any` in the test; no Supabase/repository import in the test; no snapshot; no timezone environment mutation
- [x] Only `tsx` added; `package-lock.json` updated; no existing dependency upgraded

#### Phase 3B2 — Extract the recurring-meeting record generator ✅
- [x] Create `src/features/meetings/builders/buildRecurringMeetingRecords.ts` — pure function, no React/Supabase/repositories/toast/console/Auth/audit/browser storage/UI/state setters
- [x] Export `buildRecurringMeetingRecords(input): MeetingPersistenceRecord[]`, `MeetingRepeatMonthlyMode`, `RecurringMeetingBaseRecord`, `BuildRecurringMeetingRecordsInput`
- [x] Move end-date parsing, Jalali end-date conversion, end-of-day adjustment, invalid-end-date early return, base-date construction, optional `id` stripping, weekly `jsDayMap`, weekly first-occurrence calculation, weekly loop, monthly specific-day loop, monthly first-weekday loop, monthly last-weekday loop, Jalali output formatting, repeated-record construction, and `status: 'open'` override into the builder
- [x] Weekly algorithm preserved exactly: `jsDayMap`, `targetJsDay`, `+1` day, `diff` modulo, millisecond advance (`7 * interval * 86400000`)
- [x] Monthly specific-day algorithm preserved exactly: `new Date(y, mo, day)`, no day clamping, JS rollover behavior, month normalization order
- [x] Monthly first/last weekday algorithm preserved exactly: day-1 start for first, day-0-of-next-month start for last, forward/backward movement, `targetDate > baseDate` guard, `targetDate > endMs` termination
- [x] Invalid-end-date behavior returns `[]` unchanged
- [x] Optional `id` omitted from generated records via typed destructure
- [x] All generated records override `status` to `'open'`
- [x] Keep async wrapper `createRepeatMeetings` in the form — `void _originalId` preserved
- [x] Keep `insertRecurringMeetingBatch` call, `console.error('Repeat insert error:', ...)`, Persian error toast, Persian success toast, and workflow continuation in the form
- [x] Keep `repeatEnabled`/`meetingData`/`repeatEndDate` guards and ordering relative to participant and Agenda persistence unchanged
- [x] Remove local `RepeatBaseRecord` type alias; import `RecurringMeetingBaseRecord` from the builder
- [x] Remove unused `MeetingPersistenceRecord` import from the form
- [x] Recurrence loops and date-generation logic now exist only in the builder
- [x] No `repeatMeetings.push` remains in the form
- [x] Not exported through the public Meetings `index.ts`
- [x] No service, repository, hook, class, mapper, schema library, context, reducer, dependency-injection layer, or generic abstraction created
- [x] Parent meetings-table operations: 0 (unchanged)
- [x] Repository meetings-table operations: 3 (primary update + primary create + recurring batch insert) — unchanged
- [x] Scoped parent lint: 7 problems (5 errors, 2 warnings) — no increase
- [x] New builder lint: zero errors and warnings
- [x] Repository and types lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No API, database schema, UI, Auth, Agenda, participant, contact, audit, toast, reset, or submission behavior changes
- [x] No new dependency or generic abstraction added

Legacy risks:
Recurring meetings do not receive participant snapshots.
Recurring meetings do not receive separate Agenda rows.
Recurring insert failure does not abort the main workflow.

#### Phase 3B1 — Type and extract the primary meeting persistence-record builder ✅
- [x] Create `src/features/meetings/types/meetingPersistence.ts` with `MeetingPersistenceStatus`, `MeetingPersistenceRepeatType`, and `MeetingPersistenceRecord` (status and repeat_type now string-literal unions instead of `string`)
- [x] Move `MeetingPersistenceRecord` out of `meetingPersistenceRepository.ts` into the new types file; repository imports the type, does not re-export it
- [x] Create `src/features/meetings/builders/buildMeetingPersistenceRecord.ts` — pure function, no React/Supabase/Moment/toast/audit/browser APIs/logging, no mutation of input
- [x] Replace the inline primary record object in `CreateMeetingForm` with `buildMeetingPersistenceRecord(...)` — `meetingRecord` now inferred as `MeetingPersistenceRecord`
- [x] Type `createRepeatMeetings` with `RepeatBaseRecord = MeetingPersistenceRecord & { id?: string }` and `repeatMeetings: MeetingPersistenceRecord[]` — function stays in the form
- [x] Strip optional `id` via typed destructure (`id: ignoredRecordId` + `void ignoredRecordId`) — no lint error
- [x] Remove the three targeted `any` usages: `meetingRecord: any`, `baseRecord: any`, `repeatMeetings: any[]`
- [x] Unrelated Auth/error `any` usages left unchanged
- [x] Validation, Gregorian/Jalali conversion, recurrence algorithms, loops, date calculations, status overrides, request dates, Jalali formatting, and insertion timing all remain in the form
- [x] All repository calls and Supabase queries unchanged
- [x] Participant and Agenda persistence unchanged
- [x] Outer `handleSubmit` try/catch, audit, reset, and `onSuccess` unchanged
- [x] Not exported through the public Meetings `index.ts`
- [x] No service, repository, hook, class, mapper, schema library, context, reducer, dependency-injection layer, or generic form model created
- [x] Parent meetings-table operations: 0 (unchanged)
- [x] Repository meetings-table operations: 3 (primary update + primary create + recurring batch insert) — unchanged
- [x] Scoped parent lint: 7 problems (5 errors, 2 warnings) — improved from 11 (removed 4 targeted `any` usages)
- [x] New-file lint: zero errors and warnings
- [x] Repository lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No API, database schema, UI, Auth, Agenda, participant, contact, audit, toast, reset, or submission behavior changes
- [x] No new dependency or generic abstraction added

Legacy risks:
Recurring meetings do not receive participant snapshots.
Recurring meetings do not receive separate Agenda rows.
Recurring insert failure does not abort the main workflow.

#### Phase 3A4C — Extract recurring-meeting batch persistence ✅
- [x] Add `insertRecurringMeetingBatch(records)` to existing `meetingPersistenceRepository.ts` — no new repository file created
- [x] Preserve exact query `.from('meetings').insert(records)` — no `.select()`, `.single()`, `.upsert()`, RPC, transaction, chunking, retry, logging, toast, empty-array handling, or record transformation
- [x] Repository returns `{ message: string } | null` instead of throwing — preserves existing local error handling, toast, and workflow continuation
- [x] Primary create and update still throw on errors — return-error policy not applied to them
- [x] Repository contains no Moment, toast, or console imports
- [x] Not exported from the public Meetings `index.ts`
- [x] Replace inline recurring insert with `insertRecurringMeetingBatch(repeatMeetings)` — parent branch unchanged
- [x] Persian error/success toasts and `console.error('Repeat insert error:', ...)` message unchanged
- [x] `createRepeatMeetings`, `_originalId`, `baseRecord`, end-date parsing, Jalali-to-Gregorian conversion, weekly/monthly recurrence algorithms, `jsDayMap`, date loops, `repeatMeetings` array construction, `status: 'open'`, `request_date`, `request_jalaali_date`, and non-empty-array guard all remain in the form
- [x] Recurring insert remains after primary meeting creation, gated on `meetingData` and `repeatEndDate`, and ordered relative to participant and Agenda persistence
- [x] Outer `handleSubmit` try/catch, audit, reset, and `onSuccess` unchanged
- [x] Participant and Agenda persistence unchanged
- [x] Parent meetings-table operations: 1 before (recurring insert), 0 after
- [x] Repository meetings-table operations: 3 (primary update + primary create + recurring batch insert)
- [x] All direct `meetings` table access has left the form
- [x] Scoped parent lint: 11 problems (9 errors, 2 warnings) — no increase
- [x] Repository lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No API, database schema, UI, Auth, Agenda, participant, audit, reset, or submission behavior changes
- [x] No new file, generic abstraction, or dependency added

Legacy risks:
Recurring meetings do not receive participant snapshots.
Recurring meetings do not receive separate Agenda rows.
Recurring insert failure does not abort the main workflow.

#### Phase 3A4B — Extract meeting participant-snapshot persistence ✅
- [x] Create `src/features/meetings/repositories/meetingParticipantsRepository.ts` (Supabase access only)
- [x] Define `MeetingParticipantSnapshotInput` with only `name` — no userId, role, email, or status
- [x] Export only `insertMeetingParticipantSnapshots(meetingId, participants)` returning `void`
- [x] Preserve exact insert: `.from('participants').insert(participants.map(p => ({ meeting_id: meetingId, name: p.name })))` — one batch insert, no `.select()`, no `.single()`, no additional metadata
- [x] Preserve legacy silent-error behavior: repository does not inspect or throw Supabase error, no toast, no console logging, no retry — concise code comment documents intentional preservation until behavior tests exist
- [x] Repository imports only the existing Supabase client — no React, toast, audit, Auth, UI components, Meetings hooks, `src/app`, state setters, form props, or another repository
- [x] Not exported from the public Meetings `index.ts`
- [x] Replace inline participants insert with `insertMeetingParticipantSnapshots(meetingData.id, selectedParticipants)` — parent guard `selectedParticipants.length > 0 && meetingData` unchanged
- [x] Participant-name mapping and participant selection remain in the form
- [x] Participant snapshots remain create-only — no participant operation added to update branch or recurring-meeting creation
- [x] Participant insert remains before recurrence and Agenda handling
- [x] Primary meeting create/update still use `meetingPersistenceRepository`
- [x] Agenda still uses `meetingAgendaRepository`
- [x] Audit, toast, `handleSubmit`, try/catch/finally, loading state, `resetForm`, `onSuccess` all unchanged
- [x] Parent participants-table operations: 1 before, 0 after
- [x] Repository participants-table operations: 1 (the single batch insert)
- [x] Scoped parent lint: 11 problems (9 errors, 2 warnings) — no increase
- [x] Repository lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No API, database schema, Auth, Agenda, recurrence, payload, audit, toast, or submission behavior changes
- [x] No generic abstraction or dependency added

Legacy risks:
Participant snapshot insert errors are currently ignored.

Participant snapshots are created only for the primary new meeting and are not synchronized during meeting updates.

Recurring meetings do not currently receive participant snapshot rows through this flow.

#### Phase 3A4A — Extract primary meeting persistence repository ✅
- [x] Create `src/features/meetings/repositories/meetingPersistenceRepository.ts` (Supabase access only)
- [x] Define internal write contract `MeetingPersistenceRecord` matching current `meetingRecord` payload exactly — no added or removed fields
- [x] Export exactly two functions: `updatePrimaryMeeting(meetingId, record)` and `createPrimaryMeeting(record)`
- [x] Update preserves `.from('meetings').update(record).eq('id', meetingId)` — no `.select()`, `.single()`, extra filter, logging, toast, or retry; throws Supabase error
- [x] Create preserves `.from('meetings').insert([record]).select().single()` — `.select()` not narrowed to `.select('id')`; throws Supabase error; returns `{ id: data.id }` or `null` when no data
- [x] Repository imports only the existing Supabase client — no React, toast, audit, moment, Auth, UI components, Meetings hooks, `src/app`, another repository, state setters, or form props
- [x] Not exported from the public Meetings `index.ts`
- [x] Replace inline update with `updatePrimaryMeeting(prefillMeetingId, meetingRecord)` — `prefillMeetingId` decision, Agenda replacement, `logAudit`, and success toast remain in the form
- [x] Replace inline primary insert with `createPrimaryMeeting(meetingRecord)` — participant insertion, recurrence decision/generation, Agenda insertion, audit, and success toast remain in the form
- [x] All existing `meetingData` / `meetingData.id` / `meetingData?.id` guards preserved unchanged
- [x] `meetingRecord` construction remains in the form — date conversion, duration, status, notification-user dedup, participant ID mapping, external participants, recurrence fields, reminder, manager, calendar ID, optional start/end all unchanged
- [x] Recurring-meetings insert remains in the form
- [x] Participants table insert remains in the form
- [x] Agenda operations still use the Agenda repository
- [x] Prefill repository calls unchanged
- [x] `handleSubmit`, try/catch/finally, loading state, `resetForm`, `onSuccess` all unchanged
- [x] Parent meetings-table operations: 3 before (update, primary insert, recurring insert), 1 after (recurring insert only)
- [x] Repository meetings-table operations: 2 (update + primary create)
- [x] Scoped parent lint: 11 problems (9 errors, 2 warnings) — no increase
- [x] Repository lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No database schema, Auth, payload, UI or submission behavior changes
- [x] No generic abstraction or dependency added

#### Phase 3A3 — Extract meeting people-prefill repository ✅
- [x] Create `src/features/meetings/repositories/meetingPrefillRepository.ts` (Supabase access only)
- [x] Export only `fetchMeetingPeoplePrefill(meetingId)` returning `MeetingPeoplePrefill | null`
- [x] Preserve exact query chain: `.from('meetings').select('participant_user_ids, notify_users, external_participants').eq('id', meetingId).maybeSingle()`
- [x] Throw Supabase error when present; map DB fields explicitly (`participant_user_ids`, `notify_users`, `external_participants`), no fallback empty arrays
- [x] Repository imports only the existing Supabase client — no React, toast, UI, Auth hooks, `useOrgUsers`, Meetings hooks, `src/app`, state setters, or other repositories
- [x] Not exported from the public Meetings `index.ts`
- [x] Replace inline prefill query with `fetchMeetingPeoplePrefill(prefillData.meetingId)` — parent still guards `prefillData.meetingId && (!prefillData.participantUserIds || prefillData.participantUserIds.length === 0)`
- [x] All three state-update guards remain in parent: `participantUserIds`, `notifyUserIds`, `externalParticipants` — each uses `resolveUsersByIds` which stays in the form
- [x] Preserve legacy silent-error behavior: repository throws, parent catches with `try { ... } catch { return; }` — no toast, console logging, retry, loading state, or fallback reset
- [x] Prefill effect structure and dependency list unchanged — no `allUsers`, `resolveUsersByIds`, participant arrays, or repository functions added to deps
- [x] Parent exact prefill-select match count: 1 before, 0 after
- [x] Repository prefill-select match count: 1 (the single fetch query)
- [x] Meetings-table operations: 4 before (prefill select, update, insert, repeat insert), 4 after (3 parent + 1 repository)
- [x] Scoped parent lint: 11 problems (9 errors, 2 warnings) — no increase
- [x] Repository lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No database schema, Auth, Agenda, contacts, recurrence, meeting payload or submission behavior changes
- [x] ID-to-display-name resolution remained in the form

Legacy risk: Prefill user-name resolution depends on the timing of organization-user loading and currently remains untested.

#### Phase 3A2 — Extract meeting Agenda repository ✅
- [x] Create `src/features/meetings/repositories/meetingAgendaRepository.ts` (Supabase access only)
- [x] Export only `fetchMeetingAgendaItems`, `insertMeetingAgendaItems`, `replaceMeetingAgendaItems`
- [x] Use `MeetingAgendaInput = Pick<AgendaItem, 'title' | 'presenter' | 'duration_minutes' | 'sort_order'>`
- [x] Preserve exact query chains:
  - `fetchMeetingAgendaItems`: `.from('meeting_agenda_items').select('*').eq('meeting_id', meetingId).order('sort_order')`, throw on error, returns only `{title, presenter, duration_minutes, sort_order}` (preserves nullable presenter/duration)
  - `insertMeetingAgendaItems`: `.insert(items.map((item, index) => ({ ...item, meeting_id: meetingId, sort_order: index })))`, throw on error, no `.select()`/`.single()`, returns early when `items.length === 0`
  - `replaceMeetingAgendaItems`: sequential delete `.delete().eq('meeting_id', meetingId)` (throw immediately on failure), then calls `insertMeetingAgendaItems` when items exist — no transaction or RPC
- [x] Repository imports only the existing Supabase client and `AgendaItem` type — no React, toast, Auth, UI components, Meetings hooks, `src/app`, state setters, or other repositories
- [x] Errors are thrown, not caught/hidden in the repository
- [x] Not exported from the public Meetings `index.ts`
- [x] Replace prefill Agenda query with `fetchMeetingAgendaItems(prefillData.meetingId!)` — parent still guards `items.length > 0` to set `agendaEnabled`/`agendaItems`; empty result does not enable Agenda
- [x] Replace existing-meeting update with `replaceMeetingAgendaItems(prefillMeetingId, agendaItems)` — `agendaEnabled` guard stays in parent (enabled+empty → delete only; disabled → no-op; enabled+items → delete+insert)
- [x] Replace new-meeting Agenda insert with `insertMeetingAgendaItems(meetingData.id, agendaItems)` — `agendaEnabled && agendaItems.length > 0 && meetingData` guard stays in parent
- [x] Removed the old Agenda row-mapping `any` (the repository now returns the required shape)
- [x] Parent `meeting_agenda_items` match count: 4 before, 0 after
- [x] Repository `meeting_agenda_items` match count: 3 (one fetch, one insert, one delete)
- [x] Combined Supabase/query/RPC count: 13 before, 12 after (9 parent + 3 repository) — decrease of 1 reflects removal of the inline prefill query's `supabase` reference
- [x] Scoped parent lint: 12 problems (10 errors, 2 warnings) before → 11 problems (9 errors, 2 warnings) after — decrease of 1 reflects removal of the Agenda row-mapping `any`
- [x] Repository lint: zero errors and warnings
- [x] No new explicit `any` introduced
- [x] Agenda UI (`AgendaEditor.tsx`) not modified
- [x] No public Meetings export changed
- [x] No database schema, RPC, Auth, recurrence, contacts, meeting payload or submission behavior changes
- [x] Agenda state, enablement guards, and orchestration remain in the form

#### Phase 3A1 — Extract Meetings contact data-access repository ✅
- [x] Create `src/features/meetings/repositories/meetingContactsRepository.ts` (Supabase access only)
- [x] Export only `fetchMeetingContacts`, `createExternalMeetingContact`, `saveRepresentativeMeetingContact`
- [x] Use explicit `MeetingContactInput` interface (userId, name, email, phone)
- [x] Preserve exact query chains:
  - `fetchMeetingContacts`: `.from('contacts_email').select('*').eq('user_id', userId).order('name')`, throw on error, return `data ?? []`
  - `createExternalMeetingContact`: `.insert([...]).select().single()`, throw on error, return inserted contact
  - `saveRepresentativeMeetingContact`: non-returning `.insert([...])` (no `.select()`/`.single()`), throw on error
- [x] Repository imports only the existing Supabase client and `ContactEmail` type — no React, toast, Auth hooks, UI components, `src/app`, state setters, meeting form types, or other-feature repositories
- [x] Errors are thrown, not caught/hidden in the repository
- [x] Not exported from the public Meetings `index.ts`
- [x] Replace contact loading in `CreateMeetingForm` with `fetchMeetingContacts(uid)` — parent still calls after authenticated user resolution, sets both `contacts` and `allContacts`, catches errors, logs same message, no toast
- [x] Replace quick external-contact creation with `createExternalMeetingContact(...)` — `addQuickExternal` remains in parent preserving name/user guard, local `contacts` update, `selectedExternal` update, draft-field reset, add-form closing, success/failure toasts
- [x] Replace representative-contact save with `saveRepresentativeMeetingContact(...)` — condition `saveContact && !repFromContacts && representative.trim() && userId` remains in parent
- [x] Parent `contacts_email` match count: 3 before, 0 after
- [x] Repository `contacts_email` match count: 3 (the three expected operations)
- [x] Combined Supabase/query/RPC count: 16 before, 16 after (13 parent + 3 repository)
- [x] Scoped parent lint unchanged: 12 problems (10 errors, 2 warnings) — no increase
- [x] Repository lint: zero errors and warnings
- [x] No explicit `any` introduced
- [x] No UI component modified
- [x] No public Meetings export changed
- [x] No database schema, Auth, payload, Agenda, recurrence, or submission change
- [x] State ownership, guards, toasts, and orchestration remain in the form

#### Phase 2B2D10 — Complete remaining presentational extraction ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingMetadataFields.tsx` (presentational)
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingManagerField.tsx` (presentational)
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingReminderField.tsx` (presentational)
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingFormActions.tsx` (presentational)
- [x] Move priority, status type, and notes presentation into `MeetingMetadataFields` with controlled props contract
- [x] Move meeting-manager conditional and selector into `MeetingManagerField` — imports only `MultiSelectValue` type from sibling; preserves visibility-when-participants, participant-derived options, “بدون مدیر”, selected value, help text, `UserCheck` icon, and removal behavior (no automatic reset/validation added)
- [x] Move reminder selector into `MeetingReminderField` — preserves all reminder values, numeric conversion, labels, `Bell` icon, and position between recurrence and Agenda
- [x] Move save-contact checkbox, submit button, loading indicator, and create/update/scheduling button text into `MeetingFormActions` — submit button remains `type="submit"`; `handleSubmit` stays in the parent; checkbox visibility computed in parent and passed via `showSaveContact`; three-way button label preserved via `submitLabel: string` prop; cancel/back control remains in parent as `children`
- [x] Visible field order preserved exactly: MeetingCoreFields → RepresentativeContactField → MeetingMetadataFields → MeetingPeopleFields → ExternalParticipantsField → MeetingManagerField → RecurrenceFields → MeetingReminderField → AgendaEditor → MeetingFormActions
- [x] All parent state declarations, setters, `handleSubmit`, `meetingRecord`, validation toasts, Supabase calls, Auth handlers, prefill effects, contact loading/insertion, `createRepeatMeetings`, agenda queries/mutations, participant/notification payloads, calendar/date conversion, reset logic, `onSuccess`, and `onCancel` remain in the parent
- [x] New components import only Lucide icons and sibling `MultiSelectValue` type — no Supabase, toast, Auth, Meetings hooks, repositories, or services
- [x] No explicit `any` introduced in any new component
- [x] CreateMeetingForm line count reduced from 688 to 648 (40 lines removed)
- [x] Component line counts: `MeetingMetadataFields` 47, `MeetingManagerField` 30, `MeetingReminderField` 29, `MeetingFormActions` 42 (all below ~100-line target)
- [x] Scoped lint unchanged: 12 problems (10 errors, 2 warnings) — no increase
- [x] All four new files have zero lint errors and warnings
- [x] Parent Supabase/query/RPC match count unchanged: 16 before, 16 after
- [x] New components have zero query or mutation matches
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- **Phase 2B2D presentational decomposition complete.**
- Remaining parent complexity is business/data orchestration (state ownership, validation, payload construction, Supabase queries, prefill/reset, submission) — deferred to Phase 3.

#### Phase 2B2D9 — Extract participant and notification presentation ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingPeopleFields.tsx` (presentational)
- [x] Reuse existing internal types `MultiSelectGroup` and `MultiSelectValue` from `MultiSelectField` (no duplication)
- [x] Define explicit props contract: `MeetingPeopleFieldsProps` (controlled groups, participants, notifyUsers with per-field change callbacks)
- [x] Move participants section, participants `MultiSelectField`, notification-users section, and notification-users `MultiSelectField`
- [x] Move `Users` icon usage into the new component (no longer in parent); `Bell` retained in parent for reminder section; `UserCheck` retained in parent for manager section
- [x] Preserve add/remove callback order: `onAdd={(item) => onParticipantsChange([...participants, item])}` / `onRemove={(id) => onParticipantsChange(participants.filter((item) => item.id !== id))}` (and equivalent for notify users)
- [x] Meeting-manager presentation intentionally retained in the parent to preserve visible field order (manager appears after external participants)
- [x] Visible field order preserved exactly: participants → notification users → external participants → meeting manager
- [x] New component imports only `Users`/`Bell` from Lucide and `MultiSelectField` from sibling — no Supabase, toast, moment, `useOrgUsers`, Auth, Meetings hooks, `src/app`, repositories, or services
- [x] Connect component with controlled props preserving callback behavior: `setSelectedParticipants`/`setSelectedNotifyUsers`
- [x] `useOrgUsers`, `orgGroups`, `allUsers`, `systemUserGroups` mapping, `resolveUserName`, `resolveUsersByIds`, selected-participant state, selected-notification-user state, meeting-manager state, prefill user resolution, meeting payload fields, reset behavior, Supabase queries, notification behavior, and submission logic all remain in the parent
- [x] No explicit `any` introduced in the new component
- [x] CreateMeetingForm line count reduced from 709 to 688 (21 lines removed)
- [x] `MeetingPeopleFields.tsx` is 58 lines (below ~130-line target)
- [x] Scoped lint unchanged: 12 problems (10 errors, 2 warnings) — no increase
- [x] `MeetingPeopleFields.tsx` has zero lint errors and warnings
- [x] `MultiSelectField.tsx` remains lint-clean
- [x] Parent Supabase/query/RPC match count unchanged: 16 before, 16 after
- [x] New component has zero query or mutation matches
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D8 — Extract core meeting fields presentation ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingCoreFields.tsx` (presentational)
- [x] Define and export internal types `MeetingCalendarOption` and `MeetingScheduleDate` (not exported from feature public API)
- [x] Define explicit props contract: `MeetingCoreFieldsProps` (controlled subject, calendar selection, scheduling context, start/end time, request date, duration, location with per-field change callbacks)
- [x] Move subject label and input, calendars conditional, calendar select, selected-calendar color dot, calendar-scheduling date summary, calendar-scheduling time summary, edit-mode `MeetingDateTimeFields` rendering, normal request-date input, requested-duration selector, and location label and input
- [x] Move `JALAALI_MONTHS` constant into the new component (no longer in parent)
- [x] Move `Calendar` and `Clock` icon usage into the new component (no longer in parent)
- [x] New component imports only `Calendar`/`Clock` from Lucide and `MeetingDateTimeFields` — no Supabase, toast, moment, Auth, Meetings hooks, `src/app`, repositories, or services
- [x] Connect component with controlled props preserving callback behavior: `setSubject`/`setSelectedCalendarId`/`setStartTime`/`setEndTime`/`setRequestJalaaliDate`/`setRequestDuration`/`setLocation`
- [x] `RepresentativeContactField` remains immediately after this component
- [x] All controlled state declarations, prefill logic, default-date effect, `handleSubmit`, date conversion, validation toasts, `meetingRecord`, calendar ID payload, request date and duration payloads, start/end-time payloads, reset behavior, Supabase calls, recurrence generation, and agenda persistence remain in the parent
- [x] No explicit `any` introduced in the new component
- [x] CreateMeetingForm line count reduced from 768 to 709 (59 lines removed)
- [x] `MeetingCoreFields.tsx` is 154 lines (below ~180-line target)
- [x] Scoped lint unchanged: 12 problems (10 errors, 2 warnings) — no increase
- [x] `MeetingCoreFields.tsx` has zero lint errors and warnings
- [x] `MeetingDateTimeFields.tsx` remains lint-clean
- [x] Parent Supabase/query/RPC match count unchanged: 16 before, 16 after
- [x] New component has zero query or mutation matches
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D7 — Extract recurrence configuration presentation ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/RecurrenceFields.tsx` (presentational + local end-date-picker interaction)
- [x] Define explicit props contract: `RecurrenceFieldsProps` with internal `RepeatType` and `RepeatMonthlyMode` types (controlled enabled/type/interval/endDate/weekday/monthlyMode/monthlyWeekday with per-field change callbacks)
- [x] Move `showEndDatePicker`, `endDatePickerJy`, `endDatePickerJm` local picker state into the new component
- [x] Move recurrence enable checkbox, repeat-type selector, repeat-interval selector, end-date text field, end-date picker button, Jalali end-date picker presentation, picker month navigation, day-cell generation and date selection, weekly weekday selection, monthly mode selection, monthly weekday selection, and recurrence-specific weekday/month labels
- [x] Move `JALAALI_WEEKDAYS` constant into the new component (`JALAALI_MONTHS` remains in parent for the main date picker)
- [x] Move `Repeat`, `ChevronLeft`, `ChevronRight` icon usage into the new component (`Calendar` remains shared in parent)
- [x] New component imports only `useState`, `moment-jalaali`, and Lucide icons — no Supabase, toast, Auth, Meetings hooks, `src/app`, repositories, or services
- [x] Connect component with controlled props preserving callback behavior: `setRepeatEnabled`/`setRepeatType`/`setRepeatInterval`/`setRepeatEndDate`/`setRepeatWeekday`/`setRepeatMonthlyMode`/`setRepeatMonthlyWeekday`
- [x] Removed the moved monthly-mode `any` cast: replaced `opt.value as any` with a typed `MONTHLY_MODE_OPTIONS` array and direct `onMonthlyModeChange(option.value)` call
- [x] `repeatEnabled`, `repeatType`, `repeatInterval`, `repeatEndDate`, `repeatWeekday`, `repeatMonthlyMode`, `repeatMonthlyWeekday` and all setters remain in the parent
- [x] `createRepeatMeetings`, meeting-record recurrence fields, recurring-meeting array generation, weekly/monthly recurrence algorithms, Jalali-to-Gregorian conversion, repeated-meeting Supabase insert, error/success toasts, reset, and submission remain in the parent
- [x] No explicit `any` introduced in the new component
- [x] CreateMeetingForm line count reduced from 875 to 768 (107 lines removed)
- [x] `RecurrenceFields.tsx` is 180 lines (below ~230-line target)
- [x] Scoped lint improved: 13 problems → 12 problems (10 errors, 2 warnings) — moved `any` cast removed
- [x] `RecurrenceFields.tsx` has zero lint errors and warnings
- [x] Parent recurrence/Supabase match count unchanged: 26 before, 26 after
- [x] New component has zero Supabase/query/mutation/toast matches
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D6 — Extract agenda editor presentation ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/AgendaEditor.tsx` (presentational + local editing interaction)
- [x] Define explicit props contract: `AgendaEditorProps` (controlled enabled/items/participantNames/externalNames with enabled-change, items-change, and optional validation-error callbacks)
- [x] Move `showAgendaForm`, `agendaForm`, `editingAgendaIdx` temporary editing state into the new component (as `showForm`, `form`, `editingIndex`)
- [x] Move agenda enable/disable presentation, add-agenda button, agenda item form, title field, presenter field, duration field, add/save/cancel controls, agenda item list, edit button, delete button, and all local add/edit/delete handler bodies
- [x] Move `ClipboardList`, `Pencil`, `Trash2`, `Check`, `Plus` icon usage into the new component (`UserCheck`, `Clock` remain shared in parent)
- [x] New component imports only React hooks, Lucide icons, and `AgendaItem` type — no Supabase, toast, Auth, Meetings hooks, `src/app`, repositories, or services
- [x] Connect component with controlled props: `enabled`/`items`/`onEnabledChange`/`onItemsChange`, `participantNames`/`externalNames` for presenter dropdown, optional `onValidationError` for required-field toast
- [x] `agendaEnabled`, `agendaItems`, `setAgendaEnabled`, `setAgendaItems` remain in the parent
- [x] Prefill query for `meeting_agenda_items`, row-to-AgendaItem mapping, agenda insert during creation, agenda delete+insert during update, meeting submission, Supabase calls, toast calls, reset, and payload behavior remain in the parent
- [x] All `meeting_agenda_items` queries and mutations remain in the parent (5 matches before and after)
- [x] No explicit `any` introduced in the new component
- [x] CreateMeetingForm line count reduced from 1015 to 875 (140 lines removed)
- [x] `AgendaEditor.tsx` is 178 lines (below ~200-line target)
- [x] Scoped lint unchanged: 13 problems (11 errors, 2 warnings) — no increase
- [x] `AgendaEditor.tsx` has zero lint errors and warnings
- [x] New component has zero Supabase/query/mutation matches
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D5 — Extract external-participant picker presentation ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/ExternalParticipantsField.tsx` (presentational + local dropdown interaction)
- [x] Define explicit props contract: `ExternalParticipantsFieldProps` and `ExternalContactDraft` (controlled contacts/selectedNames/draft/isAddFormOpen with select, remove, draft-change, add-form-open-change, and add-contact callbacks)
- [x] Move `externalSearch`, `showExternalDropdown`, `externalSearchRef` state into the new component
- [x] Move external-dropdown outside-click effect and cleanup into the new component
- [x] Move `filteredContacts` filtering (name + email match, exclusion of already-selected names, max 8 displayed) into the new component
- [x] Move external-participants label, selected-name tags, remove buttons, search input, dropdown, contact result rows, keyboard handling (Enter selects first, Escape closes), quick-add button, add-contact form presentation, and `UserPlus`/`X`/`Plus` icon usage
- [x] New component imports only React hooks, `UserPlus`/`X`/`Plus`, and `ContactEmail` type — no Supabase, toast, Auth, Meetings hooks, `src/app`, repositories, or services
- [x] Connect component using controlled props preserving callback behavior: `setSelectedExternal` append/remove, draft field mapping, `setShowAddExternal`, `addQuickExternal`
- [x] Remove parent outside-click effect (no other responsibility remained)
- [x] Remove `useRef` and `UserPlus` from parent imports (no longer used in parent)
- [x] `addQuickExternal` remains in the parent with its existing `contacts_email` insert, `.select().single()`, local contacts update, selected-external update, field reset, add-form close, and success/failure toasts
- [x] Contact fetching, `selectedExternal`, `newExternalName/Email/Phone`, `showAddExternal`, meeting payload, reset, and prefill behavior remain in the parent
- [x] No explicit `any` introduced in the new component
- [x] CreateMeetingForm line count reduced from 1084 to 1015 (69 lines removed)
- [x] `ExternalParticipantsField.tsx` is 134 lines (below ~190-line target)
- [x] Scoped lint unchanged: 13 problems (11 errors, 2 warnings) — no increase
- [x] `ExternalParticipantsField.tsx` has zero lint errors and warnings
- [x] Parent contact/Supabase match count unchanged: 16 before, 16 after
- [x] New component has zero Supabase/query/mutation matches
- [x] No Supabase query or mutation changed
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D4 — Extract representative contact-picker field ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/RepresentativeContactField.tsx` (presentational + local picker interaction)
- [x] Define explicit props contract: `RepresentativeContactFieldProps` (controlled representative/phone/contacts with change and select callbacks)
- [x] Move `showRepPicker`, `repPickerSearch`, `repPickerRef` state into the new component
- [x] Move representative-picker outside-click effect and cleanup into the new component
- [x] Move `filteredRepContacts` filtering (case-insensitive name match + phone match) into the new component
- [x] Move representative label and input, contact-picker button, contact search input, empty-result text, contact result rows, representative phone input, `BookUser` icon usage, and all related Persian text and CSS classes
- [x] New component imports only React hooks, `BookUser`, and `ContactEmail` type — no Supabase, toast, Auth, Meetings hooks, `src/app`, repositories, or services
- [x] Connect component using controlled props preserving callback semantics: `setRepresentative`/`setPhone` with `setRepFromContacts(false)` on manual change, `setRepFromContacts(true)` on contact selection
- [x] Update parent outside-click effect to handle only the external-participant dropdown (removed representative listener)
- [x] Preserve `mousedown`, external ref containment check, cleanup behavior, and external dropdown closing behavior
- [x] Remove `BookUser` from parent icon imports (no longer used in parent)
- [x] Remove moved `(c as any).phone` casts — replaced with `contact.phone` (already optional on `ContactEmail`)
- [x] Contact queries and mutations remain in the parent:
  - `allContacts` state and contact fetching
  - `representative`, `phone`, `repFromContacts` state
  - `saveContact` and contact insertion
  - submission and reset behavior
- [x] No explicit `any` in the new component
- [x] No unrelated `any` modified in the parent
- [x] CreateMeetingForm line count reduced from 1119 to 1084 (35 lines removed)
- [x] `RepresentativeContactField.tsx` is 89 lines (below ~140-line target)
- [x] Scoped lint improved: 16 → 13 problems (11 errors, 2 warnings) — removed 3 `any` casts from moved code
- [x] `RepresentativeContactField.tsx` has zero lint errors and warnings
- [x] No Supabase query or mutation changed
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D3 — Extract authentication-fallback presentation ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingFormAuthFallback.tsx` (presentational, self-contained)
- [x] Define explicit props contract: `MeetingFormAuthFallbackProps` (controlled email/password/loading/mode with submit, change, and toggle callbacks)
- [x] Move authentication fallback container, heading, email field, password field, submit button, loading indicator, login/signup button labels, mode-toggle link, and all related Persian text and CSS classes
- [x] New component imports only React types and required Lucide icons (`Loader as Loader2`, `Mail`, `Lock`, `UserPlus`)
- [x] New component imports no Supabase, Auth feature hooks, Meetings hooks, `src/app`, toast, repositories, or services
- [x] Replace `if (showAuthError)` fallback block in `CreateMeetingForm` with `<MeetingFormAuthFallback />` using controlled props
- [x] Preserve object-update semantics (`setAuthForm({ ...authForm, email: value })`) — no reducer or new form state abstraction
- [x] Remove `Mail` and `Lock` from `CreateMeetingForm` icon imports (no longer used in parent); `UserPlus` and `Loader2` remain used elsewhere
- [x] Auth operations remain in the parent as legacy behavior:
  - `showAuthError`, `isSignUp`, `authForm`, `loading`, `userId` state
  - `handleLogin`, `handleSignUp` handlers
  - `supabase.auth.getUser`, `supabase.auth.signInWithPassword`, `supabase.auth.signUp` calls
  - success and error toasts, email redirect configuration, post-auth state updates, form submission behavior
- [x] No Auth feature file modified
- [x] No explicit `any` introduced
- [x] CreateMeetingForm line count reduced from 1134 to 1119 (15 lines removed)
- [x] `MeetingFormAuthFallback.tsx` is 60 lines (below ~120-line target)
- [x] Scoped lint unchanged: 16 problems (14 errors, 2 warnings) — no increase
- [x] `MeetingFormAuthFallback.tsx` has zero lint errors and warnings
- [x] No Supabase query or mutation changed
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or dependency added
- [x] Auth-boundary redesign deferred until behavior tests exist
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D2 — Extract edit-mode Jalali date and time fields ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/MeetingDateTimeFields.tsx` (presentational, self-contained)
- [x] Define explicit props contract: `MeetingDateTimeFieldsProps` (controlled date/start/end with change callbacks)
- [x] Move `showDatePicker`, `datePickerJy`, `datePickerJm`, `datePickerRef` state into the new component
- [x] Move date-picker outside-click effect and cleanup into the new component
- [x] Move date-picker open/close behavior, month navigation, day-cell generation, date selection, weekday labels, `YYYY/MM/DD` output format, and the two time inputs
- [x] Preserve Persian text, CSS/dark-mode classes, selected-date styling, placeholder, opening behavior, picker month/year sync, month-12 calculation, first-day offset calculation, input types, callback timing, and event propagation
- [x] New component imports only React hooks, `moment-jalaali`, and required Lucide icons (`Calendar`, `ChevronLeft`, `ChevronRight`)
- [x] New component imports no Supabase, `src/app`, Meetings hooks, repositories, services, auth, or notification utilities
- [x] Replace edit-mode block in `CreateMeetingForm` with `<MeetingDateTimeFields />` under existing `prefillMeetingId` condition
- [x] Remove moved states, ref, effect, and inline JSX after connection and build pass
- [x] Calendar-drag scheduling branch and normal request-date branch unchanged
- [x] `JALAALI_MONTHS` constant remains shared (used by calendar-drag branch in parent)
- [x] Database and scheduling behavior remained in the parent
- [x] CreateMeetingForm line count reduced from 1222 to 1134 (88 lines removed)
- [x] `MeetingDateTimeFields.tsx` is 126 lines (below ~180-line target)
- [x] Scoped lint unchanged: 16 problems (14 errors, 2 warnings) — no increase
- [x] `MeetingDateTimeFields.tsx` has zero lint errors and warnings
- [x] No Supabase query or mutation changed
- [x] No explicit `any` introduced
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No repository, service, hook, context, reducer, or package added
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2D1 — Extract inline MultiSelectField from CreateMeetingForm ✅
- [x] Create `src/features/meetings/components/CreateMeetingForm/MultiSelectField.tsx` (presentational, self-contained)
- [x] Define explicit local types: `MultiSelectOption`, `MultiSelectGroup`, `MultiSelectValue`, `MultiSelectFieldProps`
- [x] Move inline `MultiSelectField` component (query state, open/close, highlighted index, outside-click listener, search filtering, group rendering, selected filtering, keyboard behavior, max-8 legacy list, Persian text, CSS, dark mode, tag rendering, callback order, input focus, event propagation)
- [x] Import `MultiSelectField` into `CreateMeetingForm`; remove old inline component after connection
- [x] New component imports no Supabase, `src/app`, Meetings hooks, repositories, services, or external state libraries
- [x] Types not exported from public Meetings `index.ts`
- [x] CreateMeetingForm line count reduced from 1358 to 1224 (134 lines removed)
- [x] `MultiSelectField.tsx` is 158 lines (below 220-line component limit)
- [x] Scoped lint unchanged: 16 problems (14 errors, 2 warnings) — no increase
- [x] `MultiSelectField.tsx` has zero lint errors and warnings
- [x] No Supabase/query/mutation code changes
- [x] No explicit `any` added
- [x] No UI or runtime behavior changes
- [x] No public Meetings export changes
- [x] No other file refactored
- Inherited CreateMeetingForm lint debt deferred to cleanup phase

#### Phase 2B2C4 — Extract MeetingCard header and toolbar presentation ✅
- [x] Create `src/features/meetings/components/MeetingCard/MeetingCardHeader.tsx` (presentational only)
- [x] Move priority badge, status badge, title, rejected warning, resend/edit-resend/send-users/share/Telegram/edit/Calendar/delete buttons, share dropdown menu into Header
- [x] Move `priorityColors` and `statusTypeColors` maps into Header
- [x] Move related Lucide icon imports into Header
- [x] Header receives explicit props interface; no state setters, no generic actions object
- [x] `canAddToGoogleCalendar={Boolean(onScheduleInCalendar)}` matches existing icon-button visibility
- [x] All business handlers (`handleResend`, `setIsEditing`, `setShowUserSelector`, sharing handlers, `handleAddToGoogleCalendar`, `setShowDeleteModal`) remain in MeetingCardMain
- [x] Bottom green "برنامه‌ریزی در تقویم" scheduling action remains in MeetingCardMain
- [x] Remove unused `closeShareMenu` from `useMeetingCardSharing` (no consumers)
- [x] MeetingCardMain line count reduced from 545 to 449 (96 lines removed)
- [x] `MeetingCardHeader.tsx` is 157 lines (below 220-line component limit)
- [x] `useMeetingCardSharing.ts` reduced from 164 to 161 lines (closeShareMenu removal)
- [x] Combined query-match count preserved: 22 (Main) + 0 (Header) + 0 (Sharing) = 22 (identical to baseline)
- [x] Header has zero Supabase/query/RPC matches
- [x] Header imports no Supabase, notification, Telegram, html-to-image, moment-jalaali, src/app, repositories, services, or hooks
- [x] Scoped lint unchanged: 5 problems (5 errors, 0 warnings) — no increase
- [x] Header has zero lint errors and warnings
- [x] `useMeetingCardSharing.ts` remains lint-clean
- [x] No repository, service, mapper, hook, context, reducer, or state store introduced
- [x] No extracted file imports from `src/app`
- [x] No Meetings public export changes
- [x] No explicit `any` introduced in new code
- Inherited Meetings lint debt deferred to cleanup phase

#### Phase 2B2C3 — Extract MeetingCard sharing hook ✅
- [x] Create `src/features/meetings/hooks/useMeetingCardSharing.ts` (sharing state, refs, outside-click effect, sharing handlers)
- [x] Move `showShareMenu`, `showShareDialog`, `shareImageUrl` state to hook
- [x] Move `cardRef`, `shareCardRef`, `shareMenuRef` refs to hook (explicit `RefObject<HTMLDivElement | null>` types)
- [x] Move document `mousedown` outside-click effect to hook
- [x] Move `handleShareImage`, `handleShareText`, `handleSendToTelegram`, download callback to hook
- [x] Hook receives shared `setLoading` to preserve button-disable and operation behavior
- [x] Hook returns explicit interface; no raw setters exposed
- [x] Connect hook to `MeetingCardMain`; replace JSX callbacks with hook values
- [x] Remove old states, refs, effect, and handlers from MeetingCardMain
- [x] Remove unused imports (`useRef`, `useEffect`, `toPng`, `sendMeetingToTelegram`) from MeetingCardMain
- [x] Fix pre-existing duplicate export of `MeetingCardMain` (blocking build bug)
- [x] MeetingCardMain line count reduced from 635 to 545 (90 lines removed)
- [x] `useMeetingCardSharing.ts` is 164 lines (below 180-line hook limit)
- [x] Combined query-match count preserved: 22 (Main) + 4 (ReadModel) + 0 (Sharing) = 26 (identical to baseline)
- [x] All 11 sharing/integration matches moved from Main to hook (Main: 0, Hook: 11)
- [x] Sharing hook contains no Supabase, `.from`, or `.rpc` access
- [x] Scoped lint improved: 7 → 5 problems (5 errors, 0 warnings)
- [x] New hook has zero lint errors and warnings
- [x] `MeetingShareDialog` and `MeetingShareCard` remain lint-clean
- [x] Deletion, resend, edit, Google Calendar, notifications, and database behavior remain in MeetingCardMain
- [x] No repository, service, mapper, context, reducer, or state store introduced
- [x] No extracted file imports from `src/app`
- [x] No Meetings public export changes
- [x] No explicit `any` introduced in new code
- Inherited Meetings lint debt deferred to cleanup phase

#### Phase 2B2C2 — Extract MeetingCard read-model hook ✅
- [x] Create `src/features/meetings/types/meetingCard.ts` with shared `ParticipantStatusEntry` type
- [x] Update `ParticipantStatusPanel.tsx` to consume shared type (no local duplicate)
- [x] Create `src/features/meetings/hooks/useMeetingCardReadModel.ts` (read-side state + effects only)
- [x] Move `participantStatuses`, `delegateNames`, `currentUserId`, `agendaItems` state to hook
- [x] Move `supabase.auth.getUser()` effect to hook
- [x] Move `meeting_agenda_items` query effect to hook
- [x] Move `meeting_inbox` + delegate-profile query effect to hook
- [x] Use `MeetingWithParticipantIds` structural type instead of explicit `any` for participant IDs
- [x] Use `participantUserIdsKey` in effect deps instead of inline cast expression
- [x] Connect hook to `MeetingCardMain`; remove old inline states and effects
- [x] MeetingCardMain line count reduced from 684 to 636
- [x] Combined query-match count preserved: 22 (Main) + 4 (hook) = 26 (identical to baseline)
- [x] Scoped lint improved: 13 → 7 problems (7 errors, 0 warnings)
- [x] New hook and type file have zero lint errors and warnings
- [x] ParticipantStatusPanel remains lint-clean
- [x] No mutation, RPC, sharing, editing, deletion, notification, Telegram, or Calendar behavior moved
- [x] No repository, service, mapper, context, reducer, or state store introduced
- [x] No extracted file imports from `src/app`
- [x] No Meetings public export changes
- [x] No explicit `any` introduced in new code
- Inherited Meetings lint debt deferred to cleanup phase

#### Phase 2B2C1 — Extract presentational UI from MeetingCardMain ✅
- [x] Extract `DeleteMeetingModal.tsx` (confirmation flow, loading state, callbacks)
- [x] Extract `MeetingDetails.tsx` (date, time, location, representative, phone, notes, agenda display)
- [x] Extract `ParticipantStatusPanel.tsx` (participant status rendering, delegate names)
- [x] Extract `MeetingShareDialog.tsx` (image share dialog, download callback)
- [x] Extract `MeetingShareCard.tsx` (hidden card for html-to-image, forwardRef)
- [x] All Supabase access, mutations, effects, handlers remain in MeetingCardMain
- [x] MeetingCardMain line count reduced from 912 to 684
- [x] Supabase/query/RPC match count unchanged (26)
- [x] Scoped lint improved: 14 → 13 problems (11 errors, 2 warnings)
- [x] All 5 new files have zero lint errors and warnings
- [x] No extracted component imports Supabase or src/app
- [x] No repository, service, or mapper introduced
- Inherited Meetings lint debt deferred to cleanup phase

#### Phase 2B2A — Relocate Meetings dashboard and MeetingCard family ✅

Remaining Phase 3 order:
3D4. extract the rejected-edit resend command

### Phase 3 — Introduce repositories and mappers (in progress)
### Phase 4 — Split oversized feature files (pending)
### Phase 5 — Routing modernization (pending)
### Phase 6 — Testing and CI (pending)
### Phase 7 — Realtime and performance (pending)

## Completed phases

### Phase 0 — Baseline and safeguards
- Baseline build: **passes** (exit 0)
- Baseline lint: **694 problems** (597 errors, 97 warnings) — all pre-existing, mostly `any` in `supabase/functions/` and components. App.tsx itself: 13 problems (10 errors, 3 warnings) — pre-existing.
- Created `AGENTS.md` and this plan.
- Inventory recorded above.

### Phase 1 — Decompose App.tsx
- App.tsx reduced from 857 lines to 135 lines (composition shell).
- Extracted 10 modules under `src/app/`: hooks, navigation, guards, layout.
- Lint: 681 problems (587 errors, 94 warnings) — decreased by 13 (original App.tsx lint issues now resolved in extracted code).
- Build: passes.
- All behavior preserved: auth flow, permission resolution, meetings realtime, maintenance gate, spark visibility, splash, navigation (activePage, mpage, popstate, /admin, conference).

### Phase 2A — Auth and Permissions
- Created `src/features/auth/` with `hooks/useAuthSession.ts`, `types/authSession.ts`, `index.ts`
- Created `src/features/permissions/` with `services/loadResolvedUserPermissions.ts`, `services/checkPermission.ts`, `components/AccessDenied.tsx`, `index.ts`
- Moved auth session + permission loading into feature boundaries
- Renamed `resolveUserPermissions` → `loadResolvedUserPermissions` (performs Supabase queries, not a pure resolver)
- Deleted old files: `src/app/hooks/useAuthSession.ts`, `src/app/hooks/resolveUserPermissions.ts`, `src/app/guards/permissions.ts`, `src/app/guards/AccessDenied.tsx`
- Updated imports in `src/App.tsx` and `src/app/navigation/PageRenderer.tsx`
- Added logout safeguard in `useMeetingsData`: clears `meetings` and `pendingMeetingsCount` when `isAuthenticated` becomes false
- Build: passes. Scoped lint: 0 errors, 0 warnings.
- Import direction: `features/auth` imports from `features/permissions` (public API); no feature imports from `src/app`.

## Pending phases

Phases 2–7 as described in the phased checklist.

## Known risks

- 597 pre-existing lint errors across codebase — not introduced by refactor; must not increase.
- `App.tsx` uses `any` in several places (pendingSchedule, spark prefill, realtime payloads) — preserved as-is to avoid behavior change; typed properly in later phases.
- `Layout.tsx` (1201 lines) owns pushState for `/admin` — must stay in sync with navigation adapter.
- No test suite — regression risk during extraction; Phase 6 adds characterization tests.
- Realtime uses full refetch on every change — preserved; optimization deferred to Phase 7.

## Validation results

| Phase | Lint                          | Build |
|-------|-------------------------------|-------|
| 0     | 694 problems (pre-existing)   | pass  |
| 1     | 681 problems (−13)           | pass  |
| 2A    | scoped lint: 0 errors, 0 warnings | pass  |
| 2B1   | scoped lint: 0 errors, 0 warnings | pass  |
| 2B2A  | scoped lint: pre-existing errors only (no new issues) | pass  |
| 2B2B  | scoped lint: 26 errors, 4 warnings (identical before/after) | pass  |
| 2B2C1 | scoped lint: 13 problems (11 errors, 2 warnings) — improved from 14 | pass  |
| 2B2C2 | scoped lint: 7 problems (7 errors, 0 warnings) — improved from 13 | pass  |
| 2B2C3 | scoped lint: 5 problems (5 errors, 0 warnings) — improved from 7 | pass  |
| 2B2C4 | scoped lint: 5 problems (5 errors, 0 warnings) — no increase | pass  |
| 2B2D1 | scoped lint: 16 problems (14 errors, 2 warnings) — no increase | pass  |
| 2B2D2 | scoped lint: 16 problems (14 errors, 2 warnings) — no increase | pass  |
| 2B2D3 | scoped lint: 16 problems (14 errors, 2 warnings) — no increase | pass  |
| 2B2D4 | scoped lint: 13 problems (11 errors, 2 warnings) — improved (removed 3 `any` casts) | pass  |
| 2B2D5 | scoped lint: 13 problems (11 errors, 2 warnings) — no increase | pass  |
| 2B2D6 | scoped lint: 13 problems (11 errors, 2 warnings) — no increase | pass  |
| 2B2D7 | scoped lint: 12 problems (10 errors, 2 warnings) — improved (moved `any` cast removed) | pass  |
| 2B2D8 | scoped lint: 12 problems (10 errors, 2 warnings) — no increase | pass  |
| 2B2D9 | scoped lint: 12 problems (10 errors, 2 warnings) — no increase | pass  |
| 2B2D10 | scoped lint: 12 problems (10 errors, 2 warnings) — no increase | pass  |
| 3A1    | scoped lint: 12 problems (10 errors, 2 warnings) — no increase; repository zero | pass  |
| 3A2    | scoped lint: 11 problems (9 errors, 2 warnings) — decrease of 1 (Agenda `any` removed); repository zero | pass  |
| 3A3    | scoped lint: 11 problems (9 errors, 2 warnings) — no increase; repository zero | pass  |
| 3A4A   | scoped lint: 11 problems (9 errors, 2 warnings) — no increase; repository zero | pass  |
| 3A4B   | scoped lint: 11 problems (9 errors, 2 warnings) — no increase; repository zero | pass  |
| 3A4C   | scoped lint: 11 problems (9 errors, 2 warnings) — no increase; repository zero | pass  |
| 3B1    | scoped lint: 7 problems (5 errors, 2 warnings) — improved; new files zero; repository zero | pass  |
| 3B2    | scoped lint: 7 problems (5 errors, 2 warnings) — no increase; new builder zero | pass  |
| 3B3    | scoped lint: 7 problems (5 errors, 2 warnings) — no increase; test file + builder + types zero; 6 tests pass | pass  |
| 3B4    | scoped lint: 7 problems (5 errors, 2 warnings) — no increase; both test files + both builders + types zero; 12 tests pass | pass  |
| 3C1    | scoped lint: 0 errors, 0 warnings — form clean; 12 tests pass | pass  |
| 3C2    | scoped lint: 0 errors, 0 warnings — form + auth service + auth index + auth hook clean; 12 tests pass | pass  |
| 3D1    | scoped lint: command 0/0; MeetingCardMain 4 errors (down from 5); 12 tests pass | pass  |
| 3D2    | scoped lint: command 0/0; MeetingCardMain 4 errors (unchanged); 12 tests pass | pass  |
| 3D3    | scoped lint: command 0/0; MeetingCardMain 3 errors (down from 4); 12 tests pass | pass  |
