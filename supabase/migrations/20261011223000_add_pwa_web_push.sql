CREATE TABLE IF NOT EXISTS public.pwa_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0,
  disabled_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pwa_push_subscriptions_user_active
  ON public.pwa_push_subscriptions(user_id)
  WHERE disabled_at IS NULL;

ALTER TABLE public.pwa_push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pwa_push_subscriptions_select_own ON public.pwa_push_subscriptions;
CREATE POLICY pwa_push_subscriptions_select_own
  ON public.pwa_push_subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS pwa_push_subscriptions_insert_own ON public.pwa_push_subscriptions;
CREATE POLICY pwa_push_subscriptions_insert_own
  ON public.pwa_push_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pwa_push_subscriptions_update_own ON public.pwa_push_subscriptions;
CREATE POLICY pwa_push_subscriptions_update_own
  ON public.pwa_push_subscriptions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS pwa_push_subscriptions_delete_own ON public.pwa_push_subscriptions;
CREATE POLICY pwa_push_subscriptions_delete_own
  ON public.pwa_push_subscriptions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.pwa_push_subscriptions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pwa_push_subscriptions TO authenticated;

CREATE TABLE IF NOT EXISTS public.pwa_push_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL UNIQUE REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pwa_push_outbox_claim
  ON public.pwa_push_outbox(status, available_at, created_at)
  WHERE status IN ('pending','failed');

ALTER TABLE public.pwa_push_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pwa_push_outbox FROM anon, authenticated;

CREATE OR REPLACE FUNCTION private.enqueue_pwa_push_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF COALESCE((
    SELECT up.notifications_enabled
    FROM public.user_preferences up
    WHERE up.user_id = NEW.user_id
  ), true) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.pwa_push_outbox(notification_id, user_id, payload)
  VALUES (
    NEW.id,
    NEW.user_id,
    jsonb_build_object(
      'id', NEW.id,
      'title', NEW.title,
      'body', NEW.message,
      'actionUrl', COALESCE(NEW.action_url, '/'),
      'type', NEW.type,
      'createdAt', NEW.created_at
    )
  )
  ON CONFLICT (notification_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notifications_enqueue_pwa_push ON public.notifications;
CREATE TRIGGER trg_notifications_enqueue_pwa_push
AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION private.enqueue_pwa_push_notification();

DO $block$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pwa_push_worker_token') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'pwa_push_worker_token',
      'Spark PWA push worker authentication token',
      NULL
    );
  END IF;
END;
$block$;

CREATE OR REPLACE FUNCTION public.get_pwa_vapid_config_service()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'public_key', max(CASE WHEN name = 'pwa_vapid_public_key' THEN decrypted_secret END),
    'private_key', max(CASE WHEN name = 'pwa_vapid_private_key' THEN decrypted_secret END)
  )
  FROM vault.decrypted_secrets
  WHERE name IN ('pwa_vapid_public_key','pwa_vapid_private_key');
$function$;

REVOKE ALL ON FUNCTION public.get_pwa_vapid_config_service() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pwa_vapid_config_service() TO service_role;

CREATE OR REPLACE FUNCTION public.set_pwa_vapid_config_service(
  p_public_key text,
  p_private_key text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF nullif(btrim(p_public_key), '') IS NULL OR nullif(btrim(p_private_key), '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_VAPID_CONFIG';
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'pwa_vapid_public_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_public_key, 'pwa_vapid_public_key', 'Spark PWA VAPID public key', NULL);
  ELSE
    PERFORM vault.update_secret(v_id, p_public_key, 'pwa_vapid_public_key', 'Spark PWA VAPID public key', NULL);
  END IF;

  SELECT id INTO v_id FROM vault.secrets WHERE name = 'pwa_vapid_private_key';
  IF v_id IS NULL THEN
    PERFORM vault.create_secret(p_private_key, 'pwa_vapid_private_key', 'Spark PWA VAPID private key', NULL);
  ELSE
    PERFORM vault.update_secret(v_id, p_private_key, 'pwa_vapid_private_key', 'Spark PWA VAPID private key', NULL);
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_pwa_vapid_config_service(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_pwa_vapid_config_service(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.verify_pwa_push_worker_secret_service(p_candidate text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM vault.decrypted_secrets
    WHERE name = 'pwa_push_worker_token'
      AND decrypted_secret = p_candidate
  );
$function$;

REVOKE ALL ON FUNCTION public.verify_pwa_push_worker_secret_service(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_pwa_push_worker_secret_service(text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_pwa_push_outbox_service(p_limit integer DEFAULT 50)
RETURNS TABLE(id uuid, notification_id uuid, user_id uuid, payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM public.pwa_push_outbox o
    WHERE (
      o.status = 'pending'
      OR (o.status = 'failed' AND o.attempt_count < 5)
      OR (o.status = 'processing' AND o.processing_started_at < now() - interval '5 minutes')
    )
      AND o.available_at <= now()
    ORDER BY o.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(COALESCE(p_limit, 50), 200))
  ), updated AS (
    UPDATE public.pwa_push_outbox o
    SET status = 'processing',
        attempt_count = o.attempt_count + 1,
        processing_started_at = now(),
        last_error = NULL
    FROM picked
    WHERE o.id = picked.id
    RETURNING o.id, o.notification_id, o.user_id, o.payload
  )
  SELECT updated.id, updated.notification_id, updated.user_id, updated.payload
  FROM updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_pwa_push_outbox_service(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pwa_push_outbox_service(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_pwa_push_outbox_service(
  p_id uuid,
  p_success boolean,
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  UPDATE public.pwa_push_outbox
  SET status = CASE WHEN p_success THEN 'sent' ELSE 'failed' END,
      processed_at = CASE WHEN p_success THEN now() ELSE processed_at END,
      available_at = CASE WHEN p_success THEN available_at ELSE now() + make_interval(secs => least(900, 15 * (2 ^ greatest(attempt_count - 1, 0))::integer)) END,
      processing_started_at = NULL,
      last_error = CASE WHEN p_success THEN NULL ELSE left(COALESCE(p_error, 'push_failed'), 1000) END
  WHERE id = p_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_pwa_push_outbox_service(uuid,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_pwa_push_outbox_service(uuid,boolean,text) TO service_role;

CREATE OR REPLACE FUNCTION public.dispatch_pwa_push_worker()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_url text;
  v_token text;
BEGIN
  SELECT decrypted_secret INTO v_url
  FROM vault.decrypted_secrets
  WHERE name = 'pwa_push_function_url';

  SELECT decrypted_secret INTO v_token
  FROM vault.decrypted_secrets
  WHERE name = 'pwa_push_worker_token';

  IF nullif(v_url, '') IS NULL OR nullif(v_token, '') IS NULL THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Spark-Worker-Token', v_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.dispatch_pwa_push_worker() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_pwa_push_worker() TO service_role;

DO $block$
DECLARE
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'spark-pwa-push-worker' LIMIT 1;
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule(v_job_id);
  END IF;
  PERFORM cron.schedule(
    'spark-pwa-push-worker',
    '* * * * *',
    'SELECT public.dispatch_pwa_push_worker();'
  );
END;
$block$;
