-- Restore only the two guarded owner-delegation browser dependencies.
GRANT EXECUTE ON FUNCTION private.assign_meeting_owner_delegate(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.get_my_meeting_owner_delegations_v1() TO authenticated;

-- A narrow client boundary for legacy Mesh rooms. Keep the underlying role
-- implementation and the SFU apply RPC service-only.
CREATE OR REPLACE FUNCTION private.set_mesh_conference_participant_role(
  p_room_id uuid,p_target_user_id uuid,p_role text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid:=auth.uid();
  v_topology text;
BEGIN
  IF v_actor IS NULL OR COALESCE((auth.jwt()->>'is_anonymous')::boolean,false) THEN
    RETURN jsonb_build_object('ok',false,'reason','not_authenticated');
  END IF;
  IF NOT private.is_current_session_fully_authorized() THEN
    RETURN jsonb_build_object('ok',false,'reason','auth_access_restricted');
  END IF;
  IF NOT private.has_conference_permission(p_room_id,'MANAGE_ROLES',v_actor) THEN
    RETURN jsonb_build_object('ok',false,'reason','forbidden');
  END IF;

  -- Hold the room row until the role update completes, including its topology.
  SELECT r.media_topology INTO v_topology
  FROM public.conference_rooms r
  WHERE r.id=p_room_id AND r.status<>'ended'
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok',false,'reason','room_not_found');
  END IF;
  IF v_topology IS DISTINCT FROM 'mesh' THEN
    RETURN jsonb_build_object('ok',false,'reason','use_sfu_host_control');
  END IF;

  -- Retain existing actor/target rank, owner/self, participant and role rules.
  RETURN private.set_conference_participant_role(p_room_id,p_target_user_id,p_role);
END;
$function$;
REVOKE ALL ON FUNCTION private.set_mesh_conference_participant_role(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.set_mesh_conference_participant_role(uuid,uuid,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.set_conference_participant_role(
  p_room_id uuid,p_target_user_id uuid,p_role text
) RETURNS jsonb LANGUAGE sql SET search_path TO ''
AS $function$
  SELECT private.set_mesh_conference_participant_role($1,$2,$3);
$function$;
