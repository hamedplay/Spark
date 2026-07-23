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

Remaining Phase 2 order:
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
