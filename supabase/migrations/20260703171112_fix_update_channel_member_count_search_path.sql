-- Fix: update_channel_member_count trigger was SECURITY DEFINER without SET search_path.
-- Same class of finding as toggle_pin_chat. Being a trigger does not exempt a
-- SECURITY DEFINER function from schema-injection risk — it still runs in the
-- schema search context of the caller unless fixed.
-- Change is purely additive: adds SET search_path, body is identical.

CREATE OR REPLACE FUNCTION public.update_channel_member_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_channel_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_channel_id := OLD.channel_id;
  ELSE
    v_channel_id := NEW.channel_id;
  END IF;

  UPDATE channels
  SET member_count = (
    SELECT COUNT(*) FROM channel_members WHERE channel_id = v_channel_id
  )
  WHERE id = v_channel_id;

  RETURN NULL;
END;
$$;
