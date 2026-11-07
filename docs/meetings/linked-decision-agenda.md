# Linked decision agenda review — 2026-11-07

Reviewed GitHub main `68ceaa6`, both meeting forms, the shared series service, picker/detail dialogs, agenda repositories, minutes display/payload, and actual functions/constraints on the connected Supabase copy. This review does not establish primary-server migration or deployed-bundle state.

| Capability | Verified implementation |
| --- | --- |
| Add from decision followup | Calendar `AgendaSection` and request `AgendaEditor`; entry now always visible beside the agenda heading and enables the agenda before opening the picker |
| Search and filters | Debounced, paginated RPC search; status and Jalali date filters; database scopes results to visible published minutes |
| Multiple selection | Picker retains selected decisions and adds an independent agenda item for each |
| Automatic title | Official references when available; otherwise real subject/date; picker now uses the actual RPC field `meeting_date` |
| Permanent source UUID | `meeting_agenda_items.source_decision_id` foreign key to `minutes_decisions` with deletion restriction |
| Duplicate prevention | Selection state, append guards, sync validation and unique `(meeting_id, source_decision_id)` index |
| Independent title edits | Agenda fields are edited independently; stable sync preserves agenda UUID and source identity |
| Reordering | Both forms use `ReorderableAgendaList`; sync stores list order while preserving UUIDs |
| Original detail/history | Separate authorized details RPC, available from meeting agenda and minutes results; most recent 40 history entries |
| New meeting result in original history | Explicit report action from the linked agenda result, after the new minutes are published; requires permission to record followup on the original decision |
| Database permissions | Full-session checks, source-minute visibility, target ownership/admin edit check and followup authorization; unauthorized RPC calls rejected in integration tests |
| Official numbering | `minutes.official_number` and `minutes_decisions.official_number`; admin-only reference RPC writes audit entry; no inferred numbering |
| Manual agenda | Existing manual add/edit UI and storage remain supported |
| Independent result source | `minutes_agenda_results.source_decision_id` is copied by trigger; deleting the meeting agenda item clears its pointer while retaining source decision identity |
| Recurring meetings | Shared service now keeps linked decisions out of the repeated agenda payload, then syncs all selected items to the first occurrence only, for both forms |

Three gaps were repaired:

1. Both forms hid the picker entry behind the initially unchecked agenda option and also hid it while a manual item was being entered. The entry now sits in the always-visible section header; manual draft state is retained.
2. The picker SQL returns `meeting_date`, while the frontend used `minute_date`. That broke date display and generated fallback titles. The frontend now matches the actual picker contract; the separate details RPC still correctly uses its own `minute_date` contract.
3. Only the calendar caller supplied a first-occurrence agenda; the request-form caller passed linked items to a series RPC that ignores source IDs and copies agenda text to every occurrence. Splitting manual/repeated items and syncing linked items now happens in the shared service, so callers cannot diverge. The existing two-step series/sync behavior remains: a sync error reports that the series was created and stops explicit delivery dispatch; it does not claim an atomic rollback of the series.

Validation:

- Production TypeScript/Vite build passed. No lint command was run.
- Twenty-four focused/regression form, title, selection, series, serialization, reorder, recurrence and similar-meeting tests passed. Component tests execute actual JSX branches and click/select callbacks; no real browser or primary session was used.
- `tests/database/linkedAgendaDecisionFlow.sql` passed against the connected copy with real authenticated RPCs: visibility, date key, stable agenda IDs/order/source, independent title editing, duplicate rejection, result snapshots, authorized result history, outsider rejection, admin official references/audit and retention after deletion. All fixtures and temporary authorization settings rolled back.
- These fixes change frontend/service code only. No historical migration was edited and no schema or persistent database data was changed. Existing linked-agenda schema/RPC migrations are present on the copy; primary readiness remains a deployment check.

Deploy the updated App bundle. In Calendar → schedule/create meeting, the new entry is visible beside “دستور جلسه” before checking the option, and remains visible during manual entry. Opening it activates the agenda, and selecting decisions adds individual editable items. The original decision is not renamed or duplicated.
