revoke execute on function
  public.set_conference_participant_role(uuid,uuid,text)
from authenticated;

revoke execute on function
  private.set_conference_participant_role(uuid,uuid,text)
from authenticated;

grant execute on function
  public.set_conference_participant_role(uuid,uuid,text)
to service_role;

grant execute on function
  private.set_conference_participant_role(uuid,uuid,text)
to service_role;

notify pgrst,'reload schema';
