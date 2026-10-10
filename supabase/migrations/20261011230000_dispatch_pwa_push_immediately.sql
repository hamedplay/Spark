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

  -- pg_net is asynchronous, so this does not block the notification insert.
  -- The minute cron remains a durable retry/recovery path if this dispatch fails.
  PERFORM public.dispatch_pwa_push_worker();

  RETURN NEW;
END;
$function$;
