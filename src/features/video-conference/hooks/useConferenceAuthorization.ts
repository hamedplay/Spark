import { useConferenceLiveData } from './useConferenceLiveData';
import { useCallback, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { getMyConferenceAuthorization } from '../services/conferenceAuthorization';
import type { ConferenceAuthorization } from '../types/conference.types';

const EMPTY_AUTHORIZATION: ConferenceAuthorization = {
  loaded: false,
  role: null,
  permissions: [],
};

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
}

export function useConferenceAuthorization({ client, roomId, currentUserId }: Params) {
  const [authorization, setAuthorization] = useState<ConferenceAuthorization>(EMPTY_AUTHORIZATION);

  const refreshAuthorization = useCallback(async () => {
    try {
      setAuthorization(await getMyConferenceAuthorization(client, roomId));
    } catch (error) {
      console.error('[VideoConference] authorization load failed', error);
      setAuthorization({ loaded: true, role: null, permissions: [] });
    }
  }, [client, roomId]);

  useConferenceLiveData(['conference_participants', 'conference_rooms', 'conference_role_assignments', 'conference_role_permissions', 'conference_permissions', 'conference_rbac_roles'], refreshAuthorization, client, roomId, true);

  return { authorization, refreshAuthorization };
}
