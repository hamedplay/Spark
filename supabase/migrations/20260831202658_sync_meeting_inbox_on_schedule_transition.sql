DROP TRIGGER IF EXISTS meetings_sync_inbox_from_participants ON public.meetings;

CREATE TRIGGER meetings_sync_inbox_from_participants
AFTER INSERT OR UPDATE OF participant_user_ids, user_id, start_time, end_time
ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION private.sync_meeting_inbox_from_participants();
