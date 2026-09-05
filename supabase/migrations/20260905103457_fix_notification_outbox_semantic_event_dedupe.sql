-- event_key is a semantic notification type (for example decision_completed),
-- not a unique event-instance identifier. The legacy unique index below
-- incorrectly allowed only one row per semantic event/channel across the
-- entire outbox and caused later decision notifications to be swallowed as
-- DUPLICATE. Instance-level deduplication is already enforced by the unique
-- idempotency_key index.
DROP INDEX IF EXISTS public.notification_outbox_event_key_channel_key;
