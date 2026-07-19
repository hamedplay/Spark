/*
# Minutes Phase 3 — fix audit log FK blocking minute deletion

The minutes_audit_log.minute_id FK to minutes.id blocks the DELETE trigger:
the trigger tries to INSERT an audit row referencing the minute being
deleted, but the FK requires the parent minute to still exist at INSERT
time. Since audit is append-only and history should survive minute
deletion, we drop the FK and keep minute_id as a plain uuid (still
indexed, still RLS-scoped via _user_can_view_minute on the remaining
minute if it exists; deleted minutes' audit becomes invisible via RLS
which is acceptable — the minute is gone).
*/

ALTER TABLE public.minutes_audit_log DROP CONSTRAINT IF EXISTS minutes_audit_log_minute_id_fkey;
