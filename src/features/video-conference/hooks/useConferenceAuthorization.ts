import { useCallback, useEffect, useState } from 'react';
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

  useEffect(() => {
    void refreshAuthorization();

    const channel = client.channel(`sfu-rbac-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_participants',
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        const row = (payload.new || payload.old) as { user_id?: string };
        if (row.user_id === currentUserId) void refreshAuthorization();
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conference_rooms',
        filter: `id=eq.${roomId}`,
      }, () => void refreshAuthorization())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [client, currentUserId, refreshAuthorization, roomId]);

  return { authorization, refreshAuthorization };
}
