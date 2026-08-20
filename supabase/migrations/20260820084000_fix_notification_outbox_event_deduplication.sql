-- The outbox event_key stores the canonical event type (for example decision_assigned),
-- not an event instance identifier. A UNIQUE(event_key, channel) index therefore blocks
-- every later occurrence of the same event type. Idempotency is already enforced by the
-- dedicated unique idempotency_key index, which is the correct per-event deduplication key.

DROP INDEX IF EXISTS public.notification_outbox_event_key_channel_key;

CREATE INDEX IF NOT EXISTS notification_outbox_event_key_channel_idx
  ON public.notification_outbox (event_key, channel)
  WHERE event_key IS NOT NULL;
