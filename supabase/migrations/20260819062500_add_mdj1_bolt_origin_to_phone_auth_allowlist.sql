-- Keep the active Bolt deployment origin authorized for public auth flows.
-- Preserve existing origins so older/live deployments are not broken.

UPDATE public.system_config sc
SET value = (
  SELECT string_agg(origin, ',' ORDER BY first_position)
  FROM (
    SELECT btrim(item) AS origin, min(ord) AS first_position
    FROM unnest(
      string_to_array(COALESCE(sc.value, ''), ',') ||
      ARRAY['https://hamedplay-spark-impo-mdj1.bolt.host']::text[]
    ) WITH ORDINALITY AS u(item, ord)
    WHERE btrim(item) <> ''
    GROUP BY btrim(item)
  ) deduped
),
updated_at = now(),
updated_by = NULL
WHERE sc.section = 'security'
  AND sc.key = 'phone_login_allowed_origins';
