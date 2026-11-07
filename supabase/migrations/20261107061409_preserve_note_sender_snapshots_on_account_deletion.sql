-- Permit only FK cleanup for a removed account; retain the immutable human name snapshot.
CREATE OR REPLACE FUNCTION private.capture_note_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.creator_id:=coalesce(auth.uid(),NEW.user_id);
  NEW.creator_name:=private.note_sender_name(NEW.creator_id);
 ELSE
  -- Identity snapshots cannot be forged by a client or changed by later edits/services.
  NEW.creator_id:=CASE WHEN NEW.creator_id IS NULL
    AND NOT EXISTS(SELECT FROM auth.users WHERE id=OLD.creator_id) THEN NULL ELSE OLD.creator_id END;
  NEW.creator_name:=OLD.creator_name;
  NEW.reminder_creator_id:=CASE WHEN NEW.reminder_creator_id IS NULL
    AND NOT EXISTS(SELECT FROM auth.users WHERE id=OLD.reminder_creator_id) THEN NULL ELSE OLD.reminder_creator_id END;
  NEW.reminder_creator_name:=OLD.reminder_creator_name;
 END IF;
 IF NEW.remind_at IS NOT NULL AND (TG_OP='INSERT' OR NEW.remind_at IS DISTINCT FROM OLD.remind_at) THEN
  NEW.reminder_creator_id:=coalesce(auth.uid(),NEW.user_id);
  NEW.reminder_creator_name:=private.note_sender_name(NEW.reminder_creator_id);
 END IF;
 RETURN NEW;
END $$;
