-- Security-preserving wrapper fix: authenticated callers are not granted EXECUTE
-- on private implementations. Public wrappers run as definer and private routines
-- still validate auth.uid(), fully authorized sessions, and per-minute visibility.
alter function public.pick_meeting_agenda_decisions_v1(text,text,uuid,text,text,integer,integer) security definer;
alter function public.get_linked_agenda_decision_v1(uuid) security definer;
alter function public.sync_linked_meeting_agenda_v1(uuid,jsonb) security definer;
alter function public.record_linked_agenda_followup_v1(uuid,text) security definer;
notify pgrst,'reload schema';
