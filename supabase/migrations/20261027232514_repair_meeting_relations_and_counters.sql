-- Preserve repaired rows before removing references to deleted parent records.
CREATE TABLE IF NOT EXISTS private.database_integrity_repair_archive (
  source_table text NOT NULL,
  row_id uuid NOT NULL,
  repair_key text NOT NULL,
  original_row jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_table,row_id,repair_key)
);
ALTER TABLE private.database_integrity_repair_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.database_integrity_repair_archive FROM PUBLIC,anon,authenticated;
GRANT SELECT ON private.database_integrity_repair_archive TO service_role;
INSERT INTO private.database_integrity_repair_archive(source_table,row_id,repair_key,original_row)
SELECT 'meeting_inbox',id,'orphan_meeting',to_jsonb(i) FROM public.meeting_inbox i
WHERE meeting_id IS NULL ON CONFLICT DO NOTHING;
DELETE FROM public.meeting_inbox WHERE meeting_id IS NULL;
ALTER TABLE public.meeting_inbox ALTER COLUMN meeting_id SET NOT NULL;
ALTER TABLE public.meeting_inbox DROP CONSTRAINT IF EXISTS meeting_inbox_meeting_id_fkey;
ALTER TABLE public.meeting_inbox ADD CONSTRAINT meeting_inbox_meeting_id_fkey
  FOREIGN KEY(meeting_id) REFERENCES public.meetings(id) ON DELETE CASCADE;
INSERT INTO private.database_integrity_repair_archive(source_table,row_id,repair_key,original_row)
SELECT 'meetings',id,'orphan_calendar',to_jsonb(m) FROM public.meetings m
WHERE calendar_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.calendars c WHERE c.id=m.calendar_id)
ON CONFLICT DO NOTHING;
-- Do not generate invitations when repairing an already deleted calendar link.
SELECT set_config('spark.series_notify','off',true);
UPDATE public.meetings m SET calendar_id=NULL WHERE calendar_id IS NOT NULL
  AND NOT EXISTS(SELECT FROM public.calendars c WHERE c.id=m.calendar_id);
SELECT set_config('spark.series_notify','on',true);
DO $migration$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.meetings'::regclass AND conname='meetings_calendar_id_fkey') THEN
    ALTER TABLE public.meetings ADD CONSTRAINT meetings_calendar_id_fkey
      FOREIGN KEY(calendar_id) REFERENCES public.calendars(id) ON DELETE SET NULL;
  END IF;
END $migration$;
DROP INDEX IF EXISTS public.meeting_inbox_meeting_id_user_id_unique;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_account_status_active_consistency;

-- One counter trigger; atomic increments serialize concurrent membership writes.
CREATE OR REPLACE FUNCTION private.maintain_channel_member_count()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    UPDATE public.channels SET member_count=member_count+1 WHERE id=NEW.channel_id;
  ELSIF TG_OP='DELETE' THEN
    UPDATE public.channels SET member_count=greatest(0,member_count-1) WHERE id=OLD.channel_id;
  ELSIF NEW.channel_id IS DISTINCT FROM OLD.channel_id THEN
    PERFORM id FROM public.channels WHERE id IN(OLD.channel_id,NEW.channel_id) ORDER BY id FOR UPDATE;
    UPDATE public.channels SET member_count=greatest(0,member_count-1) WHERE id=OLD.channel_id;
    UPDATE public.channels SET member_count=member_count+1 WHERE id=NEW.channel_id;
  END IF;
  RETURN NULL;
END $function$;
REVOKE EXECUTE ON FUNCTION private.maintain_channel_member_count() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS trg_ch_member_count ON public.channel_members;
DROP TRIGGER IF EXISTS trg_channel_member_count ON public.channel_members;
DROP TRIGGER IF EXISTS trg_member_count ON public.channel_members;
CREATE TRIGGER trg_member_count AFTER INSERT OR DELETE OR UPDATE OF channel_id ON public.channel_members
  FOR EACH ROW EXECUTE FUNCTION private.maintain_channel_member_count();
UPDATE public.channels c SET member_count=(SELECT count(*) FROM public.channel_members m WHERE m.channel_id=c.id)
WHERE c.member_count IS DISTINCT FROM (SELECT count(*) FROM public.channel_members m WHERE m.channel_id=c.id);
DROP TRIGGER IF EXISTS trg_ch_channels_updated_at ON public.channels;
NOTIFY pgrst,'reload schema';
