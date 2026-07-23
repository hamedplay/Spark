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

Remaining Phase 2 order:
2B2C3. continue splitting MeetingCardMain by responsibility
2B2D. split CreateMeetingForm by responsibility
2C. calendar
2D. tasks
2E. minutes
2F. contacts
2G. chat and channels
2H. reports
2I. video conference
2J. Spark AI
2K. administration
### Phase 3 — Introduce repositories and mappers (pending)
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
