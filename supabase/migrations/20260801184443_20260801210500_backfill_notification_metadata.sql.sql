/*
# Backfill metadata for existing notifications

Set template_category, template_audience, and template_id for existing notifications
that have entity_type but missing template metadata.

- entity_type = 'minute' → template_category = 'minutes'
- entity_type = 'decision' → template_category = 'decision'
- template_audience: only set when determinable from template_event_type + recipient role
- template_id: only set on exact unique match (category, event_type, audience)

No notification text is changed. No data is deleted.
*/

-- Backfill template_category from entity_type
UPDATE public.notifications
SET template_category = 'minutes'
WHERE template_category IS NULL
  AND entity_type = 'minute';

UPDATE public.notifications
SET template_category = 'decision'
WHERE template_category IS NULL
  AND entity_type = 'decision';

-- Backfill template_audience: set to 'all' where template_event_type exists but audience is null
-- (We can't reliably determine exact audience from historical data without recipient role mapping)
UPDATE public.notifications
SET template_audience = 'all'
WHERE template_audience IS NULL
  AND template_event_type IS NOT NULL
  AND template_category IS NOT NULL;

-- Backfill template_id: only on exact unique match
UPDATE public.notifications n
SET template_id = t.id
FROM public.notification_templates t
WHERE n.template_id IS NULL
  AND n.template_category = t.category
  AND n.template_event_type = t.event_type
  AND n.template_audience = t.audience
  AND t.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.notification_templates t2
    WHERE t2.category = t.category
      AND t2.event_type = t.event_type
      AND t2.audience = t.audience
      AND t2.is_active = true
      AND t2.id <> t.id
  );
